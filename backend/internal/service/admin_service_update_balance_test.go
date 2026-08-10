//go:build unit

package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type balanceUserRepoStub struct {
	*userRepoStub
	adjustErr error
	// changes 记录每次原子余额变更，顺序与调用顺序一致。
	changes        []BalanceChange
	adminRecharges []AdminRechargeCommand
	replayRecharge bool
}

func (s *balanceUserRepoStub) AdjustBalance(ctx context.Context, id int64, delta float64) (BalanceChange, error) {
	return s.apply(func(current float64) float64 { return current + delta })
}

func (s *balanceUserRepoStub) SetBalance(ctx context.Context, id int64, value float64) (BalanceChange, error) {
	return s.apply(func(float64) float64 { return value })
}

func (s *balanceUserRepoStub) ApplyAdminRecharge(_ context.Context, command AdminRechargeCommand) (AdminRechargeResult, error) {
	if s.adjustErr != nil {
		return AdminRechargeResult{}, s.adjustErr
	}
	if s.replayRecharge {
		current := s.userRepoStub.user.Balance
		return AdminRechargeResult{
			AdjustmentID: 1,
			Balance: BalanceChange{
				Old: current - command.PrincipalAmount - command.BonusAmount,
				New: current,
			},
			Replayed: true,
		}, nil
	}
	change, err := s.apply(func(current float64) float64 {
		return current + command.PrincipalAmount + command.BonusAmount
	})
	if err != nil {
		return AdminRechargeResult{}, err
	}
	s.adminRecharges = append(s.adminRecharges, command)
	return AdminRechargeResult{AdjustmentID: int64(len(s.adminRecharges)), Balance: change}, nil
}

func adminBalanceInput(amount float64, operation string) AdminBalanceUpdateInput {
	return AdminBalanceUpdateInput{Balance: amount, Operation: operation}
}

func (s *balanceUserRepoStub) apply(next func(current float64) float64) (BalanceChange, error) {
	if s.adjustErr != nil {
		return BalanceChange{}, s.adjustErr
	}
	if s.userRepoStub == nil || s.userRepoStub.user == nil {
		return BalanceChange{}, ErrUserNotFound
	}
	change := BalanceChange{Old: s.userRepoStub.user.Balance}
	change.New = next(change.Old)
	if change.New < 0 {
		return change, ErrBalanceNegative
	}
	s.userRepoStub.user.Balance = change.New
	s.changes = append(s.changes, change)
	return change, nil
}

type balanceRedeemRepoStub struct {
	*redeemRepoStub
	created []*RedeemCode
}

func (s *balanceRedeemRepoStub) Create(ctx context.Context, code *RedeemCode) error {
	if code == nil {
		return nil
	}
	clone := *code
	s.created = append(s.created, &clone)
	return nil
}

type authCacheInvalidatorStub struct {
	userIDs  []int64
	groupIDs []int64
	keys     []string
}

type adminRechargeAffiliateAccruerStub struct {
	calls  []adminRechargeAffiliateAccrual
	rebate float64
	err    error
}

type adminRechargeAffiliateAccrual struct {
	userID int64
	amount float64
}

func (s *adminRechargeAffiliateAccruerStub) AccrueInviteRebate(_ context.Context, userID int64, amount float64) (float64, error) {
	s.calls = append(s.calls, adminRechargeAffiliateAccrual{userID: userID, amount: amount})
	return s.rebate, s.err
}

func adminRechargeSettingService(enabled bool) *SettingService {
	values := map[string]string{}
	if enabled {
		values[SettingKeyAffiliateAdminRechargeEnabled] = "true"
	}
	return NewSettingService(&settingRepoStub{values: values}, nil)
}

func (s *authCacheInvalidatorStub) InvalidateAuthCacheByKey(ctx context.Context, key string) {
	s.keys = append(s.keys, key)
}

func (s *authCacheInvalidatorStub) InvalidateAuthCacheByUserID(ctx context.Context, userID int64) {
	s.userIDs = append(s.userIDs, userID)
}

func (s *authCacheInvalidatorStub) InvalidateAuthCacheByGroupID(ctx context.Context, groupID int64) {
	s.groupIDs = append(s.groupIDs, groupID)
}

