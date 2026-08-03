# Release Checklist - 0.1.170-watch.1

## Source and identity

- [x] Upstream `v0.1.170` is an ancestor of the release source.
- [x] Custom Watch and failover changes are preserved on the source branch.
- [x] Release branch is `release/0.1.170-watch.1`.
- [ ] Release commit is clean and tagged `v0.1.170-watch.1`.
- [ ] Feature branch, release branch, and tag are pushed to the custom remote.

## Automated verification

- [x] Backend service, repository, handler, and admin handler tests pass.
- [x] Failed failover attempts remain `not_billable`; only final successful usage is charged once.
- [x] Frontend Vitest, Vue typecheck, and production build pass.
- [x] Release version comparison test passes.
- [x] `git diff --check` and release diff review pass.

## Production preflight and backup

- [ ] Record active blue container, image digest, proxy target, ports, health, and resource baseline.
- [ ] Confirm production failover setting and keep it disabled for canary.
- [ ] Create a timestamped logical PostgreSQL backup.
- [ ] Back up deployment configuration without copying secrets into release artifacts.
- [ ] Record backup checksums and restore commands.

## Green canary

- [ ] Build an immutable image tagged with release version and commit.
- [ ] Start green on an isolated loopback port without changing production traffic.
- [ ] Verify health, runtime version, schema migrations, admin UI, Watch endpoints, and logs.
- [ ] Verify failed attempts have zero monetary settlement and final successful usage is billed once.
- [ ] Provide the isolated acceptance URL and dedicated QA admin credentials.

## Explicit approval gates

- [ ] Obtain separate action-time approval before proxy cutover.
- [ ] Keep blue running after cutover until user acceptance.
- [ ] Obtain separate approval before stopping blue.
- [ ] Obtain separate approval before enabling failover.
- [ ] Obtain separate destructive authorization before any database restore.
- [ ] Obtain separate authorization before any refund execution.
