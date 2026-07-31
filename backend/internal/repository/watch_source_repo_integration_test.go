//go:build integration

package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestWatchSourceRepositoryListsEffectivePricingObservations(t *testing.T) {
	ctx := context.Background()
	name := fmt.Sprintf("watch-pricing-%d", time.Now().UnixNano())
	var sourceID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_sources (name,adapter_type,base_url,api_base_url,recharge_ratio,low_balance_threshold,polling_interval_seconds,request_timeout_seconds,enabled,last_check_status,last_balance)
VALUES ($1,'sub2api','https://example.com','https://example.com/api/v1',10,5,60,15,TRUE,'healthy',20)
RETURNING id`, name).Scan(&sourceID))
	t.Cleanup(func() {
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_checks WHERE target_type='source' AND target_id=$1`, sourceID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_sources WHERE id=$1`, sourceID)
	})

	now := time.Now().UTC()
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_source_groups (source_id,external_id,name,platform,rate_multiplier,user_rate_multiplier,pricing_available,observed_at)
VALUES ($1,'g1','Group 1','openai',0.2,0.1,TRUE,$2)`, sourceID, now)
		return err
	}())
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_source_prices (source_id,group_external_id,platform,model,component,value,observed_at)
VALUES ($1,'g1','openai','gpt-test','input',0.2,$2)`, sourceID, now)
		return err
	}())
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_checks (target_type,target_id,status,observed_at,expires_at)
VALUES ('source',$1,'healthy',$2,$3)`, sourceID, now, now.Add(time.Minute))
		return err
	}())

	repo := &watchSourceRepository{db: integrationDB}
	groups, err := repo.ListPricingObservations(ctx, service.WatchPriceModeGroupMultiplier, "", "", service.WatchPriceComponentInput)
	require.NoError(t, err)
	group := findWatchPricingObservation(t, groups, sourceID)
	require.NotNil(t, group.Value)
	require.InDelta(t, 0.01, *group.Value, 0.000000001)

	prices, err := repo.ListPricingObservations(ctx, service.WatchPriceModeModelPrice, "openai", "gpt-test", service.WatchPriceComponentInput)
	require.NoError(t, err)
	price := findWatchPricingObservation(t, prices, sourceID)
	require.NotNil(t, price.Value)
	require.InDelta(t, 0.02, *price.Value, 0.000000001)

	nextObservedAt := now.Add(time.Second)
	nextBalance := 20.0
	nextUserRate := 0.2
	require.NoError(t, repo.SaveSourceObservation(ctx, sourceID, service.WatchSourceObservation{
		Status:     "healthy",
		ObservedAt: nextObservedAt,
		ExpiresAt:  nextObservedAt.Add(time.Minute),
		Balance:    &nextBalance,
		Groups: []service.WatchSourceGroupObservation{{
			ExternalID: "g1", Name: "Group 1", Platform: "openai", RateMultiplier: 0.2,
			UserRateMultiplier: &nextUserRate, PricingAvailable: true, ObservedAt: nextObservedAt,
		}},
		Prices: []service.WatchSourcePriceObservation{{
			GroupExternalID: "g1", Platform: "openai", Model: "gpt-test",
			Component: "input", Value: 0.3, ObservedAt: nextObservedAt,
		}},
	}))

	changes, err := repo.ListPriceChanges(ctx, 500)
	require.NoError(t, err)
	groupChange := findWatchPriceChange(t, changes, sourceID, "group_multiplier")
	require.InDelta(t, 0.1, groupChange.PreviousValue, 0.000000001)
	require.InDelta(t, 0.2, groupChange.NextValue, 0.000000001)
	require.Equal(t, "increase", groupChange.ChangeKind)
	priceChange := findWatchPriceChange(t, changes, sourceID, "input")
	require.Equal(t, "gpt-test", priceChange.Model)
	require.InDelta(t, 0.2, priceChange.PreviousValue, 0.000000001)
	require.InDelta(t, 0.3, priceChange.NextValue, 0.000000001)
	require.Equal(t, "increase", priceChange.ChangeKind)
}

