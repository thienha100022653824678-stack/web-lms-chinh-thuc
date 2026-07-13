# V2 Rollout Baseline

This branch is for the V2 platform rebuild. Production V1 remains on `main` and is tagged as `v1-stable-20260713`.

## Rules

- Do not merge V2 into `main` until cutover is explicitly approved.
- Keep V2 behind feature flags until a canary test passes.
- Keep existing LMS login/session, entry token, Drive permissions, and lesson playback working unless a V2 flag is enabled.
- Use additive database migrations only during V2 development.
- Do not delete, rename, or repurpose V1 columns until after a separate contract phase.
- Do not store secrets, tokens, raw entry tokens, or private keys in the repository.

## Initial Flags

- `V2_PLATFORM_ENABLED`
- `V2_RUNTIME_MODE`
- `V2_SESSION_LEASE_ENABLED`
- `V2_ENTRY_TOKEN_REQUIRED`
- `V2_DRIVE_WORKER_DRY_RUN`
- `V2_RECONCILIATION_READONLY`
- `V2_RISK_SCORING_ENABLED`

All flags are off by default.

## LMS Scope

The LMS repo owns lesson delivery, LMS verified sessions, admin CMS, Drive permission operations, and account-sharing alert review.
