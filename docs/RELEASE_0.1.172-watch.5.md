# 0.1.172-watch.5 Release Checklist

## Scope

- Merge upstream Sub2API v0.1.172 security, billing precision, upstream model audit, and gateway stability fixes.
- Preserve Watch account mapping, pricing evidence, automatic pricing, and failover billing safeguards.
- Add public pricing, recommendation rewards, and balance-source attribution.

## Database

- Upstream migrations: `194_add_usage_log_upstream_response_model.sql`, `195_add_usage_log_upstream_model_mismatch_index_notx.sql`.
- Custom migrations: `315_watch_rate_evidence_alert_dedup.sql`, `316_public_pricing_recommendations_balance_sources.sql`.
- All migrations are additive. Take and verify a production database backup before starting the green instance.

## Verification

- [x] Go service package and focused Watch/payment/recommendation tests.
- [x] Go repository and handler packages.
- [x] Frontend Vitest: 220 files, 1526 tests.
- [x] Vue typecheck and production build.
- [x] `git diff --check`.
- [x] Local embed health and visible route smoke tests.
- [ ] Production database backup verified.
- [ ] Green image built from the release tag.
- [ ] Green health, login, billing, Watch, public pricing, and recommendation smoke tests.
- [ ] Explicit approval received before traffic cutover.

## Rollback

- Keep the current blue container running and unchanged during green validation.
- If green validation fails, remove only the green container and keep traffic on blue.
- After cutover, route traffic back to blue if health, billing, or migration compatibility checks fail.
- Do not delete additive migration data during application rollback.