func TestSaveSourceObservationBumpsPricingRuleDueOnMatchedGroupChange(t *testing.T) {
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	var groupID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO groups (name,description,rate_multiplier,status)
VALUES ($1,'watch pricing trigger test',1,'active')
RETURNING id`, fmt.Sprintf("watch-trigger-group-%d", suffix)).Scan(&groupID))
	var accountID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO accounts (name,platform,type,status,schedulable,credentials)
VALUES ($1,'openai','apikey','active',TRUE,'{}'::jsonb)
RETURNING id`, fmt.Sprintf("watch-trigger-account-%d", suffix)).Scan(&accountID))
	var sourceID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_sources (name,adapter_type,base_url,api_base_url,recharge_ratio,low_balance_threshold,polling_interval_seconds,request_timeout_seconds,enabled,last_check_status,last_balance)
VALUES ($1,'sub2api','https://trigger.example','https://trigger.example/api/v1',1,5,60,15,TRUE,'healthy',20)
RETURNING id`, fmt.Sprintf("watch-trigger-source-%d", suffix)).Scan(&sourceID))
	var ruleID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_pricing_rules (name,target_group_id,mode,component,enabled,interval_seconds,next_run_at)
VALUES ($1,$2,'group_multiplier','input',TRUE,300,NOW() + INTERVAL '1 hour')
RETURNING id`, fmt.Sprintf("watch-trigger-rule-%d", suffix), groupID).Scan(&ruleID))
	t.Cleanup(func() {
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_pricing_rules WHERE id=$1`, ruleID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_account_upstream_mappings WHERE account_id=$1`, accountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM account_groups WHERE account_id=$1 OR group_id=$2`, accountID, groupID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_checks WHERE target_type='source' AND target_id=$1`, sourceID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_sources WHERE id=$1`, sourceID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM accounts WHERE id=$1`, accountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM groups WHERE id=$1`, groupID)
	})
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO account_groups (account_id,group_id,priority,created_at)
VALUES ($1,$2,1,NOW())`, accountID, groupID)
		return err
	}())
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mappings (account_id,source_id,source_key_external_id,source_group_external_id,mapping_method)
VALUES ($1,$2,'key-a','g1','manual')`, accountID, sourceID)
		return err
	}())
	now := time.Now().UTC()
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_source_groups (source_id,external_id,name,platform,rate_multiplier,pricing_available,observed_at)
VALUES ($1,'g1','Group 1','openai',0.2,TRUE,$2)`, sourceID, now)
		return err
	}())

	repo := &watchSourceRepository{db: integrationDB}
	observedAt := now.Add(time.Second)
	balance := 20.0
	require.NoError(t, repo.SaveSourceObservation(ctx, sourceID, service.WatchSourceObservation{
		Status:     "healthy",
		ObservedAt: observedAt,
		ExpiresAt:  observedAt.Add(time.Minute),
		Balance:    &balance,
		Groups: []service.WatchSourceGroupObservation{{
			ExternalID: "g1", Name: "Group 1", Platform: "openai", RateMultiplier: 0.5,
			PricingAvailable: true, ObservedAt: observedAt,
		}},
	}))

	var nextRunAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT next_run_at FROM watch_pricing_rules WHERE id=$1`, ruleID).Scan(&nextRunAt))
	require.WithinDuration(t, observedAt, nextRunAt, time.Second)

	claimed, err := repo.ClaimDuePricingRules(ctx, observedAt.Add(time.Second), 10)
	require.NoError(t, err)
	require.Len(t, claimed, 1)
	require.Equal(t, ruleID, claimed[0].ID)
}

func TestListIntegrationAccountHealthResolvesSourceGroupNameFromCurrentGroupAndHistory(t *testing.T) {
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	sourceName := fmt.Sprintf("watch-health-source-%d", suffix)
	var sourceID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_sources (name,adapter_type,base_url,api_base_url,recharge_ratio,low_balance_threshold,polling_interval_seconds,request_timeout_seconds,enabled,last_check_status,last_balance)
VALUES ($1,'sub2api','https://health.example','https://health.example/api/v1',1,5,60,15,TRUE,'healthy',20)
RETURNING id`, sourceName).Scan(&sourceID))
	var currentAccountID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO accounts (name,platform,type,status,schedulable,credentials)
