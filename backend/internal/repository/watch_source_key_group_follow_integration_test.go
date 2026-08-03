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

type watchKeyGroupFollowFixture struct {
	groupID   int64
	accountID int64
	sourceID  int64
	ruleID    int64
	initialAt time.Time
}

func newWatchKeyGroupFollowFixture(t *testing.T, schedulable, autoFollow bool) watchKeyGroupFollowFixture {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	fixture := watchKeyGroupFollowFixture{initialAt: time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)}
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO groups (name,description,rate_multiplier,status)
VALUES ($1,'watch key group follow test',1,'active') RETURNING id`, fmt.Sprintf("watch-follow-group-%d", suffix)).Scan(&fixture.groupID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO accounts (name,platform,type,status,schedulable,credentials)
VALUES ($1,'openai','apikey','active',$2,'{}'::jsonb) RETURNING id`, fmt.Sprintf("watch-follow-account-%d", suffix), schedulable).Scan(&fixture.accountID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_sources
    (name,adapter_type,base_url,api_base_url,recharge_ratio,low_balance_threshold,
     polling_interval_seconds,request_timeout_seconds,auto_follow_key_group,enabled,last_check_status,last_balance)
VALUES ($1,'sub2api','https://follow.example','https://follow.example/api/v1',1,0,60,15,$2,TRUE,'healthy',20)
RETURNING id`, fmt.Sprintf("watch-follow-source-%d", suffix), autoFollow).Scan(&fixture.sourceID))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
INSERT INTO watch_pricing_rules (name,target_group_id,mode,component,enabled,interval_seconds,next_run_at)
VALUES ($1,$2,'group_multiplier','input',TRUE,300,NOW() + INTERVAL '1 hour') RETURNING id`, fmt.Sprintf("watch-follow-rule-%d", suffix), fixture.groupID).Scan(&fixture.ruleID))
	_, err := integrationDB.ExecContext(ctx, `
INSERT INTO account_groups (account_id,group_id,priority,created_at) VALUES ($1,$2,1,NOW())`, fixture.accountID, fixture.groupID)
	require.NoError(t, err)
	_, err = integrationDB.ExecContext(ctx, `
INSERT INTO watch_source_groups
    (source_id,external_id,name,platform,rate_multiplier,pricing_available,observed_at)
VALUES ($1,'g1','Group 1','openai',0.2,TRUE,$2),($1,'g2','Group 2','openai',0.3,TRUE,$2)`, fixture.sourceID, fixture.initialAt)
	require.NoError(t, err)
	_, err = integrationDB.ExecContext(ctx, `
INSERT INTO watch_source_keys
    (source_id,external_id,label,status,group_external_ids,group_names,observed_at)
VALUES ($1,'key-a','Key A','active','["g1"]'::jsonb,'["Group 1"]'::jsonb,$2)`, fixture.sourceID, fixture.initialAt)
	require.NoError(t, err)
	_, err = integrationDB.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mappings
    (account_id,source_id,source_key_external_id,source_group_external_id,mapping_method,
     group_binding_state,confirmed_group_external_ids,source_key_observed_at)
VALUES ($1,$2,'key-a','g1','manual','confirmed','["g1"]'::jsonb,$3)`, fixture.accountID, fixture.sourceID, fixture.initialAt)
	require.NoError(t, err)
	_, err = integrationDB.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mapping_history
    (account_id,source_id,source_name_snapshot,source_key_external_id,source_key_label_snapshot,
     source_group_external_id,source_group_name_snapshot,mapping_method,valid_from)
SELECT $1,$2,name,'key-a','Key A','g1','Group 1','manual',$3 FROM watch_sources WHERE id=$2`, fixture.accountID, fixture.sourceID, fixture.initialAt)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_pricing_rules WHERE id=$1`, fixture.ruleID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM account_groups WHERE account_id=$1 OR group_id=$2`, fixture.accountID, fixture.groupID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM watch_sources WHERE id=$1`, fixture.sourceID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM accounts WHERE id=$1`, fixture.accountID)
		_, _ = integrationDB.ExecContext(context.Background(), `DELETE FROM groups WHERE id=$1`, fixture.groupID)
	})
	return fixture
}

