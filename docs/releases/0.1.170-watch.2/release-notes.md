# Sub2API Operations v0.1.170-watch.2

## Release identity

- Source branch: `feature/watch-mappings-tabs-v1`
- Release branch: `release/0.1.170-watch.2`
- Tag: `v0.1.170-watch.2`
- Upstream baseline: `v0.1.170`
- Release date: 2026-08-04

## Included changes

- Separates account-mapping candidates and mapping management into two accessible tabs with independent filters and pagination.
- Adds stale-response protection for target-group changes, mapping lists, scans, and source snapshot refreshes.
- Revalidates every automatic batch confirmation against the current account Base URL, credential digest, active upstream key, and concrete upstream group before saving.
- Adds server-side `mapping_method` filtering before pagination for automatic and manual mappings.
- Keeps unmatched and multiple-match candidates non-confirmable while providing a direct path to manual mapping.
- Allows a multi-group candidate to become confirmable only after an operator selects a concrete upstream group.
- Keeps candidate, mapping, and operation failures isolated and presents administrator-facing reasons in localized text.

## Data and compatibility

- No database migration is introduced by this release.
- Existing mappings, sources, pricing rules, usage logs, billing, and failover settings are unchanged.
- Automatic confirmation remains explicit; scanning never creates a formal mapping by itself.
- Real keys, credential digests, passwords, tokens, cookies, and request bodies are not returned by the Watch API or written to release artifacts.

## Verification baseline

- Watch frontend tests passed 5 files and 34 tests; account-mapping coverage passed 15 focused tests.
- Vue typecheck and production build passed with embedded entry `index-80UEHyLB.js`.
- Go service, repository, admin handler, and route regressions passed.
- Visible checks covered 1024, 1280, and 1440 widths, tab/filter/pagination isolation, rapid target-group changes, manual mapping location, and zero Watch 5xx.
- Independent QA accepted the layout, system-error, interaction, and functional test categories.

## Deployment boundary

- Use blue-green deployment with a logical PostgreSQL backup and deployment-config backup before candidate startup.
- Start the candidate on an isolated loopback port and keep the active production container unchanged until separate cutover approval.
- If background workers cannot be isolated safely, stop before candidate startup and request a release-plan delta.
- Proxy cutover, stopping any existing container, enabling failover, database restore, and refunds each require separate authorization.
