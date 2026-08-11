# 0.1.173-watch.2 Release Checklist

Release artifact tag: `v0.1.173-watch.2`.

## Scope

- Keep the official account billing probe as the primary multiplier evidence.
- Reduce Watch deep-diagnostic load: new sources default to 300 seconds and
  permanent credential/authentication failures back off to at least 900 seconds.
- Move pricing-triggered Watch checks to the bounded background due queue and
  preserve due markers across worker saturation and repository failures.
- Preserve Responses `context_management`, `truncation`, and valid HTTP
  `previous_response_id` continuation on the bound upstream account.
- Return stable client errors for unavailable continuation state and context
  window exhaustion without logging raw continuation IDs or request bodies.
- Advertise a 922,000-token OpenCode input budget for GPT-5.4/5.5/5.6 while
  retaining the 128,000-token output reserve.
- Add bounded Docker `json-file` rotation and a read-only PostgreSQL storage
  pressure report.

## Database

- This release adds no migration and performs no automatic maintenance.
- `backend/scripts/report-postgres-storage-pressure.sql` runs inside
  `BEGIN READ ONLY` and ends with `ROLLBACK`.
- Production database backup and storage-pressure review require a separately
  confirmed production preflight package.

## Verification

- [x] Focused and package-level Go tests completed during implementation.
- [x] Watch and UseKeyModal frontend tests, Vue typecheck, and production build.
- [x] Four Compose templates parse with non-sensitive validation placeholders.
- [x] Local embed health, version, asset hash, and visible Watch route checks.
- [x] Security review found no real credentials, request bodies, or raw
  `previous_response_id` values in new logs.
- [x] Release-level default and `unit` Go suites pass from the final source.
- [x] Full frontend Vitest (233 files / 1583 tests), typecheck, lint, and
  production build pass.
- [ ] Feature/release/tag identities are clean and pushed to `aizzzwatch` only.
- [ ] `linux/amd64` immutable image and archive SHA-256 are verified.
- [ ] Release doctor passes before any production preflight is proposed.

## Production Boundary

- This release-preparation package does not connect to production.
- It does not deploy, start a green container, change Nginx, run migrations,
  restart or stop a production container, clean logs, or modify production data.
- Production preflight, backup, green deployment, acceptance, and cutover each
  retain their own confirmation boundary.

## Rollback

- Before production deployment, rollback is branch/tag selection only; retain
  `v0.1.173-watch.1` and its immutable image.
- During a later green deployment, keep traffic on the existing production
  container until explicit cutover approval.
- Never delete data or reverse additive schema as an application rollback.
