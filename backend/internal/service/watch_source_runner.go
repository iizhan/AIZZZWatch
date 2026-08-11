package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

const (
	watchSourceRunnerScanInterval = 10 * time.Second
	watchSourceRunnerConcurrency  = 4
	watchSourceRunnerBatchSize    = 20
)

type WatchSourceRunner struct {
	service *WatchSourceService
	ctx     context.Context
	cancel  context.CancelFunc
	sem     chan struct{}

	mu      sync.Mutex
	started bool
	stopped bool
	wg      sync.WaitGroup
}

func NewWatchSourceRunner(service *WatchSourceService) *WatchSourceRunner {
	ctx, cancel := context.WithCancel(context.Background())
	return &WatchSourceRunner{
		service: service,
		ctx:     ctx,
		cancel:  cancel,
		sem:     make(chan struct{}, watchSourceRunnerConcurrency),
	}
}

func (r *WatchSourceRunner) Start() {
	if r == nil || r.service == nil {
		return
	}
	r.mu.Lock()
	if r.started || r.stopped {
		r.mu.Unlock()
		return
	}
	r.started = true
	r.wg.Add(1)
	r.mu.Unlock()
	go r.loop()
}

func (r *WatchSourceRunner) Stop() {
	if r == nil {
		return
	}
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return
	}
	r.stopped = true
	r.cancel()
	r.mu.Unlock()
	r.wg.Wait()
}

func (r *WatchSourceRunner) loop() {
	defer r.wg.Done()
	r.scan()
	ticker := time.NewTicker(watchSourceRunnerScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.ctx.Done():
			return
		case <-ticker.C:
			r.scan()
		}
	}
}

func (r *WatchSourceRunner) scan() {
	r.scanKeepalives()
	r.scanDiagnostics()
}

func (r *WatchSourceRunner) scanKeepalives() {
	ctx, cancel := context.WithTimeout(r.ctx, 5*time.Second)
	ids, err := r.service.DueKeepaliveSourceIDs(ctx, watchSourceRunnerBatchSize)
	cancel()
	if err != nil {
		slog.Error("watch_source: list due keepalives failed", "error", err)
		return
	}
	for _, id := range ids {
		select {
		case <-r.ctx.Done():
			return
		case r.sem <- struct{}{}:
			r.wg.Add(1)
			go r.runOneKeepalive(id)
		default:
			slog.Debug("watch_source: worker pool full, defer keepalive", "source_id", id)
			return
		}
	}
}

func (r *WatchSourceRunner) scanDiagnostics() {
	ctx, cancel := context.WithTimeout(r.ctx, 5*time.Second)
	ids, err := r.service.DueSourceIDs(ctx, watchSourceRunnerBatchSize)
	cancel()
	if err != nil {
		slog.Error("watch_source: list due sources failed", "error", err)
		return
	}
	for index, id := range ids {
		select {
		case <-r.ctx.Done():
			return
		case r.sem <- struct{}{}:
			r.wg.Add(1)
			go r.runOne(id)
		default:
			for _, deferredID := range ids[index:] {
				_ = r.service.MarkCheckDue(r.ctx, deferredID)
			}
			slog.Debug("watch_source: worker pool full, defer source", "source_id", id)
			return
		}
	}
}

func (r *WatchSourceRunner) runOneKeepalive(id int64) {
	defer r.wg.Done()
	defer func() { <-r.sem }()
	if _, err := r.service.RunKeepalive(r.ctx, id); err != nil && r.ctx.Err() == nil {
		slog.Warn("watch_source: scheduled keepalive failed", "source_id", id, "error", err)
	}
}

func (r *WatchSourceRunner) runOne(id int64) {
	defer r.wg.Done()
	defer func() { <-r.sem }()
	if _, err := r.service.RunCheck(r.ctx, id); err != nil && r.ctx.Err() == nil {
		if !errors.Is(err, ErrWatchSourceNotFound) {
			_ = r.service.MarkCheckDue(r.ctx, id)
		}
		slog.Warn("watch_source: scheduled check failed", "source_id", id, "error", err)
	}
}
