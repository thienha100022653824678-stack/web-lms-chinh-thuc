# V3 Production Port Checkpoint

- Baseline production source: `fc12c3b21329158e13a4a027833afd2dec61e973`
- V3 branch is additive and Preview-only until approval.
- Existing V1/V2 controller and `lms.html` remain untouched.
- Runtime/Drive/lesson writes originating from V3 Preview are blocked server-side.
- V3 learner reuses Production entry-token, verified session, device and enrollment checks.
- V3 Admin uses existing Admin auth, course data and Drive auth; Preview content writes remain blocked.
- Final Production System-tab integration is intentionally deferred until Preview core passes.