// 管理员调账必须走原子的 AdjustBalance/SetBalance，而不是"读余额→算新值→整行写回"，
// 后者会把并发的计费扣款覆盖掉。userRepoStub.Update 对未预期的调用会 panic，
// 因此这里同时证明它没被走到。
func TestAdminService_UpdateUserBalance_UsesAtomicPrimitives(t *testing.T) {
	tests := []struct {
		name      string
		operation string
		amount    float64
		want      BalanceChange
	}{
		{name: "add", operation: "add", amount: 5, want: BalanceChange{Old: 10, New: 15}},
		{name: "subtract", operation: "subtract", amount: 4, want: BalanceChange{Old: 10, New: 6}},
		{name: "set", operation: "set", amount: 2, want: BalanceChange{Old: 10, New: 2}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &balanceUserRepoStub{userRepoStub: &userRepoStub{user: &User{ID: 7, Balance: 10}}}
			svc := &adminServiceImpl{
				userRepo:       repo,
				redeemCodeRepo: &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}},
			}

			user, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(tt.amount, tt.operation))
			require.NoError(t, err)
			require.Equal(t, []BalanceChange{tt.want}, repo.changes)
			require.Equal(t, tt.want.New, user.Balance)
		})
	}
}

func TestAdminService_UpdateUserBalance_RejectsNegativeResult(t *testing.T) {
	repo := &balanceUserRepoStub{userRepoStub: &userRepoStub{user: &User{ID: 7, Balance: 3}}}
	svc := &adminServiceImpl{
		userRepo:       repo,
		redeemCodeRepo: &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}},
	}

	_, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(4, "subtract"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "balance cannot be negative")
	require.Empty(t, repo.changes, "refused adjustment must not be applied")
	require.Equal(t, 3.0, repo.userRepoStub.user.Balance)
}

func TestAdminService_UpdateUserBalance_RejectsUnknownOperation(t *testing.T) {
	repo := &balanceUserRepoStub{userRepoStub: &userRepoStub{user: &User{ID: 7, Balance: 10}}}
	svc := &adminServiceImpl{
		userRepo:       repo,
		redeemCodeRepo: &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}},
	}

	_, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(1, "multiply"))
	require.Error(t, err)
	require.Empty(t, repo.changes)
}

func TestAdminService_UpdateUserBalance_InvalidatesAuthCache(t *testing.T) {
	baseRepo := &userRepoStub{user: &User{ID: 7, Balance: 10}}
	repo := &balanceUserRepoStub{userRepoStub: baseRepo}
	redeemRepo := &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}}
	invalidator := &authCacheInvalidatorStub{}
	svc := &adminServiceImpl{
		userRepo:             repo,
		redeemCodeRepo:       redeemRepo,
		authCacheInvalidator: invalidator,
	}

	_, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(5, "add"))
	require.NoError(t, err)
	require.Equal(t, []int64{7}, invalidator.userIDs)
	require.Len(t, repo.adminRecharges, 1)
	require.Empty(t, redeemRepo.created, "the repository transaction owns add-operation audit records")
}

func TestAdminService_UpdateUserBalance_NoChangeNoInvalidate(t *testing.T) {
	baseRepo := &userRepoStub{user: &User{ID: 7, Balance: 10}}
	repo := &balanceUserRepoStub{userRepoStub: baseRepo}
	redeemRepo := &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}}
	invalidator := &authCacheInvalidatorStub{}
	svc := &adminServiceImpl{
		userRepo:             repo,
		redeemCodeRepo:       redeemRepo,
		authCacheInvalidator: invalidator,
	}

	_, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(10, "set"))
	require.NoError(t, err)
	require.Empty(t, invalidator.userIDs)
	require.Empty(t, redeemRepo.created)
}

func TestAdminService_UpdateUserBalance_AdminRechargeAffiliateRebate(t *testing.T) {
	tests := []struct {
		name      string
		enabled   bool
		operation string
		amount    float64
		wantCalls []adminRechargeAffiliateAccrual
	}{
		{
			name:      "disabled by default",
			operation: "add",
			amount:    5,
		},
		{
			name:      "enabled add",
			enabled:   true,
			operation: "add",
			amount:    0.1,
			wantCalls: []adminRechargeAffiliateAccrual{{userID: 7, amount: 0.1}},
		},
		{
			name:      "enabled set increase",
			enabled:   true,
			operation: "set",
			amount:    15,
		},
		{
			name:      "enabled subtract",
			enabled:   true,
			operation: "subtract",
			amount:    5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseRepo := &userRepoStub{user: &User{ID: 7, Balance: 10}}
			repo := &balanceUserRepoStub{userRepoStub: baseRepo}
			redeemRepo := &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}}
			affiliate := &adminRechargeAffiliateAccruerStub{}
			svc := &adminServiceImpl{
				userRepo:         repo,
				redeemCodeRepo:   redeemRepo,
				settingService:   adminRechargeSettingService(tt.enabled),
				affiliateService: affiliate,
			}

			_, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(tt.amount, tt.operation))
			require.NoError(t, err)
			require.Equal(t, tt.wantCalls, affiliate.calls)
		})
	}
}

