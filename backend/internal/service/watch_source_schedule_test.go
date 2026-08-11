package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

type watchSourceScheduleRepoStub struct {
	WatchSourceRepository
	claimed []*WatchSource
	limit   int
	err     error
}

func (r *watchSourceScheduleRepoStub) ClaimDueSources(_ context.Context, _ time.Time, limit int) ([]*WatchSource, error) {
	r.limit = limit
	return r.claimed, r.err
}

func (r *watchSourceScheduleRepoStub) GetSource(_ context.Context, _ int64) (*WatchSource, error) {
	return nil, ErrWatchSourceNotFound
}

func TestWatchSourceDiagnosticIntervalUsesPermanentAuthBackoff(t *testing.T) {
	for _, code := range []string{"unauthorized", "credential_missing", "credential_invalid", "credential_decrypt_failed"} {
		if got := WatchSourceDiagnosticIntervalSeconds(300, code); got != 900 {
			t.Fatalf("interval for %q = %d, want 900", code, got)
		}
	}
	if got := WatchSourceDiagnosticIntervalSeconds(300, "upstream_error"); got != 300 {
		t.Fatalf("transient interval = %d, want 300", got)
	}
	if got := WatchSourceDiagnosticIntervalSeconds(1200, "unauthorized"); got != 1200 {
		t.Fatalf("configured longer interval = %d, want 1200", got)
	}
}

func TestHydrateWatchSourceDiagnosticStateUsesAuthBackoffCountdown(t *testing.T) {
	now := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	lastCheck := now.Add(-5 * time.Minute)
	source := &WatchSource{
		Enabled: true, PollingIntervalSeconds: 300, LastCheckAt: &lastCheck,
		LastCheckStatus: "error", LastErrorCode: "unauthorized",
	}

	HydrateWatchSourceDiagnosticState(source, now)

	if source.NextCheckInSeconds != 600 || source.CheckDue {
		t.Fatalf("diagnostic state = %#v, want 600 second auth backoff", source)
	}
}

func TestWatchSourceMarkedDueRunsBeforeRepositorySchedule(t *testing.T) {
	repo := &watchSourceScheduleRepoStub{claimed: []*WatchSource{{ID: 9}}}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	if err := svc.MarkCheckDue(context.Background(), 7); err != nil {
		t.Fatalf("MarkCheckDue() error = %v", err)
	}

	ids, err := svc.DueSourceIDs(context.Background(), 2)
	if err != nil {
		t.Fatalf("DueSourceIDs() error = %v", err)
	}
	if len(ids) != 2 || ids[0] != 7 || ids[1] != 9 {
		t.Fatalf("DueSourceIDs() = %v, want [7 9]", ids)
	}
	if repo.limit != 1 {
		t.Fatalf("repository limit = %d, want remaining capacity 1", repo.limit)
	}

	ids, err = svc.DueSourceIDs(context.Background(), 2)
	if err != nil {
		t.Fatalf("second DueSourceIDs() error = %v", err)
	}
	if len(ids) != 1 || ids[0] != 9 {
		t.Fatalf("second DueSourceIDs() = %v, want marker consumed once", ids)
	}
}

func TestWatchSourceRunnerRequeuesMarkedDueSourcesWhenWorkerPoolIsFull(t *testing.T) {
	repo := &watchSourceScheduleRepoStub{}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	for _, id := range []int64{7, 8} {
		if err := svc.MarkCheckDue(context.Background(), id); err != nil {
			t.Fatalf("MarkCheckDue(%d) error = %v", id, err)
		}
	}

	runner := NewWatchSourceRunner(svc)
	for range watchSourceRunnerConcurrency {
		runner.sem <- struct{}{}
	}
	runner.scanDiagnostics()

	ids := svc.takeMarkedDueSourceIDs(2)
	if len(ids) != 2 {
		t.Fatalf("requeued ids = %v, want both marked sources", ids)
	}
	seen := map[int64]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if !seen[7] || !seen[8] {
		t.Fatalf("requeued ids = %v, want sources 7 and 8", ids)
	}
}

func TestWatchSourceMarkedDueIsRestoredWhenRepositoryScheduleFails(t *testing.T) {
	repo := &watchSourceScheduleRepoStub{err: errors.New("database unavailable")}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	if err := svc.MarkCheckDue(context.Background(), 7); err != nil {
		t.Fatalf("MarkCheckDue() error = %v", err)
	}

	if _, err := svc.DueSourceIDs(context.Background(), 2); err == nil {
		t.Fatal("DueSourceIDs() error = nil, want repository error")
	}
	ids := svc.takeMarkedDueSourceIDs(2)
	if len(ids) != 1 || ids[0] != 7 {
		t.Fatalf("restored ids = %v, want [7]", ids)
	}
}

func TestWatchSourceRunnerDoesNotRequeueDeletedSource(t *testing.T) {
	svc := NewWatchSourceService(&watchSourceScheduleRepoStub{}, watchSourceAuthTestEncryptor{})
	runner := NewWatchSourceRunner(svc)
	runner.sem <- struct{}{}
	runner.wg.Add(1)

	runner.runOne(7)

	if ids := svc.takeMarkedDueSourceIDs(1); len(ids) != 0 {
		t.Fatalf("requeued ids = %v, want deleted source omitted", ids)
	}
}
