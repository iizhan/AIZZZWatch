package service

import (
	"context"
	"database/sql/driver"
	"errors"
	"regexp"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	dbent "github.com/Wei-Shaw/sub2api/ent"
)

type timeBetween struct {
	min time.Time
	max time.Time
}

func (m timeBetween) Match(value driver.Value) bool {
	actual, ok := value.(time.Time)
	return ok && !actual.Before(m.min) && !actual.After(m.max)
}

func newRecommendationTestService(t *testing.T) (*RecommendationService, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	client := dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	t.Cleanup(func() {
		_ = client.Close()
	})
	return NewRecommendationService(client, nil), mock
}

func expectRecommendationGet(mock sqlmock.Sqlmock, id, userID int64, rewardType string, rewardAmount float64, expiresAt *time.Time) {
	now := time.Now().UTC()
	sharePercent, capAmount := RecommendationDefaultShareRate, RecommendationDefaultCap
	if rewardType == RecommendationRewardOneTime {
		sharePercent, capAmount = 0, 0
	}
	mock.ExpectQuery(`SELECT id,user_id,site_url,model_key,submitted_multiplier,requested_reward_type`).
		WithArgs(id, userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "site_url", "model_key", "submitted_multiplier", "requested_reward_type", "note", "status", "decision_reason", "adopted_at", "created_at"}).
			AddRow(id, userID, "https://example.com", "claude", 0.05, RecommendationRewardProfitShare, "", "adopted", "accepted", now, now))
	mock.ExpectQuery(`SELECT id,recommendation_id,reward_type,amount,share_percent,cap_amount,expires_at,transferred_amount`).
		WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"id", "recommendation_id", "reward_type", "amount", "share_percent", "cap_amount", "expires_at", "transferred_amount", "admin_note"}).
			AddRow(int64(88), id, rewardType, rewardAmount, sharePercent, capAmount, expiresAt, rewardAmount, ""))
}

func TestNormalizeRecommendationURLRejectsCredentials(t *testing.T) {
	_, err := normalizeRecommendationURL("https://user:secret@example.com/path")
	require.Error(t, err)

	normalized, err := normalizeRecommendationURL(" https://Example.com/path/?invite=private#private ")
	require.NoError(t, err)
	require.Equal(t, "https://Example.com", normalized)
}

func TestRecommendationDecideRequiresReasonBeforeDatabaseAccess(t *testing.T) {
	service := &RecommendationService{}
	_, err := service.Decide(context.Background(), 1, 7, false, " ", "", 0, 0, 0, nil, "")
	require.Error(t, err)
}