VALUES ($1,'openai','apikey','active',TRUE,$2::jsonb)
RETURNING id`, fmt.Sprintf("watch-health-current-account-%d", suffix), `{"base_url":"https://health.example/api/v1"}`).Scan(&currentAccountID))
	var historyAccountID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO accounts (name,platform,type,status,schedulable,credentials)
VALUES ($1,'openai','apikey','active',TRUE,$2::jsonb)
RETURNING id`, fmt.Sprintf("watch-health-history-account-%d", suffix), `{"base_url":"https://health.example/api/v1"}`).Scan(&historyAccountID))
	t.Cleanup(func() {
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_account_upstream_mappings WHERE account_id IN ($1,$2)`, currentAccountID, historyAccountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_account_upstream_mapping_history WHERE account_id IN ($1,$2)`, currentAccountID, historyAccountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_sources WHERE id=$1`, sourceID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM accounts WHERE id IN ($1,$2)`, currentAccountID, historyAccountID)
	})
	now := time.Now().UTC()
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_source_groups (source_id,external_id,name,platform,rate_multiplier,pricing_available,observed_at)
VALUES ($1,'g-current','Current Group','openai',0.2,TRUE,$2)`, sourceID, now)
		return err
	}())
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mappings (account_id,source_id,source_key_external_id,source_group_external_id,mapping_method)
VALUES ($1,$2,'key-current','g-current','manual'),($3,$2,'key-history','g-history','manual')`, currentAccountID, sourceID, historyAccountID)
		return err
	}())
	require.NoError(t, func() error {
		_, err := integrationDB.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mapping_history
	(account_id,source_id,source_name_snapshot,source_key_external_id,source_group_external_id,source_group_name_snapshot,mapping_method,valid_from)
VALUES ($1,$2,$3,'key-history','g-history','History Snapshot Group','manual',$4)`, historyAccountID, sourceID, sourceName, now)
		return err
	}())

	repo := &watchSourceRepository{db: integrationDB}
	rows, err := repo.ListIntegrationAccountHealth(ctx, service.WatchIntegrationAccountHealthFilter{
		Search: fmt.Sprintf("watch-health-%%-account-%d", suffix),
		Limit:  10,
	}, now.Add(-30*time.Minute), now.Add(time.Minute))
	require.NoError(t, err)
	require.Len(t, rows, 2)
	namesByAccount := map[int64]string{}
	for _, row := range rows {
		namesByAccount[row.AccountID] = row.SourceGroupName
	}
	require.Equal(t, "Current Group", namesByAccount[currentAccountID])
	require.Equal(t, "History Snapshot Group", namesByAccount[historyAccountID])
}

func TestClaimPricingRuleRunCastsNowParameterAsTimestamp(t *testing.T) {
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	var groupID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO groups (name,description,rate_multiplier,status)
VALUES ($1,'watch claim timestamp test',1,'active')
RETURNING id`, fmt.Sprintf("watch-claim-group-%d", suffix)).Scan(&groupID))
	var ruleID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_pricing_rules (name,target_group_id,mode,component,enabled,interval_seconds,next_run_at)
VALUES ($1,$2,'group_multiplier','input',TRUE,120,NOW() + INTERVAL '1 hour')
RETURNING id`, fmt.Sprintf("watch-claim-rule-%d", suffix), groupID).Scan(&ruleID))
	t.Cleanup(func() {
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_pricing_rules WHERE id=$1`, ruleID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM groups WHERE id=$1`, groupID)
	})

	now := time.Now().UTC().Truncate(time.Second)
	repo := &watchSourceRepository{db: integrationDB}
	rule, err := repo.ClaimPricingRuleRun(ctx, ruleID, now)
	require.NoError(t, err)
	require.Equal(t, int64(1), rule.RunSequence)
	require.Equal(t, "running", rule.LastStatus)
	require.InDelta(t, 0.003, rule.AdjustmentStep, 0.000000001)
	require.NotNil(t, rule.LastRunAt)
	require.NotNil(t, rule.NextRunAt)
	require.WithinDuration(t, now, *rule.LastRunAt, time.Second)
	require.WithinDuration(t, now.Add(120*time.Second), *rule.NextRunAt, time.Second)
}

func findWatchPricingObservation(t *testing.T, observations []service.WatchPricingObservation, sourceID int64) service.WatchPricingObservation {
	t.Helper()
	for _, observation := range observations {
		if observation.SourceID == sourceID {
			return observation
		}
	}
	t.Fatalf("pricing observation for source %d not found", sourceID)
	return service.WatchPricingObservation{}
}

func findWatchPriceChange(t *testing.T, changes []service.WatchPriceChange, sourceID int64, component string) service.WatchPriceChange {
	t.Helper()
	for _, change := range changes {
		if change.SourceID == sourceID && change.Component == component {
			return change
		}
	}
	t.Fatalf("price change for source %d and component %s not found", sourceID, component)
	return service.WatchPriceChange{}
}
