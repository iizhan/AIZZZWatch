//go:build integration

package repository

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestWatchRateCompensationUsesExactRowsAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	detectedAt := time.Now().UTC().Add(-3 * time.Minute).Truncate(time.Microsecond)

	var groupID, accountID, userID, operatorID, apiKeyID, ruleID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO groups (name,description,rate_multiplier,status)
VALUES ($1,'watch compensation integration test',0.68,'active') RETURNING id`, fmt.Sprintf("watch-comp-group-%d", suffix)).Scan(&groupID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO accounts (name,platform,type,status,schedulable,credentials)
VALUES ($1,'openai','apikey','active',TRUE,'{}'::jsonb) RETURNING id`, fmt.Sprintf("watch-comp-account-%d", suffix)).Scan(&accountID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO users (email,username,password_hash,role,balance,status)
VALUES ($1,$2,'test-hash','user',10,'active') RETURNING id`, fmt.Sprintf("watch-comp-user-%d@example.test", suffix), fmt.Sprintf("watch-comp-user-%d", suffix)).Scan(&userID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO users (email,username,password_hash,role,balance,status)
VALUES ($1,$2,'test-hash','admin',0,'active') RETURNING id`, fmt.Sprintf("watch-comp-admin-%d@example.test", suffix), fmt.Sprintf("watch-comp-admin-%d", suffix)).Scan(&operatorID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO api_keys (user_id,key,name,group_id,status)
VALUES ($1,$2,'watch compensation test',$3,'active') RETURNING id`, userID, fmt.Sprintf("sk-watch-comp-%d", suffix), groupID).Scan(&apiKeyID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_pricing_rules (name,target_group_id,mode,component,enabled,interval_seconds,next_run_at)
VALUES ($1,$2,'group_multiplier','input',TRUE,300,NOW()) RETURNING id`, fmt.Sprintf("watch-comp-rule-%d", suffix), groupID).Scan(&ruleID))

	t.Cleanup(func() {
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM redeem_codes WHERE used_by=$1 AND notes LIKE 'Watch rate compensation #%'`, userID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_rate_compensations WHERE target_group_id=$1`, groupID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_rate_anomalies WHERE pricing_rule_id=$1 OR target_group_id=$2`, ruleID, groupID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_pricing_rules WHERE id=$1`, ruleID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM usage_logs WHERE user_id=$1`, userID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM api_keys WHERE id=$1`, apiKeyID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1,$2)`, userID, operatorID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM accounts WHERE id=$1`, accountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM groups WHERE id=$1`, groupID)
	})

	repo := &watchSourceRepository{db: integrationDB}
	anomaly, err := repo.ReconcileWatchRateAnomaly(ctx, service.WatchRateAnomalyReconcileInput{
		PricingRuleID: ruleID, TargetGroupID: groupID, CurrentValue: 0.68, TargetValue: 0.07,
		HighestUpstreamCost: 0.06, Evidence: service.WatchRateEvidenceSummary{PricingSource: "official_probe", OfficialProbeCount: 1},
		ObservedAt: detectedAt,
	})
	require.NoError(t, err)
	require.NotNil(t, anomaly)
	require.Equal(t, service.WatchRateAnomalyOverpriced, anomaly.Kind)

	usageAt := detectedAt.Add(time.Minute)
	_, err = integrationDB.ExecContext(ctx, `
INSERT INTO usage_logs
    (user_id,api_key_id,account_id,request_id,model,group_id,total_cost,actual_cost,rate_multiplier,billing_type,billing_mode,created_at)
VALUES
	    ($1,$2,$3,$4,'test-model',$5,1,0.68,0.68,0,'token',$6),
	    ($1,$2,$3,$7,'test-model',$5,1,0.68,0.68,1,'token',$6 + INTERVAL '1 second'),
	    ($1,$2,$3,$8,'test-model',$5,1,0.80,0.80,0,'token',$6 + INTERVAL '2 seconds')`,
		userID, apiKeyID, accountID, fmt.Sprintf("watch-comp-exact-%d", suffix), groupID, usageAt,
		fmt.Sprintf("watch-comp-ambiguous-%d", suffix), fmt.Sprintf("watch-comp-rate-mismatch-%d", suffix))
	require.NoError(t, err)

	resolved, err := repo.ReconcileWatchRateAnomaly(ctx, service.WatchRateAnomalyReconcileInput{
		PricingRuleID: ruleID, TargetGroupID: groupID, CurrentValue: 0.07, TargetValue: 0.07,
		HighestUpstreamCost: 0.06, Evidence: service.WatchRateEvidenceSummary{PricingSource: "official_probe", OfficialProbeCount: 1},
		ObservedAt: detectedAt.Add(2 * time.Minute),
	})
	require.NoError(t, err)
	require.NotNil(t, resolved)
	require.Equal(t, service.WatchRateAnomalyResolved, resolved.Status)

	preview, err := repo.PreviewWatchRateCompensation(ctx, anomaly.ID, detectedAt.Add(3*time.Minute))
	require.NoError(t, err)
	require.Len(t, preview.Rows, 1)
	row := preview.Rows[0]
	require.Equal(t, int64(3), row.RequestCount)
	require.Equal(t, int64(1), row.EligibleRequestCount)
	require.Equal(t, int64(2), row.UnresolvedRequestCount)
	require.True(t, row.Eligible)
	require.InDelta(t, 0.61, row.CandidateAmount, 0.000000001)
	require.Contains(t, row.Reason, "requires review")

	input := service.WatchRateCompensationApplyInput{
		UserIDs: []int64{userID}, Confirmed: true, IdempotencyKey: fmt.Sprintf("watch-comp-%d", suffix), Reason: "verified rate difference",
	}
	results := make([]*service.WatchRateCompensationApplyResult, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			results[index], errs[index] = repo.ApplyWatchRateCompensation(ctx, anomaly.ID, input, operatorID, detectedAt.Add(3*time.Minute))
		}(i)
	}
	wg.Wait()
	for i := range results {
		require.NoError(t, errs[i])
		require.NotNil(t, results[i])
		require.Equal(t, 1, results[i].AppliedCount)
		require.InDelta(t, 0.61, results[i].CompensatedAmount, 0.000000001)
	}
	require.True(t, results[0].Replayed || results[1].Replayed)

	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance FROM users WHERE id=$1`, userID).Scan(&balance))
	require.InDelta(t, 10.61, balance, 0.000000001)
	var compensationCount, adjustmentCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM watch_rate_compensations WHERE anomaly_id=$1`, anomaly.ID).Scan(&compensationCount))
	require.Equal(t, 1, compensationCount)
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM redeem_codes WHERE used_by=$1 AND type='admin_balance' AND notes LIKE $2`, userID, fmt.Sprintf("Watch rate compensation #%d:%%", anomaly.ID)).Scan(&adjustmentCount))
	require.Equal(t, 1, adjustmentCount)

	externalInput := service.WatchRateExternalCompensationInput{
		TargetGroupID:  groupID,
		UserID:         userID,
		WindowStart:    detectedAt.Add(-time.Hour),
		WindowEnd:      detectedAt,
		Amount:         0.25,
		IdempotencyKey: fmt.Sprintf("watch-ext-comp-%d", suffix),
		Reason:         "externally verified adjustment",
	}
	require.NoError(t, repo.RecordExternalWatchRateCompensation(ctx, externalInput, operatorID, detectedAt.Add(3*time.Minute)))
	require.NoError(t, repo.RecordExternalWatchRateCompensation(ctx, externalInput, operatorID, detectedAt.Add(4*time.Minute)))
	externalInput.WindowEnd = externalInput.WindowEnd.Add(time.Minute)
	require.ErrorIs(t, repo.RecordExternalWatchRateCompensation(ctx, externalInput, operatorID, detectedAt.Add(5*time.Minute)), service.ErrWatchRateCompensationIdempotencyMismatch)
}
