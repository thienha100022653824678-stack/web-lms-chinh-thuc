# V3 Phase 6 (⑪) — Structured Logs + Metrics + Tracing

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-observability` 10; full suite 223/223). Code-only — no owner production step.
>
> **Goal:** end V1's best-effort, error-swallowing telemetry (REL-02). V3 emits one structured JSON log line per event with correlation tracing and PII masking, and exposes read-only operational metrics for a diagnostics dashboard.

## What this phase added

| File | Role |
|---|---|
| `utils/v3-logs.js` | `buildLogEntry(fields)` / `logEvent(fields)` — one structured JSON line carrying `correlation_id`/`request_id`/`flow_id`/`runtime_version`/`schema_version`. `maskEmail` (2 chars + domain), `hashIdentifier` (16-char sha256 of ip/device/user_agent — never raw). Never throws (logging can't break the request path). `stampTelemetry` reuses the controller stamper. |
| `utils/v3-metrics.js` | Read-only probes: `getOutboxMetrics` (depth by status + derived success rate), `getDeliveryMetrics` (pending/failed/dead-letters; `-1` when `sync_dead_letters` not yet applied), `getRuntimePosture` (effective mode, kill switch, shadows, `rls_enforced`), `collectV3Metrics` aggregator. Each probe degrades independently; never throws. |
| `api/v3/diagnostics.js` | `GET /api/v3/diagnostics` — service-role gated via the existing worker secret (no new secret). Returns the metrics payload for the dashboard UI (⑨). |
| `tests/v3-observability.test.mjs` (10) | masking/hashing, log-entry stamping + no-PII-leak, reserved-key protection, posture rls_enforced only in v3, aggregator shape, endpoint 401/200/405. |

## Correlation tracing

Every V3 log line carries the same `correlation_id`/`request_id`/`flow_id` the V2 session guard already uses — now standardized so a single request can be traced Shop→Portal→LMS→Drive. The `runtime_version` stamp ties a log line to the version that produced it (compatibility contract), so a mixed-mode canary is legible.

## Privacy (kept from V2)

No raw email/IP/user-agent ever reaches a log line: email is masked, ip/device/user_agent are hashed to a short digest. This is asserted in tests (the raw values must not appear in the serialized entry).

## Dashboard (⑨ seed)

`api/v3/diagnostics.js` gives the admin diagnostics UI (Phase 7 ⑨) its data: outbox depth, delivery success rate, dead-letter count, and runtime posture. It reuses the read-only pattern from `utils/v2-diagnostics.js`/`utils/v2-readiness.js` rather than duplicating probes.

## Owner action pending

None — code-only. `sync_dead_letters` metric reports `-1` until the owner applies `migration_v3_outbox_dead_letters.sql` (Phase 3), then it counts normally.

## Test bar met (Phase 6)

- `node --test tests/*.test.mjs` → 223/223.
- Only new V3-only files; V1/V2 telemetry untouched → V1 path unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched. No production write.