func TestAdminService_UpdateUserBalance_AffiliateFailureDoesNotRollbackRecharge(t *testing.T) {
	baseRepo := &userRepoStub{user: &User{ID: 7, Balance: 10}}
	repo := &balanceUserRepoStub{userRepoStub: baseRepo}
	redeemRepo := &balanceRedeemRepoStub{redeemRepoStub: &redeemRepoStub{}}
	affiliate := &adminRechargeAffiliateAccruerStub{err: errors.New("affiliate unavailable")}
	svc := &adminServiceImpl{
		userRepo:         repo,
		redeemCodeRepo:   redeemRepo,
		settingService:   adminRechargeSettingService(true),
		affiliateService: affiliate,
	}

	user, err := svc.UpdateUserBalance(context.Background(), 7, adminBalanceInput(5, "add"))
	require.NoError(t, err)
	require.Equal(t, 15.0, user.Balance)
	require.Equal(t, []adminRechargeAffiliateAccrual{{userID: 7, amount: 5}}, affiliate.calls)
	require.Len(t, repo.adminRecharges, 1)
	require.Empty(t, redeemRepo.created)
}

func TestAdminService_UpdateUserBalance_AddsPrincipalAndBonus(t *testing.T) {
	repo := &balanceUserRepoStub{userRepoStub: &userRepoStub{user: &User{ID: 7, Balance: 10}}}
	affiliate := &adminRechargeAffiliateAccruerStub{}
	svc := &adminServiceImpl{
		userRepo:          repo,
		adminRechargeRepo: repo,
		settingService:    adminRechargeSettingService(true),
		affiliateService:  affiliate,
	}

	user, err := svc.UpdateUserBalance(context.Background(), 7, AdminBalanceUpdateInput{
		Balance:            100,
		BonusAmount:        20,
		Operation:          "add",
		Notes:              " campaign ",
		ActorAdminID:       3,
		IdempotencyKeyHash: "key-hash",
	})
	require.NoError(t, err)
	require.Equal(t, 130.0, user.Balance)
	require.Len(t, repo.adminRecharges, 1)
	require.Equal(t, 100.0, repo.adminRecharges[0].PrincipalAmount)
	require.Equal(t, 20.0, repo.adminRecharges[0].BonusAmount)
	require.Equal(t, "campaign", repo.adminRecharges[0].Notes)
	require.Equal(t, []adminRechargeAffiliateAccrual{{userID: 7, amount: 100}}, affiliate.calls)
}

func TestAdminService_UpdateUserBalance_ValidatesBonus(t *testing.T) {
	repo := &balanceUserRepoStub{userRepoStub: &userRepoStub{user: &User{ID: 7, Balance: 10}}}
	svc := &adminServiceImpl{userRepo: repo, adminRechargeRepo: repo}

	_, err := svc.UpdateUserBalance(context.Background(), 7, AdminBalanceUpdateInput{
		Balance: 5, BonusAmount: -1, Operation: "add",
	})
	require.ErrorIs(t, err, ErrAdminRechargeBonusInvalid)

	_, err = svc.UpdateUserBalance(context.Background(), 7, AdminBalanceUpdateInput{
		Balance: 5, BonusAmount: 1, Operation: "subtract",
	})
	require.ErrorIs(t, err, ErrAdminRechargeBonusOperationInvalid)
	require.Empty(t, repo.adminRecharges)
}

func TestAdminService_UpdateUserBalance_DoesNotRepeatAffiliateRebateOnReplay(t *testing.T) {
	repo := &balanceUserRepoStub{
		userRepoStub:   &userRepoStub{user: &User{ID: 7, Balance: 130}},
		replayRecharge: true,
	}
	affiliate := &adminRechargeAffiliateAccruerStub{}
	svc := &adminServiceImpl{
		userRepo:          repo,
		adminRechargeRepo: repo,
		settingService:    adminRechargeSettingService(true),
		affiliateService:  affiliate,
	}

	_, err := svc.UpdateUserBalance(context.Background(), 7, AdminBalanceUpdateInput{
		Balance: 100, BonusAmount: 20, Operation: "add", IdempotencyKeyHash: "replayed-key",
	})
	require.NoError(t, err)
	require.Empty(t, affiliate.calls)
}
