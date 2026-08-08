package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

const (
	RecommendationRewardProfitShare = "profit_share"
	RecommendationRewardOneTime     = "one_time_credit"
	RecommendationDefaultShareRate  = 1.0
	RecommendationDefaultCap        = 100.0
	RecommendationTransferMinimum   = 1.0
	RecommendationDefaultShareDays  = 90
)

type RecommendationModelOption struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Enabled   bool   `json:"enabled"`
}

type Recommendation struct {
	ID                  int64                 `json:"id"`
	UserID              int64                 `json:"user_id"`
	SiteURL             string                `json:"site_url"`
	ModelKey            string                `json:"model_key"`
	SubmittedMultiplier float64               `json:"submitted_multiplier"`
	RequestedRewardType string                `json:"requested_reward_type"`
	Note                string                `json:"note,omitempty"`
	Status              string                `json:"status"`
	DecisionReason      string                `json:"decision_reason,omitempty"`
	AdoptedAt           *time.Time            `json:"adopted_at,omitempty"`
	CreatedAt           time.Time             `json:"created_at"`
	Reward              *RecommendationReward `json:"reward,omitempty"`
}

type RecommendationReward struct {
	ID               int64      `json:"id"`
	RecommendationID int64      `json:"recommendation_id"`
	RewardType       string     `json:"reward_type"`
	Amount           float64    `json:"amount"`
	SharePercent     float64    `json:"share_percent"`
	CapAmount        float64    `json:"cap_amount"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	Transferred      float64    `json:"transferred_amount"`
	Available        float64    `json:"available_amount"`
	AdminNote        string     `json:"admin_note,omitempty"`
}

type PublicPricing struct {
	ID            int64     `json:"id"`
	PublicName    string    `json:"public_name"`
	Platform      string    `json:"platform"`
	EffectiveRate float64   `json:"effective_multiplier"`
	ObservedAt    time.Time `json:"observed_at"`
}

type PublicPricingAdminRow struct {
	SourceID        int64   `json:"source_id"`
	GroupExternalID string  `json:"group_external_id"`
	SourceName      string  `json:"source_name"`
	GroupName       string  `json:"group_name"`
	Platform        string  `json:"platform"`
	EffectiveRate   float64 `json:"effective_multiplier"`
	PublicName      string  `json:"public_name"`
	Enabled         bool    `json:"enabled"`
}

type RecommendationService struct {
	client       *dbent.Client
	billingCache *BillingCacheService
}

func NewRecommendationService(client *dbent.Client, billingCache *BillingCacheService) *RecommendationService {
	return &RecommendationService{client: client, billingCache: billingCache}
}

func (s *RecommendationService) ListModels(ctx context.Context) ([]RecommendationModelOption, error) {
	rows, err := s.client.QueryContext(ctx, `SELECT model_key, display_name, sort_order FROM recommendation_model_options WHERE enabled = TRUE ORDER BY sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("list recommendation models: %w", err)
	}
	defer rows.Close()
	out := make([]RecommendationModelOption, 0)
	for rows.Next() {
		var item RecommendationModelOption
		if err := rows.Scan(&item.Key, &item.Name, &item.SortOrder); err != nil {
			return nil, err
		}
		item.Enabled = true
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *RecommendationService) ListModelsAdmin(ctx context.Context) ([]RecommendationModelOption, error) {
	rows, err := s.client.QueryContext(ctx, `SELECT model_key,display_name,sort_order,enabled FROM recommendation_model_options ORDER BY sort_order,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RecommendationModelOption, 0)
	for rows.Next() {
		var item RecommendationModelOption
		if err := rows.Scan(&item.Key, &item.Name, &item.SortOrder, &item.Enabled); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *RecommendationService) SaveModelOption(ctx context.Context, key, name string, enabled bool, sortOrder int) error {
	key = strings.ToLower(strings.TrimSpace(key))
	name = strings.TrimSpace(name)
	if key == "" || len(key) > 64 || name == "" || len(name) > 128 {
		return infraerrors.BadRequest("INVALID_RECOMMENDATION_MODEL", "模型标识或名称无效")
	}
	for _, ch := range key {
		if !(ch >= 'a' && ch <= 'z') && !(ch >= '0' && ch <= '9') && ch != '_' && ch != '-' {
			return infraerrors.BadRequest("INVALID_RECOMMENDATION_MODEL", "模型标识只能包含小写字母、数字、下划线和短横线")
		}
	}
	_, err := s.client.ExecContext(ctx, `INSERT INTO recommendation_model_options (model_key,display_name,enabled,sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (model_key) DO UPDATE SET display_name=EXCLUDED.display_name,enabled=EXCLUDED.enabled,sort_order=EXCLUDED.sort_order,updated_at=NOW()`, key, name, enabled, sortOrder)
	return err
}

func normalizeRecommendationURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > 2048 {
		return "", infraerrors.BadRequest("INVALID_RECOMMENDATION_URL", "站点地址无效")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return "", infraerrors.BadRequest("INVALID_RECOMMENDATION_URL", "站点地址必须是有效的 HTTP/HTTPS 地址")
	}
	u.Path = ""
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func (s *RecommendationService) Create(ctx context.Context, userID int64, siteURL, modelKey string, multiplier float64, rewardType, note string) (*Recommendation, error) {
	normalized, err := normalizeRecommendationURL(siteURL)
	if err != nil {
		return nil, err
	}
	if multiplier <= 0 || math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_MULTIPLIER", "倍率必须大于 0")
	}
	if multiplier > 1000 {
		return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_MULTIPLIER", "倍率超出允许范围")
	}
	if len(strings.TrimSpace(note)) > 1000 {
		return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_NOTE", "补充说明不能超过 1000 个字符")
	}
	if rewardType != RecommendationRewardProfitShare && rewardType != RecommendationRewardOneTime {
		return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_REWARD_TYPE", "奖励类型无效")
	}
	var allowed bool
	if err := querySingleRow(ctx, s.client, `SELECT EXISTS(SELECT 1 FROM recommendation_model_options WHERE model_key = $1 AND enabled = TRUE)`, []any{strings.TrimSpace(modelKey)}, &allowed); err != nil {
		return nil, err
	}
	if !allowed {
		return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_MODEL", "模型选项无效")
	}
	var id int64
	if err := querySingleRow(ctx, s.client, `INSERT INTO user_recommendations (user_id, site_url, model_key, submitted_multiplier, requested_reward_type, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, []any{userID, normalized, strings.TrimSpace(modelKey), multiplier, rewardType, strings.TrimSpace(note)}, &id); err != nil {
		return nil, fmt.Errorf("create recommendation: %w", err)
	}
	return s.Get(ctx, userID, id, false)
}

func (s *RecommendationService) Get(ctx context.Context, userID, id int64, admin bool) (*Recommendation, error) {
	query := `SELECT id,user_id,site_url,model_key,submitted_multiplier,requested_reward_type,COALESCE(note,''),status,COALESCE(decision_reason,''),adopted_at,created_at FROM user_recommendations WHERE id=$1`
	args := []any{id}
	if !admin {
		query += ` AND user_id=$2`
		args = append(args, userID)
	}
	var item Recommendation
	if err := querySingleRow(ctx, s.client, query, args, &item.ID, &item.UserID, &item.SiteURL, &item.ModelKey, &item.SubmittedMultiplier, &item.RequestedRewardType, &item.Note, &item.Status, &item.DecisionReason, &item.AdoptedAt, &item.CreatedAt); err != nil {
		return nil, err
	}
	var reward RecommendationReward
	err := querySingleRow(ctx, s.client, `SELECT id,recommendation_id,reward_type,amount,share_percent,cap_amount,expires_at,transferred_amount,COALESCE(admin_note,'') FROM recommendation_rewards WHERE recommendation_id=$1 ORDER BY id DESC LIMIT 1`, []any{item.ID}, &reward.ID, &reward.RecommendationID, &reward.RewardType, &reward.Amount, &reward.SharePercent, &reward.CapAmount, &reward.ExpiresAt, &reward.Transferred, &reward.AdminNote)
	if err == nil {
		reward.Available = math.Max(0, reward.Amount-reward.Transferred)
		item.Reward = &reward
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load recommendation reward: %w", err)
	}
	return &item, nil
}

func (s *RecommendationService) ListMine(ctx context.Context, userID int64) ([]Recommendation, error) {
	if err := s.RefreshProfitShares(ctx, userID); err != nil {
		return nil, err
	}
	rows, err := s.client.QueryContext(ctx, `SELECT id FROM user_recommendations WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 200`, userID)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	out := make([]Recommendation, 0, len(ids))
	for _, id := range ids {
		item, err := s.Get(ctx, userID, id, false)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, nil
}

func (s *RecommendationService) ListAdmin(ctx context.Context, status string) ([]Recommendation, error) {
	query := `SELECT id FROM user_recommendations`
	args := []any{}
	if strings.TrimSpace(status) != "" {
		query += ` WHERE status=$1`
		args = append(args, strings.TrimSpace(status))
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT 500`
	rows, err := s.client.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	out := make([]Recommendation, 0, len(ids))
	for _, id := range ids {
		item, err := s.Get(ctx, 0, id, true)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, nil
}

func (s *RecommendationService) Decide(ctx context.Context, adminID, id int64, adopted bool, reason, rewardType string, amount, sharePercent, capAmount float64, _ *time.Time, adminNote string) (*Recommendation, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, infraerrors.BadRequest("RECOMMENDATION_REASON_REQUIRED", "请填写处理说明")
	}
	if len(strings.TrimSpace(reason)) > 2000 || len(strings.TrimSpace(adminNote)) > 2000 {
		return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_REASON", "处理说明不能超过 2000 个字符")
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var userID int64
	var requested string
	var status string
	var siteURL string
	if err := querySingleRow(ctx, tx, `SELECT user_id,requested_reward_type,status,site_url FROM user_recommendations WHERE id=$1 FOR UPDATE`, []any{id}, &userID, &requested, &status, &siteURL); err != nil {
		return nil, err
	}
	if status != "pending" {
		return nil, infraerrors.Conflict("RECOMMENDATION_ALREADY_DECIDED", "该推荐已处理")
	}
	if !adopted {
		if _, err := tx.ExecContext(ctx, `UPDATE user_recommendations SET status='rejected', decision_reason=$1, decided_by=$2, updated_at=NOW() WHERE id=$3`, reason, adminID, id); err != nil {
			return nil, err
		}
	} else {
		if rewardType != RecommendationRewardProfitShare && rewardType != RecommendationRewardOneTime {
			return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_REWARD_TYPE", "奖励类型无效")
		}
		if requested != rewardType && strings.TrimSpace(adminNote) == "" {
			return nil, infraerrors.BadRequest("RECOMMENDATION_ADJUSTMENT_REASON_REQUIRED", "奖励类型与用户申请不一致时必须填写调整原因")
		}
		if math.IsNaN(amount) || math.IsInf(amount, 0) || math.IsNaN(sharePercent) || math.IsInf(sharePercent, 0) || math.IsNaN(capAmount) || math.IsInf(capAmount, 0) {
			return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_REWARD", "奖励参数无效")
		}
		var sourceID any
		var expiresAt *time.Time
		if rewardType == RecommendationRewardProfitShare {
			amount = 0
			sharePercent = RecommendationDefaultShareRate
			capAmount = RecommendationDefaultCap
			defaultExpiry := time.Now().UTC().AddDate(0, 0, RecommendationDefaultShareDays)
			expiresAt = &defaultExpiry
			resolvedSourceID, err := findWatchSourceIDByURL(ctx, tx, siteURL)
			if err != nil {
				return nil, err
			}
			sourceID = resolvedSourceID
		} else {
			if amount <= 0 {
				return nil, infraerrors.BadRequest("INVALID_RECOMMENDATION_REWARD", "一次性奖励金额必须大于 0")
			}
			sharePercent = 0
			capAmount = 0
			expiresAt = nil
		}
		if _, err := tx.ExecContext(ctx, `UPDATE user_recommendations SET status='adopted', decision_reason=$1, decided_by=$2, adopted_at=NOW(), adopted_source_id=$3, updated_at=NOW() WHERE id=$4`, reason, adminID, sourceID, id); err != nil {
			return nil, err
		}
		key := fmt.Sprintf("recommendation:%d:reward", id)
		transferredAmount := 0.0
		if rewardType == RecommendationRewardOneTime {
			transferredAmount = amount
		}
		var rewardID int64
		if err := querySingleRow(ctx, tx, `INSERT INTO recommendation_rewards (recommendation_id,user_id,reward_type,amount,share_percent,cap_amount,expires_at,transferred_amount,admin_note,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, []any{id, userID, rewardType, amount, sharePercent, capAmount, expiresAt, transferredAmount, strings.TrimSpace(adminNote), key, adminID}, &rewardID); err != nil {
			return nil, err
		}
		if rewardType == RecommendationRewardOneTime && amount > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE id=$2`, amount, userID); err != nil {
				return nil, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO balance_source_lots (user_id,source_type,source_id,principal_amount,bonus_amount,unknown_amount,remaining_principal,remaining_bonus,remaining_unknown) VALUES ($1,'recommendation_one_time',$2,0,$3,0,0,$3,0) ON CONFLICT DO NOTHING`, userID, rewardID, amount); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if adopted && rewardType == RecommendationRewardOneTime && amount > 0 {
		s.invalidateUserBalance(ctx, userID)
	}
	return s.Get(ctx, userID, id, false)
}

func (s *RecommendationService) Transfer(ctx context.Context, userID int64) (float64, error) {
	if err := s.RefreshProfitShares(ctx, userID); err != nil {
		return 0, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id, GREATEST(amount-transferred_amount,0) FROM recommendation_rewards WHERE user_id=$1 AND reward_type='profit_share' AND amount>transferred_amount FOR UPDATE`, userID)
	if err != nil {
		return 0, err
	}
	type rewardRow struct {
		id     int64
		amount float64
	}
	items := make([]rewardRow, 0)
	var total float64
	for rows.Next() {
		var item rewardRow
		if err := rows.Scan(&item.id, &item.amount); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, item)
		total += item.amount
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if total < RecommendationTransferMinimum {
		return 0, infraerrors.BadRequest("RECOMMENDATION_TRANSFER_MINIMUM", "可划转分红需达到 1 美元")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE id=$2`, total, userID); err != nil {
		return 0, err
	}
	for _, item := range items {
		if _, err := tx.ExecContext(ctx, `UPDATE recommendation_rewards SET transferred_amount=transferred_amount+$1,updated_at=NOW() WHERE id=$2`, item.amount, item.id); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO balance_source_lots (user_id,source_type,source_id,principal_amount,bonus_amount,unknown_amount,remaining_principal,remaining_bonus,remaining_unknown) VALUES ($1,'recommendation_profit_share',$2,0,$3,0,0,$3,0) ON CONFLICT (source_type,source_id) WHERE source_id IS NOT NULL DO UPDATE SET bonus_amount=balance_source_lots.bonus_amount+EXCLUDED.bonus_amount,remaining_bonus=balance_source_lots.remaining_bonus+EXCLUDED.remaining_bonus`, userID, item.id, item.amount); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	s.invalidateUserBalance(ctx, userID)
	return total, nil
}

func (s *RecommendationService) invalidateUserBalance(ctx context.Context, userID int64) {
	if s.billingCache != nil {
		_ = s.billingCache.InvalidateUserBalance(ctx, userID)
	}
}

func findWatchSourceIDByURL(ctx context.Context, queryer sqlRowsQueryer, raw string) (int64, error) {
	target, err := url.Parse(raw)
	if err != nil || target.Hostname() == "" {
		return 0, infraerrors.BadRequest("RECOMMENDATION_SOURCE_REQUIRED", "分红推荐必须先接入对应上游站点")
	}
	rows, err := queryer.QueryContext(ctx, `SELECT id,base_url FROM watch_sources WHERE enabled=TRUE ORDER BY id`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var matched int64
	for rows.Next() {
		var id int64
		var baseURL string
		if err := rows.Scan(&id, &baseURL); err != nil {
			return 0, err
		}
		candidate, parseErr := url.Parse(baseURL)
		if parseErr == nil && strings.EqualFold(candidate.Hostname(), target.Hostname()) {
			if matched != 0 {
				return 0, infraerrors.Conflict("RECOMMENDATION_SOURCE_AMBIGUOUS", "存在多个同域名上游站点，请先整理站点配置")
			}
			matched = id
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if matched == 0 {
		return 0, infraerrors.BadRequest("RECOMMENDATION_SOURCE_REQUIRED", "分红推荐必须先接入对应上游站点")
	}
	return matched, nil
}

func (s *RecommendationService) RefreshProfitShares(ctx context.Context, userID int64) error {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT r.id,ur.adopted_source_id,r.share_percent,r.cap_amount,r.amount,ur.adopted_at,r.expires_at FROM recommendation_rewards r JOIN user_recommendations ur ON ur.id=r.recommendation_id WHERE r.user_id=$1 AND r.reward_type='profit_share' AND ur.adopted_source_id IS NOT NULL AND r.amount<r.cap_amount FOR UPDATE OF r`, userID)
	if err != nil {
		return err
	}
	type shareRow struct {
		rewardID, sourceID         int64
		percent, capAmount, amount float64
		adoptedAt                  time.Time
		expiresAt                  *time.Time
	}
	rewards := make([]shareRow, 0)
	for rows.Next() {
		var row shareRow
		if err := rows.Scan(&row.rewardID, &row.sourceID, &row.percent, &row.capAmount, &row.amount, &row.adoptedAt, &row.expiresAt); err != nil {
			rows.Close()
			return err
		}
		rewards = append(rewards, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, reward := range rewards {
		remainingCap := math.Max(0, reward.capAmount-reward.amount)
		if remainingCap <= 0 {
			continue
		}
		accrualRows, err := tx.QueryContext(ctx, `
WITH candidates AS (
		SELECT
			ul.id AS usage_log_id,
			ul.created_at,
			GREATEST(
				CASE WHEN ul.billing_type=0 THEN funding.principal_amount ELSE ul.actual_cost END
				-COALESCE(ul.account_stats_cost,ul.total_cost)*group_history.effective_rate_multiplier,
				0
			)::double precision AS positive_margin
		FROM usage_logs ul
		JOIN LATERAL (
			SELECT source_id,source_group_external_id
			FROM watch_account_upstream_mapping_history
			WHERE account_id=ul.account_id
			  AND valid_from<=ul.created_at
			  AND (valid_to IS NULL OR valid_to>ul.created_at)
			  AND source_group_external_id<>''
			ORDER BY valid_from DESC,id DESC
			LIMIT 1
		) mapping_history ON mapping_history.source_id=$3
		JOIN LATERAL (
			SELECT effective_rate_multiplier::double precision AS effective_rate_multiplier
			FROM watch_source_group_history
			WHERE source_id=mapping_history.source_id
			  AND group_external_id=mapping_history.source_group_external_id
			  AND observed_at<=ul.created_at
			ORDER BY observed_at DESC,id DESC
			LIMIT 1
		) group_history ON TRUE
		LEFT JOIN LATERAL (
		SELECT
			COALESCE(SUM(principal_amount),0)::double precision AS principal_amount,
			COALESCE(SUM(unknown_amount),0)::double precision AS unknown_amount,
			COUNT(*)::bigint AS allocation_count
		FROM balance_source_allocations
		WHERE request_id=ul.request_id
	) funding ON TRUE
	WHERE ul.created_at >= $4
	  AND ul.created_at <= NOW()-INTERVAL '24 hours'
	  AND ($5::timestamptz IS NULL OR ul.created_at < $5::timestamptz)
	  AND ul.actual_cost > 0
	  AND ul.user_id <> $7
	  AND (ul.billing_type<>0 OR (funding.allocation_count>0 AND funding.unknown_amount=0))
		  AND NOT EXISTS (
		SELECT 1 FROM recommendation_reward_accruals existing
		WHERE existing.reward_id=$1 AND existing.usage_log_id=ul.id
	  )
), ranked AS (
	SELECT
		usage_log_id,
		positive_margin,
		positive_margin*$2/100 AS raw_reward,
		COALESCE(SUM(positive_margin*$2/100) OVER (
			ORDER BY created_at,usage_log_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
		),0) AS prior_reward
	FROM candidates
	WHERE positive_margin > 0
)
INSERT INTO recommendation_reward_accruals (reward_id,usage_log_id,positive_margin,reward_amount)
SELECT $1,usage_log_id,positive_margin,LEAST(raw_reward,GREATEST($6-prior_reward,0))
FROM ranked
WHERE prior_reward < $6
ORDER BY usage_log_id
ON CONFLICT (reward_id,usage_log_id) DO NOTHING
	RETURNING reward_amount::double precision`, reward.rewardID, reward.percent, reward.sourceID, reward.adoptedAt, reward.expiresAt, remainingCap, userID)
		if err != nil {
			return err
		}
		var accrued float64
		for accrualRows.Next() {
			var value float64
			if err := accrualRows.Scan(&value); err != nil {
				accrualRows.Close()
				return err
			}
			accrued += value
		}
		if err := accrualRows.Err(); err != nil {
			accrualRows.Close()
			return err
		}
		if err := accrualRows.Close(); err != nil {
			return err
		}
		if accrued > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE recommendation_rewards SET amount=LEAST(cap_amount,amount+$1),updated_at=NOW() WHERE id=$2`, accrued, reward.rewardID); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (s *RecommendationService) ListPublicPricing(ctx context.Context) ([]PublicPricing, error) {
	rows, err := s.client.QueryContext(ctx, `SELECT p.id,p.public_name,g.platform,(COALESCE(g.user_rate_multiplier,g.rate_multiplier)/s.recharge_ratio)::double precision,g.observed_at FROM watch_public_pricing p JOIN watch_sources s ON s.id=p.source_id JOIN watch_source_groups g ON g.source_id=p.source_id AND g.external_id=p.group_external_id WHERE p.enabled=TRUE AND s.enabled=TRUE AND s.recharge_ratio>0 AND g.observed_at>=NOW()-make_interval(secs=>COALESCE((SELECT freshness_seconds FROM watch_settings WHERE id=1),300)) ORDER BY p.updated_at DESC,p.id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list public pricing: %w", err)
	}
	defer rows.Close()
	out := make([]PublicPricing, 0)
	for rows.Next() {
		var item PublicPricing
		if err := rows.Scan(&item.ID, &item.PublicName, &item.Platform, &item.EffectiveRate, &item.ObservedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *RecommendationService) ListPublicPricingAdmin(ctx context.Context) ([]PublicPricingAdminRow, error) {
	rows, err := s.client.QueryContext(ctx, `SELECT g.source_id,g.external_id,s.name,g.name,g.platform,CASE WHEN s.recharge_ratio>0 THEN (COALESCE(g.user_rate_multiplier,g.rate_multiplier)/s.recharge_ratio)::double precision ELSE 0 END,COALESCE(p.public_name,''),COALESCE(p.enabled,FALSE) FROM watch_source_groups g JOIN watch_sources s ON s.id=g.source_id LEFT JOIN watch_public_pricing p ON p.source_id=g.source_id AND p.group_external_id=g.external_id ORDER BY s.name,g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PublicPricingAdminRow, 0)
	for rows.Next() {
		var item PublicPricingAdminRow
		if err := rows.Scan(&item.SourceID, &item.GroupExternalID, &item.SourceName, &item.GroupName, &item.Platform, &item.EffectiveRate, &item.PublicName, &item.Enabled); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *RecommendationService) SavePublicPricing(ctx context.Context, adminID, sourceID int64, groupExternalID, publicName string, enabled bool) error {
	groupExternalID = strings.TrimSpace(groupExternalID)
	publicName = strings.TrimSpace(publicName)
	if sourceID <= 0 || groupExternalID == "" || publicName == "" {
		return infraerrors.BadRequest("INVALID_PUBLIC_PRICING", "请选择上游分组并填写公示名称")
	}
	if len(groupExternalID) > 128 || len(publicName) > 255 {
		return infraerrors.BadRequest("INVALID_PUBLIC_PRICING", "上游分组或公示名称过长")
	}
	var exists bool
	if err := querySingleRow(ctx, s.client, `SELECT EXISTS(SELECT 1 FROM watch_source_groups WHERE source_id=$1 AND external_id=$2)`, []any{sourceID, groupExternalID}, &exists); err != nil {
		return err
	}
	if !exists {
		return infraerrors.NotFound("PUBLIC_PRICING_GROUP_NOT_FOUND", "上游分组不存在")
	}
	_, err := s.client.ExecContext(ctx, `INSERT INTO watch_public_pricing (source_id,group_external_id,public_name,enabled,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (source_id,group_external_id) DO UPDATE SET public_name=EXCLUDED.public_name,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, sourceID, groupExternalID, publicName, enabled, adminID)
	return err
}
