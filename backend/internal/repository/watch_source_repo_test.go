package repository

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestSaveSourceObservationPersistsFreshDataWhenBalanceIsLow(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now().UTC()
	latency := 42
	balance := 1.25
	observation := service.WatchSourceObservation{
		Status: "degraded", ErrorCode: "low_balance", LatencyMs: &latency,
		ObservedAt: now, ExpiresAt: now.Add(time.Minute), Balance: &balance,
		Groups: []service.WatchSourceGroupObservation{{ExternalID: "group-a", Name: "Group A", Platform: "openai", RateMultiplier: 0.8, PricingAvailable: true, ObservedAt: now}},
		Prices: []service.WatchSourcePriceObservation{{GroupExternalID: "group-a", Platform: "openai", Model: "gpt-test", Component: "input", Value: 0.4, ObservedAt: now}},
	}
	sourceName := "Source A"
	rechargeRatio := 1.0

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT name,recharge_ratio,auto_follow_key_group FROM watch_sources WHERE id=$1")).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"name", "recharge_ratio", "auto_follow_key_group"}).AddRow(sourceName, rechargeRatio, true))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE watch_sources SET last_check_status=$2::VARCHAR(32), last_check_at=$3,")).
		WithArgs(int64(7), "degraded", now, "low_balance", &latency, &balance).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO watch_checks (target_type,target_id,status,error_code,latency_ms,observed_at,expires_at)")).
		WithArgs(int64(7), "degraded", "low_balance", &latency, now, observation.ExpiresAt).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM watch_checks WHERE id IN (")).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO watch_price_changes").
		WithArgs(int64(7), "group-a", "openai", 0.8, now, sourceName, "Group A").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO watch_source_group_history").
		WithArgs(int64(7), sourceName, "group-a", "Group A", "openai", 0.8, nil, rechargeRatio, now).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO watch_price_changes").
		WithArgs(int64(7), "group-a", "openai", "gpt-test", "input", 0.4, now, sourceName, "Group A").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO watch_source_price_history").
		WithArgs(int64(7), sourceName, "group-a", "Group A", "openai", "gpt-test", "input", 0.4, rechargeRatio, now).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM watch_source_groups WHERE source_id=$1")).WithArgs(int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM watch_source_prices WHERE source_id=$1")).WithArgs(int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO watch_source_groups").
		WithArgs(int64(7), "group-a", "Group A", "openai", 0.8, nil, true, now).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO watch_source_prices").
		WithArgs(int64(7), "group-a", "openai", "gpt-test", "input", 0.4, now).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM watch_price_changes WHERE id IN (")).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	repo := &watchSourceRepository{db: db}
	require.NoError(t, repo.SaveSourceObservation(context.Background(), 7, observation))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListPriceChangesUsesBoundedDefaultAndStableOrdering(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now().UTC()
	mock.ExpectQuery(regexp.QuoteMeta(`
SELECT c.id,c.source_id,COALESCE(NULLIF(c.source_name_snapshot,''),s.name),c.group_external_id,
	COALESCE(NULLIF(c.group_name_snapshot,''),g.name,c.group_external_id),
	c.platform,c.model,c.component,
	c.previous_value,c.next_value,c.change_kind,c.observed_at
FROM watch_price_changes c
JOIN watch_sources s ON s.id=c.source_id
LEFT JOIN watch_source_groups g ON g.source_id=c.source_id AND g.external_id=c.group_external_id
WHERE ($1::BIGINT = 0 OR c.source_id = $1::BIGINT)
  AND ($2::TEXT = '' OR c.group_external_id = $2::TEXT)
  AND ($3::TEXT = '' OR $3::TEXT = 'all' OR c.change_kind = $3::TEXT)
  AND ($4::TEXT = '' OR LOWER(c.platform) = LOWER($4::TEXT))
  AND ($5::TEXT = '' OR LOWER(c.model) = LOWER($5::TEXT))
  AND ($6::TEXT = '' OR c.component = $6::TEXT)
  AND ($7::BIGINT = 0 OR c.id > $7::BIGINT)
ORDER BY
	CASE WHEN $7::BIGINT > 0 THEN c.id END ASC,
	CASE WHEN $7::BIGINT = 0 THEN c.observed_at END DESC,
	CASE WHEN $7::BIGINT = 0 THEN c.id END DESC
LIMIT $8`)).
		WithArgs(int64(0), "", "", "", "", "", int64(0), 100).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_id", "source_name", "group_external_id", "group_name", "platform", "model", "component",
			"previous_value", "next_value", "change_kind", "observed_at",
		}).AddRow(11, 7, "Source A", "group-a", "Group A", "openai", "gpt-test", "input", 0.4, 0.5, "increase", now))

	repo := &watchSourceRepository{db: db}
	changes, err := repo.ListPriceChanges(context.Background(), 0)
	require.NoError(t, err)
	require.Len(t, changes, 1)
	require.Equal(t, int64(11), changes[0].ID)
	require.Equal(t, "Source A", changes[0].SourceName)
	require.Equal(t, 0.4, changes[0].PreviousValue)
	require.Equal(t, 0.5, changes[0].NextValue)
	require.Equal(t, "increase", changes[0].ChangeKind)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetOperationsUsageSummaryEstimatesRevenueCostAndMargin(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	start := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(7 * 24 * time.Hour)
	mock.ExpectQuery(`WITH usage_scope AS \(`).
		WithArgs(start, end).
		WillReturnRows(sqlmock.NewRows([]string{
			"request_count", "revenue", "estimated_upstream_cost", "loss_request_count", "unresolved_request_count", "account_count", "group_count",
		}).AddRow(12, 1.5, 1.0, 2, 5, 3, 4))

	repo := &watchSourceRepository{db: db}
	summary, err := repo.GetOperationsUsageSummary(context.Background(), start, end)
	require.NoError(t, err)
	require.Equal(t, int64(12), summary.RequestCount)
	require.Equal(t, 1.5, summary.Revenue)
	require.Equal(t, 1.0, summary.EstimatedUpstreamCost)
	require.Equal(t, 0.5, summary.GrossProfit)
	require.NotNil(t, summary.GrossMargin)
	require.InDelta(t, 1.0/3.0, *summary.GrossMargin, 0.000000001)
	require.Equal(t, int64(2), summary.LossRequestCount)
	require.Equal(t, int64(5), summary.UnresolvedRequestCount)
	require.Equal(t, int64(3), summary.AccountCount)
	require.Equal(t, int64(4), summary.GroupCount)
	require.NoError(t, mock.ExpectationsWereMet())
}
