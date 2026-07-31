package repository

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

func (r *watchSourceRepository) ListPricingBoardRows(ctx context.Context, filter service.WatchPricingBoardFilter) (*service.WatchPricingBoard, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT
	s.id,
	s.name,
	s.adapter_type,
	g.external_id,
	g.name,
	g.platform,
	g.rate_multiplier,
	g.user_rate_multiplier,
	s.recharge_ratio,
	g.observed_at,
	COALESCE(s.last_check_status, ''),
	COALESCE(s.last_error_code, ''),
	COALESCE(u.account_count, 0),
	COALESCE(c.change_kind, ''),
	c.previous_value,
	c.next_value,
	c.observed_at
FROM watch_sources s
JOIN watch_source_groups g ON g.source_id = s.id
LEFT JOIN LATERAL (
	SELECT COUNT(DISTINCT m.account_id)::BIGINT AS account_count
	FROM watch_account_upstream_mappings m
	JOIN accounts a ON a.id = m.account_id
	WHERE m.source_id = s.id
	  AND m.source_group_external_id = g.external_id
	  AND a.deleted_at IS NULL
	  AND a.status = 'active'
	  AND a.schedulable = TRUE
) u ON TRUE
LEFT JOIN LATERAL (
	SELECT change_kind, previous_value, next_value, observed_at
	FROM watch_price_changes
	WHERE source_id = s.id
	  AND group_external_id = g.external_id
	  AND component = 'group_multiplier'
	ORDER BY observed_at DESC, id DESC
	LIMIT 1
) c ON TRUE
ORDER BY s.name, g.platform, g.name, g.external_id`)
	if err != nil {
		return nil, fmt.Errorf("list watch pricing board rows: %w", err)
	}
	defer rows.Close()

	board := &service.WatchPricingBoard{GeneratedAt: time.Now().UTC(), Rows: []service.WatchPricingBoardRow{}}
	for rows.Next() {
		var row service.WatchPricingBoardRow
		var userRate sql.NullFloat64
		var previous, next sql.NullFloat64
		var changeAt sql.NullTime
		if err = rows.Scan(
			&row.SourceID,
			&row.SourceName,
			&row.AdapterType,
			&row.GroupExternalID,
			&row.GroupName,
			&row.Platform,
			&row.RateMultiplier,
			&userRate,
			&row.RechargeRatio,
			&row.ObservedAt,
			&row.SourceStatus,
			&row.SourceErrorCode,
			&row.InUseAccountCount,
			&row.ChangeKind,
			&previous,
			&next,
			&changeAt,
		); err != nil {
			return nil, fmt.Errorf("scan watch pricing board row: %w", err)
		}
		if userRate.Valid {
			row.UserRateMultiplier = &userRate.Float64
		}
		effective := row.RateMultiplier
		if row.UserRateMultiplier != nil {
			effective = *row.UserRateMultiplier
		}
		if row.RechargeRatio > 0 && !math.IsNaN(row.RechargeRatio) && !math.IsInf(row.RechargeRatio, 0) {
			row.FinalMultiplier = roundWatchRepoPrice(effective / row.RechargeRatio)
		}
		if previous.Valid {
			row.PreviousValue = &previous.Float64
		}
		if next.Valid {
			row.NextValue = &next.Float64
		}
		if changeAt.Valid {
			row.ChangeObservedAt = &changeAt.Time
		}
		row.InUse = row.InUseAccountCount > 0
		row.Tags = watchPricingBoardTags(row)
		if watchPricingBoardRowMatches(row, filter) {
			board.Rows = append(board.Rows, row)
		}
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate watch pricing board rows: %w", err)
	}
	if err = r.attachWatchPricingBoardModelPrices(ctx, board); err != nil {
		return nil, err
	}
	sortWatchPricingBoardRows(board.Rows, filter)
	return board, nil
}

func (r *watchSourceRepository) attachWatchPricingBoardModelPrices(ctx context.Context, board *service.WatchPricingBoard) error {
	if board == nil || len(board.Rows) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(board.Rows))
	for _, row := range board.Rows {
		allowed[watchPricingBoardGroupKey(row.SourceID, row.GroupExternalID)] = struct{}{}
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT source_id, group_external_id, platform, model, component, value, observed_at
FROM watch_source_prices
ORDER BY source_id, group_external_id, platform, model, component`)
	if err != nil {
		return fmt.Errorf("list watch pricing board model prices: %w", err)
	}
	defer rows.Close()

	type modelKey struct {
		sourceID int64
		groupID  string
		platform string
		model    string
	}
	prices := make(map[modelKey]*service.WatchPricingBoardModelPrice)
	for rows.Next() {
		var sourceID int64
		var groupID, platform, model, component string
		var value float64
		var observedAt time.Time
		if err = rows.Scan(&sourceID, &groupID, &platform, &model, &component, &value, &observedAt); err != nil {
			return fmt.Errorf("scan watch pricing board model price: %w", err)
		}
		if _, ok := allowed[watchPricingBoardGroupKey(sourceID, groupID)]; !ok {
			continue
		}
		key := modelKey{sourceID: sourceID, groupID: groupID, platform: platform, model: model}
		item := prices[key]
		if item == nil {
			item = &service.WatchPricingBoardModelPrice{Platform: platform, Model: model}
			prices[key] = item
		}
		valueCopy := value
		switch component {
		case string(service.WatchPriceComponentInput):
			item.InputPrice = &valueCopy
		case string(service.WatchPriceComponentOutput):
			item.OutputPrice = &valueCopy
		case string(service.WatchPriceComponentPerRequest):
			item.PerRequestPrice = &valueCopy
		}
		observedCopy := observedAt
		if item.ObservedAt == nil || observedAt.After(*item.ObservedAt) {
			item.ObservedAt = &observedCopy
		}
	}
	if err = rows.Err(); err != nil {
		return fmt.Errorf("iterate watch pricing board model prices: %w", err)
	}
	grouped := make(map[string][]service.WatchPricingBoardModelPrice)
	for key, price := range prices {
		groupKey := watchPricingBoardGroupKey(key.sourceID, key.groupID)
		grouped[groupKey] = append(grouped[groupKey], *price)
	}
	for index := range board.Rows {
		key := watchPricingBoardGroupKey(board.Rows[index].SourceID, board.Rows[index].GroupExternalID)
		items := grouped[key]
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].Platform != items[j].Platform {
				return items[i].Platform < items[j].Platform
			}
			return items[i].Model < items[j].Model
		})
		if len(items) > 12 {
			items = items[:12]
		}
		board.Rows[index].ModelPrices = items
	}
	return nil
}

