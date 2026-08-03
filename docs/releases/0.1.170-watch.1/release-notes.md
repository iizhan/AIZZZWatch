# Sub2API Operations v0.1.170-watch.1

## Release identity

- Source branch: `feature/sub2api-operations-v0.1.170`
- Release branch: `release/0.1.170-watch.1`
- Tag: `v0.1.170-watch.1`
- Upstream baseline: `v0.1.170`
- Release date: 2026-08-03

## Included changes

- Preserves the official Sub2API `v0.1.170` gateway, scheduler, group profit control, and upstream rate probe changes.
- Adds the Web intelligent-operations suite: upstream sources, price ranking, account mappings, cost/profit attribution, keepalive, integration health, and controlled auto-pricing.
- Adds configurable account failover for selected upstream error statuses while keeping every failed attempt non-billable.
- Keeps standard usage billing as the only monetary settlement path: only the final successful usage is charged once.
- Adds refund-candidate and dry-run reconciliation support without automatic balance mutation.
- Reports the custom runtime version while comparing update availability against the upstream numeric version core.

## Data and compatibility

- Official migrations `192` and `193` and custom additive migrations `301` through `313` are expected.
- Migrations are forward-compatible and are not automatically reversed during an application rollback.
- Existing encrypted credentials remain server-side and are not included in release artifacts or logs.
- Production failover must remain disabled during canary and requires separate approval before enablement.

## Verification baseline

- Backend service, repository, handler, and admin handler suites passed before release preparation.
- Frontend Vitest passed 207 files and 1430 tests; typecheck and production build passed.
- Local Docker verification covered migrations, health, the eight intelligent-operations pages, billing invariants, and 1024px layout.

## Deployment boundary

- Use blue-green deployment with a logical PostgreSQL backup and deployment-config backup before green startup.
- Start green on an isolated loopback port and keep blue available until post-cutover acceptance.
- Proxy cutover, stopping blue, enabling failover, database restore, and refunds each require separate authorization.