func watchKeyGroupFollowObservation(fixture watchKeyGroupFollowFixture, observedAt time.Time, groupIDs []string, keyStatus string) service.WatchSourceObservation {
	balance := 20.0
	return service.WatchSourceObservation{
		Status: "healthy", ObservedAt: observedAt, ExpiresAt: observedAt.Add(time.Minute), Balance: &balance,
		Groups: []service.WatchSourceGroupObservation{
			{ExternalID: "g1", Name: "Group 1", Platform: "openai", RateMultiplier: 0.2, PricingAvailable: true, ObservedAt: observedAt},
			{ExternalID: "g2", Name: "Group 2", Platform: "openai", RateMultiplier: 0.3, PricingAvailable: true, ObservedAt: observedAt},
		},
		SourceKeys: []service.WatchSourceKeyObservation{{
			ExternalID: "key-a", Label: "Key A", Status: keyStatus,
			GroupExternalIDs: groupIDs, ObservedAt: observedAt,
		}},
	}
}

func TestSaveSourceObservationAutomaticallyFollowsUniqueKeyGroupAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	fixture := newWatchKeyGroupFollowFixture(t, true, true)
	observedAt := fixture.initialAt.Add(2 * time.Minute)
	repo := &watchSourceRepository{db: integrationDB}
	observation := watchKeyGroupFollowObservation(fixture, observedAt, []string{"g2"}, "active")
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID, observation))

	var groupID, method, state, confirmedGroups string
	var sourceKeyObservedAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT source_group_external_id,mapping_method,group_binding_state,confirmed_group_external_ids::text,source_key_observed_at
FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).
		Scan(&groupID, &method, &state, &confirmedGroups, &sourceKeyObservedAt))
	require.Equal(t, "g2", groupID)
	require.Equal(t, "auto", method)
	require.Equal(t, "confirmed", state)
	require.JSONEq(t, `["g2"]`, confirmedGroups)
	require.WithinDuration(t, observedAt, sourceKeyObservedAt, time.Millisecond)

	var historyCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM watch_account_upstream_mapping_history WHERE account_id=$1`, fixture.accountID).Scan(&historyCount))
	require.Equal(t, 2, historyCount)
	var nextRunAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT next_run_at FROM watch_pricing_rules WHERE id=$1`, fixture.ruleID).Scan(&nextRunAt))
	require.WithinDuration(t, observedAt, nextRunAt, time.Millisecond)

	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID, observation))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM watch_account_upstream_mapping_history WHERE account_id=$1`, fixture.accountID).Scan(&historyCount))
	require.Equal(t, 2, historyCount)
}

func TestSaveSourceObservationFreezesChangedMultiGroupAssignmentUntilConfirmed(t *testing.T) {
	ctx := context.Background()
	fixture := newWatchKeyGroupFollowFixture(t, true, true)
	observedAt := fixture.initialAt.Add(2 * time.Minute)
	var originalNextRunAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT next_run_at FROM watch_pricing_rules WHERE id=$1`, fixture.ruleID).Scan(&originalNextRunAt))
	repo := &watchSourceRepository{db: integrationDB}
	observation := watchKeyGroupFollowObservation(fixture, observedAt, []string{"g2", "g1", "g2"}, "active")
	// A price change in the same observation must not schedule the rule after
	// the Key assignment becomes ambiguous.
	observation.Groups[0].RateMultiplier = 0.21
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID, observation))

	var groupID, state, confirmedGroups string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT source_group_external_id,group_binding_state,confirmed_group_external_ids::text
FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).Scan(&groupID, &state, &confirmedGroups))
	require.Equal(t, "g1", groupID)
	require.Equal(t, "needs_confirmation", state)
	require.JSONEq(t, `["g1"]`, confirmedGroups)

	var nextRunAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT next_run_at FROM watch_pricing_rules WHERE id=$1`, fixture.ruleID).Scan(&nextRunAt))
	require.WithinDuration(t, originalNextRunAt, nextRunAt, time.Millisecond)
}

func TestSaveSourceObservationClosesAndRestoresMappingHistoryAcrossPendingConfirmation(t *testing.T) {
	ctx := context.Background()
	fixture := newWatchKeyGroupFollowFixture(t, true, true)
	repo := &watchSourceRepository{db: integrationDB}
	pendingAt := fixture.initialAt.Add(2 * time.Minute)
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID,
		watchKeyGroupFollowObservation(fixture, pendingAt, []string{"g1", "g2"}, "active")))

	var closedAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT valid_to FROM watch_account_upstream_mapping_history
WHERE account_id=$1 ORDER BY id DESC LIMIT 1`, fixture.accountID).Scan(&closedAt))
	require.WithinDuration(t, pendingAt, closedAt, time.Millisecond)

	recoveredAt := pendingAt.Add(2 * time.Minute)
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID,
		watchKeyGroupFollowObservation(fixture, recoveredAt, []string{"g1"}, "active")))

	var state string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT group_binding_state FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).Scan(&state))
	require.Equal(t, "confirmed", state)
	var historyCount int
	var activeGroupID string
	var activeFrom time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT COUNT(*),MAX(source_group_external_id),MAX(valid_from)