func watchPricingBoardGroupKey(sourceID int64, groupID string) string {
	return fmt.Sprintf("%d:%s", sourceID, groupID)
}

func watchPricingBoardTags(row service.WatchPricingBoardRow) []string {
	tags := []string{}
	for _, value := range []string{row.Platform, row.AdapterType} {
		value = strings.TrimSpace(value)
		if value != "" {
			tags = append(tags, value)
		}
	}
	if row.InUse {
		tags = append(tags, "in_use")
	}
	return tags
}

func watchPricingBoardRowMatches(row service.WatchPricingBoardRow, filter service.WatchPricingBoardFilter) bool {
	if filter.SourceID > 0 && row.SourceID != filter.SourceID {
		return false
	}
	if filter.Platform != "" && !strings.EqualFold(strings.TrimSpace(row.Platform), strings.TrimSpace(filter.Platform)) {
		return false
	}
	if filter.ChangeKind != "" && filter.ChangeKind != "all" && !strings.EqualFold(row.ChangeKind, filter.ChangeKind) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(filter.InUse)) {
	case "true", "1", "yes":
		if !row.InUse {
			return false
		}
	case "false", "0", "no":
		if row.InUse {
			return false
		}
	}
	if filter.Tag != "" {
		found := false
		for _, tag := range row.Tags {
			if strings.EqualFold(tag, filter.Tag) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	search := strings.ToLower(strings.TrimSpace(filter.Search))
	if search != "" {
		haystack := strings.ToLower(strings.Join([]string{
			row.SourceName, row.AdapterType, row.GroupExternalID, row.GroupName, row.Platform,
		}, " "))
		if !strings.Contains(haystack, search) {
			return false
		}
	}
	return true
}

func sortWatchPricingBoardRows(rows []service.WatchPricingBoardRow, filter service.WatchPricingBoardFilter) {
	desc := strings.EqualFold(filter.Order, "desc")
	sortKey := strings.TrimSpace(filter.Sort)
	if sortKey == "" {
		sortKey = "final_multiplier"
		desc = false
	}
	sort.SliceStable(rows, func(i, j int) bool {
		left, right := rows[i], rows[j]
		var less bool
		switch sortKey {
		case "source":
			less = left.SourceName < right.SourceName
		case "observed_at", "time":
			less = left.ObservedAt.Before(right.ObservedAt)
		case "change":
			less = left.ChangeKind < right.ChangeKind
		case "in_use":
			less = !left.InUse && right.InUse
		default:
			if !watchRepoValuesEqual(left.FinalMultiplier, right.FinalMultiplier) {
				less = left.FinalMultiplier < right.FinalMultiplier
			} else {
				less = left.SourceName < right.SourceName
			}
		}
		if desc {
			return !less && !watchPricingBoardRowsEquivalent(left, right, sortKey)
		}
		return less
	})
}

func watchPricingBoardRowsEquivalent(left, right service.WatchPricingBoardRow, sortKey string) bool {
	switch sortKey {
	case "source":
		return left.SourceName == right.SourceName
	case "observed_at", "time":
		return left.ObservedAt.Equal(right.ObservedAt)
	case "change":
		return left.ChangeKind == right.ChangeKind
	case "in_use":
		return left.InUse == right.InUse
	default:
		return watchRepoValuesEqual(left.FinalMultiplier, right.FinalMultiplier)
	}
}

func (r *watchSourceRepository) ListPricingHistory(ctx context.Context, filter service.WatchPricingHistoryFilter) (*service.WatchPricingHistory, error) {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 200
	}
	component := strings.TrimSpace(filter.Component)
	if component == "" {
		component = "group_multiplier"
	}
	history := &service.WatchPricingHistory{
		SourceID:        filter.SourceID,
		GroupExternalID: strings.TrimSpace(filter.GroupExternalID),
		Platform:        strings.TrimSpace(filter.Platform),
		Model:           strings.TrimSpace(filter.Model),
		Component:       component,
		GeneratedAt:     time.Now().UTC(),
		Points:          []service.WatchPricingHistoryPoint{},
		Events:          []service.WatchPriceChange{},
	}
	if filter.SourceID <= 0 || history.GroupExternalID == "" {
		return history, nil
	}
	if component == "group_multiplier" {
		if err := r.loadWatchGroupMultiplierHistory(ctx, history, filter.Limit); err != nil {
			return nil, err
		}
	} else {
		if err := r.loadWatchModelPriceHistory(ctx, history, filter.Limit); err != nil {
			return nil, err
		}
	}
	events, err := r.ListFilteredPriceChanges(ctx, service.WatchPriceChangeFilter{
		SourceID:        filter.SourceID,
		GroupExternalID: filter.GroupExternalID,
		Platform:        filter.Platform,
		Model:           filter.Model,
		Component:       component,
		ChangeKind:      filter.ChangeKind,
		Limit:           filter.Limit,
	})
	if err != nil {
		return nil, err
	}
	history.Events = events
	return history, nil
}

