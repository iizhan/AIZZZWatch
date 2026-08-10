//go:build integration

package repository

import (
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

func (s *UserRepoSuite) TestApplyAdminRechargeTracksPrincipalBonusAndIdempotency() {
	user := s.mustCreateUser(&service.User{
		Email:   fmt.Sprintf("admin-recharge-%d@example.com", time.Now().UnixNano()),
		Balance: 10,
	})
	keyHash := service.HashIdempotencyKey(fmt.Sprintf("admin-recharge-%d", time.Now().UnixNano()))
	command := service.AdminRechargeCommand{
		UserID:             user.ID,
		PrincipalAmount:    100,
		BonusAmount:        20,
		Notes:              "campaign",
		ActorAdminID:       17,
		IdempotencyKeyHash: keyHash,
		RedeemCode:         fmt.Sprintf("AR%030d", time.Now().UnixNano())[:32],
	}

	result, err := s.repo.ApplyAdminRecharge(s.ctx, command)
	s.Require().NoError(err)
	s.False(result.Replayed)
	s.Equal(10.0, result.Balance.Old)
	s.Equal(130.0, result.Balance.New)

	updated, err := s.repo.GetByID(s.ctx, user.ID)
	s.Require().NoError(err)
	s.Equal(130.0, updated.Balance)
	s.Equal(100.0, updated.TotalRecharged)

	var principal, bonus, auditValue float64
	s.Require().NoError(integrationDB.QueryRowContext(s.ctx, `
		SELECT admin_principal_amount::double precision,
			admin_bonus_amount::double precision,
			value::double precision
		FROM redeem_codes WHERE id=$1
	`, result.AdjustmentID).Scan(&principal, &bonus, &auditValue))
	s.Equal(100.0, principal)
	s.Equal(20.0, bonus)
	s.Equal(120.0, auditValue)
	redeemRepo := &redeemCodeRepository{client: s.client}
	totalRecharged, err := redeemRepo.SumPositiveBalanceByUser(s.ctx, user.ID)
	s.Require().NoError(err)
	s.Equal(100.0, totalRecharged, "administrator bonus must not inflate cumulative recharge")

	var lotPrincipal, lotBonus, remainingPrincipal, remainingBonus float64
	s.Require().NoError(integrationDB.QueryRowContext(s.ctx, `
		SELECT principal_amount::double precision, bonus_amount::double precision,
			remaining_principal::double precision, remaining_bonus::double precision
		FROM balance_source_lots
		WHERE source_type='admin_recharge' AND source_id=$1
	`, result.AdjustmentID).Scan(&lotPrincipal, &lotBonus, &remainingPrincipal, &remainingBonus))
	s.Equal(100.0, lotPrincipal)
	s.Equal(20.0, lotBonus)
	s.Equal(100.0, remainingPrincipal)
	s.Equal(20.0, remainingBonus)

	replayCommand := command
	replayCommand.RedeemCode = fmt.Sprintf("AR%030d", time.Now().UnixNano()+1)[:32]
	replayed, err := s.repo.ApplyAdminRecharge(s.ctx, replayCommand)
	s.Require().NoError(err)
	s.True(replayed.Replayed)
	s.Equal(result.AdjustmentID, replayed.AdjustmentID)

	updated, err = s.repo.GetByID(s.ctx, user.ID)
	s.Require().NoError(err)
	s.Equal(130.0, updated.Balance, "the same idempotency key must not credit twice")
	s.Equal(100.0, updated.TotalRecharged)

	conflictCommand := command
	conflictCommand.BonusAmount = 21
	_, err = s.repo.ApplyAdminRecharge(s.ctx, conflictCommand)
	s.ErrorIs(err, service.ErrAdminRechargeIdempotencyConflict)

	_, _ = integrationDB.ExecContext(s.ctx, "DELETE FROM users WHERE id=$1", user.ID)
	_, _ = integrationDB.ExecContext(s.ctx, "DELETE FROM redeem_codes WHERE id=$1", result.AdjustmentID)
}