FROM watch_account_upstream_mapping_history
WHERE account_id=$1 AND valid_to IS NULL`, fixture.accountID).Scan(&historyCount, &activeGroupID, &activeFrom))
	require.Equal(t, 1, historyCount)
	require.Equal(t, "g1", activeGroupID)
	require.WithinDuration(t, recoveredAt, activeFrom, time.Millisecond)
}

func TestSaveSourceObservationRebindsUnschedulableAccountWithoutTriggeringPricingRule(t *testing.T) {
	ctx := context.Background()
	fixture := newWatchKeyGroupFollowFixture(t, false, true)
	var originalNextRunAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT next_run_at FROM watch_pricing_rules WHERE id=$1`, fixture.ruleID).Scan(&originalNextRunAt))
	observedAt := fixture.initialAt.Add(2 * time.Minute)
	repo := &watchSourceRepository{db: integrationDB}
	observation := watchKeyGroupFollowObservation(fixture, observedAt, []string{"g2"}, "active")
	// The changed multiplier exercises the observation-trigger path as well as
	// the mapping-follow path; an unschedulable account must not make the rule due.
	observation.Groups[0].RateMultiplier = 0.21
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID, observation))

	var groupID string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT source_group_external_id FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).Scan(&groupID))
	require.Equal(t, "g2", groupID)
	var nextRunAt time.Time
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT next_run_at FROM watch_pricing_rules WHERE id=$1`, fixture.ruleID).Scan(&nextRunAt))
	require.WithinDuration(t, originalNextRunAt, nextRunAt, time.Millisecond)
}

func TestSaveSourceObservationDoesNotFollowWhenSourceSettingIsDisabled(t *testing.T) {
	ctx := context.Background()
	fixture := newWatchKeyGroupFollowFixture(t, true, false)
	repo := &watchSourceRepository{db: integrationDB}
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID,
		watchKeyGroupFollowObservation(fixture, fixture.initialAt.Add(2*time.Minute), []string{"g2"}, "active")))

	var groupID, state string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT source_group_external_id,group_binding_state FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).Scan(&groupID, &state))
	require.Equal(t, "g1", groupID)
	require.Equal(t, "confirmed", state)
}

func TestSaveSourceObservationRequiresConfirmationForUnavailableKeyAssignment(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*service.WatchSourceObservation)
	}{
		{name: "inactive key", mutate: func(observation *service.WatchSourceObservation) {
			observation.SourceKeys[0].Status = "disabled"
		}},
		{name: "missing key", mutate: func(observation *service.WatchSourceObservation) {
			observation.SourceKeys = []service.WatchSourceKeyObservation{}
		}},
		{name: "missing target group", mutate: func(observation *service.WatchSourceObservation) {
			observation.SourceKeys[0].GroupExternalIDs = []string{"missing-group"}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			fixture := newWatchKeyGroupFollowFixture(t, true, true)
			observation := watchKeyGroupFollowObservation(fixture, fixture.initialAt.Add(2*time.Minute), []string{"g2"}, "active")
			test.mutate(&observation)
			repo := &watchSourceRepository{db: integrationDB}
			require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID, observation))

			var groupID, state string
			require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT source_group_external_id,group_binding_state FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).Scan(&groupID, &state))
			require.Equal(t, "g1", groupID)
			require.Equal(t, "needs_confirmation", state)
		})
	}
}

func TestSaveSourceObservationIgnoresAssignmentOlderThanManualMappingUpdate(t *testing.T) {
	ctx := context.Background()
	fixture := newWatchKeyGroupFollowFixture(t, true, true)
	observedAt := fixture.initialAt.Add(2 * time.Minute)
	_, err := integrationDB.ExecContext(ctx, `
UPDATE watch_account_upstream_mappings SET updated_at=$2 WHERE account_id=$1`, fixture.accountID, observedAt.Add(time.Minute))
	require.NoError(t, err)
	repo := &watchSourceRepository{db: integrationDB}
	require.NoError(t, repo.SaveSourceObservation(ctx, fixture.sourceID,
		watchKeyGroupFollowObservation(fixture, observedAt, []string{"g2"}, "active")))

	var groupID, state string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
SELECT source_group_external_id,group_binding_state FROM watch_account_upstream_mappings WHERE account_id=$1`, fixture.accountID).Scan(&groupID, &state))
	require.Equal(t, "g1", groupID)
	require.Equal(t, "confirmed", state)
}