func (r *watchSourceRepository) loadWatchGroupMultiplierHistory(ctx context.Context, history *service.WatchPricingHistory, limit int) error {
	rows, err := r.db.QueryContext(ctx, `
SELECT source_name_snapshot, group_name_snapshot, platform, effective_rate_multiplier, observed_at
FROM watch_source_group_history
WHERE source_id = $1 AND group_external_id = $2
ORDER BY observed_at DESC, id DESC
LIMIT $3`, history.SourceID, history.GroupExternalID, limit)
	if err != nil {
		return fmt.Errorf("list watch group multiplier history: %w", err)
	}
	defer rows.Close()
	points := make([]service.WatchPricingHistoryPoint, 0)
	for rows.Next() {
		var value float64
		var observedAt time.Time
		if err = rows.Scan(&history.SourceName, &history.GroupName, &history.Platform, &value, &observedAt); err != nil {
			return fmt.Errorf("scan watch group multiplier history: %w", err)
		}
		points = append(points, service.WatchPricingHistoryPoint{ObservedAt: observedAt, Value: value})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	finalizeWatchPricingHistory(history, points)
	return nil
}

func (r *watchSourceRepository) loadWatchModelPriceHistory(ctx context.Context, history *service.WatchPricingHistory, limit int) error {
	rows, err := r.db.QueryContext(ctx, `
SELECT source_name_snapshot, group_name_snapshot, platform, model, effective_value, observed_at
FROM watch_source_price_history
WHERE source_id = $1 AND group_external_id = $2
  AND ($3 = '' OR LOWER(platform) = LOWER($3))
  AND ($4 = '' OR LOWER(model) = LOWER($4))
  AND component = $5
ORDER BY observed_at DESC, id DESC
LIMIT $6`, history.SourceID, history.GroupExternalID, history.Platform, history.Model, history.Component, limit)
	if err != nil {
		return fmt.Errorf("list watch model price history: %w", err)
	}
	defer rows.Close()
	points := make([]service.WatchPricingHistoryPoint, 0)
	for rows.Next() {
		var value float64
		var observedAt time.Time
		if err = rows.Scan(&history.SourceName, &history.GroupName, &history.Platform, &history.Model, &value, &observedAt); err != nil {
			return fmt.Errorf("scan watch model price history: %w", err)
		}
		points = append(points, service.WatchPricingHistoryPoint{ObservedAt: observedAt, Value: value})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	finalizeWatchPricingHistory(history, points)
	return nil
}

func finalizeWatchPricingHistory(history *service.WatchPricingHistory, points []service.WatchPricingHistoryPoint) {
	for i, j := 0, len(points)-1; i < j; i, j = i+1, j-1 {
		points[i], points[j] = points[j], points[i]
	}
	history.Points = points
	history.Summary.RecordCount = len(points)
	for _, point := range points {
		value := point.Value
		if history.Summary.MinValue == nil || value < *history.Summary.MinValue {
			history.Summary.MinValue = &value
		}
		if history.Summary.MaxValue == nil || value > *history.Summary.MaxValue {
			history.Summary.MaxValue = &value
		}
	}
}

func roundWatchRepoPrice(value float64) float64 {
	return math.Round(value*100000000) / 100000000
}

func watchRepoValuesEqual(left, right float64) bool {
	return math.Abs(left-right) < 0.000000005
}
