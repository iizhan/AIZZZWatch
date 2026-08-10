# 0.1.173-watch.1 Release Checklist

Release artifact tag: `v0.1.173-watch.1`.

## Scope

- Merge upstream Sub2API `v0.1.173` Grok billing, Channel Monitor V2,
  scheduling-threshold, gateway, and account-management changes.
- Preserve Watch account mapping, pricing evidence, automatic pricing,
  recommendation/public-pricing, recharge-bonus, and failover billing safeguards.
- Keep failed failover attempts non-billable and bill only the final successful
  standard usage record.
- Keep Grok cross-client model mapping disabled unless an administrator
  explicitly enables it.

## Database

- Upstream additions: Channel Monitor V2 migrations `194_channel_monitor_v2.sql`
  through `206_channel_monitor_v2_privacy_defaults.sql`, plus group media price
  migrations `217` through `220`.
- Custom addition: `317_admin_recharge_bonus.sql`.
- Migration `220_clear_non_grok_video_generation_config.sql` first snapshots
  affected non-Grok video prices before clearing incompatible configuration.
- All schema changes are additive. Take and verify a production database backup
  before starting the green instance. Do not remove added schema during an
  application rollback.

## Verification

- [x] Default Go test suite.
- [x] Go test suite with the `unit` build tag.
- [x] Frontend Vitest: 233 files, 1582 tests.
- [x] Vue typecheck, lint check, and production build.
- [x] `git diff --check` and clean feature worktree.
- [x] Local embed health, version, asset hash, and visible route smoke tests.
- [ ] Feature/release/tag pushed to the custom remote and identity verified.
- [ ] `linux/amd64` immutable image built from the release commit.
- [ ] Production database and deployment backups verified.
- [ ] Green health, migrations, login, billing, Watch, public pricing,
  recommendation, recharge bonus, Channel Monitor, and Grok defaults verified.
- [ ] Explicit green acceptance received before traffic cutover.

## Blue-Green Deployment

- Resolve the actual production blue port and image from live read-only checks;
  do not infer them from a prior release report.
- Start the green container on the inactive loopback port with the same approved
  production database, Redis, network, and runtime configuration.
- Keep Nginx on blue throughout green validation.
- Do not restart or stop the blue container. If an existing production process
  must be restarted, stop and request separate approval.
- Before cutover, back up the exact Nginx file, validate the one-target diff with
  `nginx -t`, and use a graceful reload only after explicit cutover approval.

## Rollback

- If green validation fails, stop only the new green container and keep traffic
  on blue.
- If cutover validation fails, restore the backed-up Nginx configuration and
  gracefully reload back to blue.
- Keep the blue container and immutable image until a separate cleanup approval.
- Never roll back by deleting additive migration data.
