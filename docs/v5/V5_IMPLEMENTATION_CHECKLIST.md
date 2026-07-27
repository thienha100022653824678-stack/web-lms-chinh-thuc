# LMS V5 Implementation Checklist

## Gate 0

- [x] Exact tag/SHA verified.
- [x] Clean dedicated branch/worktree created.
- [x] Current Production deployment recorded read-only.
- [x] B05 baseline 300/300 passes with local test stub.
- [x] Product/flow/architecture/data/API/media/auth/migration/test/rollback/risk documents created.

## Build

- [x] Isolated Vite student/admin app.
- [x] V5 server feature flag defaults off and B05 fallback remains.
- [x] Forward/rollback SQL is complete and unapplied.
- [x] Student/admin versioned APIs and current auth boundary.
- [x] Fixture migration dry-run is idempotent.
- [x] Feed/admin composer functionality and accessibility.

## Verification and Preview

- [x] B05 and V5 test suites pass.
- [x] Security/performance/accessibility evidence recorded.
- [ ] Exact commit pushed.
- [ ] Fixture-only Preview Ready with no Production alias/write.
- [ ] Final implementation report complete.
- [ ] Stop before Production rollout.
