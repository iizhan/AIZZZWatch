# Release Checklist - 0.1.170-watch.2

## Source and identity

- [x] Upstream `v0.1.170` remains the release baseline.
- [x] Account-mapping v2 implementation and independent QA are complete.
- [x] Release branch is `release/0.1.170-watch.2`.
- [x] Release commit is clean and tagged `v0.1.170-watch.2`.
- [x] Feature branch, release branch, and tag are pushed to the custom remote.

## Automated verification

- [x] Backend service, repository, handler, and route regressions pass on the release commit.
- [x] Account-mapping stale-candidate and server-side pagination tests pass.
- [x] Frontend Watch tests, Vue typecheck, and production build pass.
- [x] Release version comparison test passes.
- [x] `git diff --check` and release diff review pass.

## Production preflight and backup

- [ ] Record the active container, image digest, proxy target, ports, health, disk, and resource baseline.
- [ ] Confirm production failover settings remain unchanged.
- [ ] Confirm a second application instance cannot duplicate unsafe background work, or start it with workers disabled.
- [ ] Create a timestamped logical PostgreSQL backup.
- [ ] Back up deployment and proxy configuration without copying secrets into release artifacts.
- [ ] Record backup checksums and validate the PostgreSQL dump catalog.

## Isolated candidate

- [x] Build an immutable `linux/amd64` image tagged with the release version and commit.
- [ ] Start the candidate on an unused loopback port without changing production traffic.
- [ ] Verify health, runtime version, schema state, admin UI, Watch endpoints, and logs.
- [ ] Verify no mapping is created by scanning and no existing mapping is changed during read-only acceptance.
- [ ] Verify no new 5xx, credential leakage, billing mutation, or failover settlement.
- [ ] Provide the isolated acceptance URL to the operator.

## Explicit approval gates

- [ ] Obtain separate action-time approval before proxy cutover.
- [ ] Obtain separate approval before stopping any existing production container.
- [ ] Obtain separate approval before enabling failover.
- [ ] Obtain separate destructive authorization before any database restore.
- [ ] Obtain separate authorization before any refund execution.

## Immutable image evidence

- Image tag: `sub2api-custom:0.1.170-watch.2-1f3326904`
- Platform: `linux/amd64`
- Image digest: `sha256:6dffe770773cb35213f90524757d20229b45b3f96174e9ec53b3fcca3499a02a`
- Embedded version: `0.1.170-watch.2`
- Embedded commit: `1f3326904b76331b87657576291631612d29f495`
- Embedded main asset: `assets/index-80UEHyLB.js`
