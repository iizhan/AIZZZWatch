package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type watchCompensationRepoStub struct {
	*watchPreviewSourceRepo
	applyCalls int
	applyInput WatchRateCompensationApplyInput
	result     *WatchRateCompensationApplyResult
	err        error
}

func (r *watchCompensationRepoStub) ApplyWatchRateCompensation(_ context.Context, _ int64, input WatchRateCompensationApplyInput, _ int64, _ time.Time) (*WatchRateCompensationApplyResult, error) {
	r.applyCalls++
	r.applyInput = input
	return r.result, r.err
}

type watchCompensationCacheStub struct {
	userIDs []int64
	err     error
}

func (c *watchCompensationCacheStub) InvalidateUserBalance(_ context.Context, userID int64) error {
	c.userIDs = append(c.userIDs, userID)
	return c.err
}

func newWatchCompensationService(repo *watchCompensationRepoStub, cache WatchBalanceCacheInvalidator) *WatchService {
	service := NewWatchService(nil, nil, nil, repo, nil, nil)
	service.SetCompensationCache(cache)
	return service
}

func validWatchCompensationInput() WatchRateCompensationApplyInput {
	return WatchRateCompensationApplyInput{
		UserIDs:        []int64{25},
		Confirmed:      true,
		IdempotencyKey: "watch-rate-comp:test-25",
		Reason:         "verified rate difference",
	}
}

func TestApplyRateCompensationRequiresExplicitUserSelection(t *testing.T) {
	repo := &watchCompensationRepoStub{watchPreviewSourceRepo: &watchPreviewSourceRepo{}}
	service := newWatchCompensationService(repo, nil)

	for _, userIDs := range [][]int64{nil, {}, {0}, {-1}} {
		input := validWatchCompensationInput()
		input.UserIDs = userIDs
		_, err := service.ApplyRateCompensation(context.Background(), 7, input, 1)
		if !errors.Is(err, ErrWatchRateCompensationSelectionRequired) {
			t.Fatalf("user_ids=%v error=%v, want selection required", userIDs, err)
		}
	}
	if repo.applyCalls != 0 {
		t.Fatalf("repository apply calls = %d, want 0", repo.applyCalls)
	}
}

func TestApplyRateCompensationInvalidatesOnlyAppliedUserBalances(t *testing.T) {
	repo := &watchCompensationRepoStub{
		watchPreviewSourceRepo: &watchPreviewSourceRepo{},
		result: &WatchRateCompensationApplyResult{
			AnomalyID:      7,
			AppliedUserIDs: []int64{25, 31},
			SkippedUserIDs: []int64{44},
			AppliedCount:   2,
		},
	}
	cache := &watchCompensationCacheStub{}
	service := newWatchCompensationService(repo, cache)
	input := validWatchCompensationInput()
	input.UserIDs = []int64{25, 31, 44}

	result, err := service.ApplyRateCompensation(context.Background(), 7, input, 1)
	if err != nil {
		t.Fatalf("apply compensation: %v", err)
	}
	if result.AppliedCount != 2 {
		t.Fatalf("applied count = %d, want 2", result.AppliedCount)
	}
	if repo.applyCalls != 1 || !reflect.DeepEqual(repo.applyInput.UserIDs, input.UserIDs) {
		t.Fatalf("repository input = %+v, calls=%d", repo.applyInput, repo.applyCalls)
	}
	if !reflect.DeepEqual(cache.userIDs, []int64{25, 31}) {
		t.Fatalf("invalidated users = %v, want [25 31]", cache.userIDs)
	}
}

func TestApplyRateCompensationDoesNotTurnCacheFailureIntoDuplicatePayout(t *testing.T) {
	repo := &watchCompensationRepoStub{
		watchPreviewSourceRepo: &watchPreviewSourceRepo{},
		result:                 &WatchRateCompensationApplyResult{AnomalyID: 7, AppliedUserIDs: []int64{25}, AppliedCount: 1},
	}
	cache := &watchCompensationCacheStub{err: errors.New("cache unavailable")}
	service := newWatchCompensationService(repo, cache)

	result, err := service.ApplyRateCompensation(context.Background(), 7, validWatchCompensationInput(), 1)
	if err != nil {
		t.Fatalf("cache invalidation must not roll back an already committed compensation: %v", err)
	}
	if result.AppliedCount != 1 || repo.applyCalls != 1 {
		t.Fatalf("result=%+v calls=%d", result, repo.applyCalls)
	}
}