func TestRecommendationDecideRequiresExplanationWhenRewardTypeChanges(t *testing.T) {
	service, mock := newRecommendationTestService(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id,requested_reward_type,status,site_url FROM user_recommendations`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "requested_reward_type", "status", "site_url"}).
			AddRow(int64(42), RecommendationRewardProfitShare, "pending", "https://example.com"))
	mock.ExpectRollback()

	_, err := service.Decide(context.Background(), 9, 7, true, "accepted", RecommendationRewardOneTime, 5, 0, 0, nil, "")
	require.Error(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecommendationDecideOneTimeRewardCreditsBalanceOnce(t *testing.T) {
	service, mock := newRecommendationTestService(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id,requested_reward_type,status,site_url FROM user_recommendations`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "requested_reward_type", "status", "site_url"}).
			AddRow(int64(42), RecommendationRewardProfitShare, "pending", "https://example.com"))
	mock.ExpectExec(`UPDATE user_recommendations SET status='adopted'`).
		WithArgs("accepted", int64(9), nil, int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`INSERT INTO recommendation_rewards`).
		WithArgs(int64(7), int64(42), RecommendationRewardOneTime, 5.0, 0.0, 0.0, nil, 5.0, "changed to a one-time reward", "recommendation:7:reward", int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(88)))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE id=$2`)).
		WithArgs(5.0, int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO balance_source_lots`).
		WithArgs(int64(42), int64(88), 5.0).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	expectRecommendationGet(mock, 7, 42, RecommendationRewardOneTime, 5, nil)

	item, err := service.Decide(context.Background(), 9, 7, true, "accepted", RecommendationRewardOneTime, 5, 0, 0, nil, "changed to a one-time reward")
	require.NoError(t, err)
	require.NotNil(t, item.Reward)
	require.Equal(t, RecommendationRewardOneTime, item.Reward.RewardType)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecommendationDecideFixesProfitShareToOnePercentForNinetyDays(t *testing.T) {
	service, mock := newRecommendationTestService(t)
	now := time.Now().UTC()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id,requested_reward_type,status,site_url FROM user_recommendations`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "requested_reward_type", "status", "site_url"}).
			AddRow(int64(42), RecommendationRewardProfitShare, "pending", "https://example.com"))
	mock.ExpectQuery(`SELECT id,base_url FROM watch_sources`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "base_url"}).AddRow(int64(3), "https://example.com/api"))
	mock.ExpectExec(`UPDATE user_recommendations SET status='adopted'`).
		WithArgs("accepted", int64(9), int64(3), int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`INSERT INTO recommendation_rewards`).
		WithArgs(int64(7), int64(42), RecommendationRewardProfitShare, 0.0, 1.0, 100.0,
			timeBetween{min: now.AddDate(0, 0, 89), max: now.AddDate(0, 0, 91)}, 0.0, "", "recommendation:7:reward", int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(88)))
	mock.ExpectCommit()
	expiresAt := now.AddDate(0, 0, RecommendationDefaultShareDays)
	expectRecommendationGet(mock, 7, 42, RecommendationRewardProfitShare, 0, &expiresAt)

	requestedExpiry := now.AddDate(1, 0, 0)
	item, err := service.Decide(context.Background(), 9, 7, true, "accepted", RecommendationRewardProfitShare, 50, 80, 1000, &requestedExpiry, "")
	require.NoError(t, err)
	require.NotNil(t, item.Reward)
	require.InDelta(t, 1, item.Reward.SharePercent, 0.000001)
	require.NotNil(t, item.Reward.ExpiresAt)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRefreshProfitSharesUsesObservationDelayAndRemainingCap(t *testing.T) {
	service, mock := newRecommendationTestService(t)
	adoptedAt := time.Now().UTC().Add(-72 * time.Hour)
	expiresAt := adoptedAt.AddDate(0, 0, RecommendationDefaultShareDays)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT r.id,ur.adopted_source_id,r.share_percent,r.cap_amount,r.amount,ur.adopted_at,r.expires_at`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "source_id", "share_percent", "cap_amount", "amount", "adopted_at", "expires_at"}).
			AddRow(int64(88), int64(3), 1.0, 100.0, 99.75, adoptedAt, expiresAt))
	mock.ExpectQuery(`(?s)WITH candidates AS .*watch_account_upstream_mapping_history.*watch_source_group_history.*NOW\(\)-INTERVAL '24 hours'.*LEAST\(raw_reward,GREATEST\(\$6-prior_reward,0\)\)`).
		WithArgs(int64(88), 1.0, int64(3), adoptedAt, &expiresAt, 0.25, int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"reward_amount"}).AddRow(0.25))
	mock.ExpectExec(`UPDATE recommendation_rewards SET amount=LEAST`).
		WithArgs(0.25, int64(88)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, service.RefreshProfitShares(context.Background(), 42))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecommendationTransferAllowsAccruedBalanceAfterEarningWindowExpires(t *testing.T) {
	service, mock := newRecommendationTestService(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT r.id,ur.adopted_source_id,r.share_percent,r.cap_amount,r.amount,ur.adopted_at,r.expires_at`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "source_id", "share_percent", "cap_amount", "amount", "adopted_at", "expires_at"}))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, GREATEST\(amount-transferred_amount,0\) FROM recommendation_rewards WHERE user_id=\$1 AND reward_type='profit_share' AND amount>transferred_amount FOR UPDATE`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "available"}).AddRow(int64(88), 1.25))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE id=$2`)).
		WithArgs(1.25, int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE recommendation_rewards SET transferred_amount=transferred_amount`).
		WithArgs(1.25, int64(88)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO balance_source_lots`).
		WithArgs(int64(42), int64(88), 1.25).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	amount, err := service.Transfer(context.Background(), 42)
	require.NoError(t, err)
	require.InDelta(t, 1.25, amount, 0.000001)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecommendationSecondDecisionDoesNotCreateAnotherReward(t *testing.T) {
	service, mock := newRecommendationTestService(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id,requested_reward_type,status,site_url FROM user_recommendations`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "requested_reward_type", "status", "site_url"}).
			AddRow(int64(42), RecommendationRewardProfitShare, "adopted", "https://example.com"))
	mock.ExpectRollback()

	_, err := service.Decide(context.Background(), 9, 7, true, "accepted", RecommendationRewardProfitShare, 0, 1, 100, nil, "")
	require.Error(t, err)
	require.False(t, errors.Is(err, nil))
	require.NoError(t, mock.ExpectationsWereMet())
}
