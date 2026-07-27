# LMS V5 Risk Register

| Risk | Severity | Control |
|---|---|---|
| V5 bypasses enrollment/session | Critical | Shared server adapter, wrong-course/IDOR tests, no client email |
| Draft/private media leak | Critical | Server status filter, signed serializer, security tests |
| Production mutation from Preview | Critical | Fixture mode, mutation guard, separate Preview env, proof logs |
| B05 regression | High | Isolated app/routes, exact diff, 300-test baseline |
| Feed gaps/duplicates | High | Monotonic sequence cursor, ID/version dedupe |
| Scroll hijack | High | New-post banner, anchor-based restore, no forced scroll |
| Large upload exhausts Functions | High | Direct signed upload, metadata-only completion |
| Orphan media | Medium | Upload sessions, expiry, cleanup report |
| Migration duplication | High | source ID/checksum/batch uniqueness and deterministic output |
| Account-sharing false signals | High | Reuse current guard; do not rewrite risk logic |
| XSS in post/caption | High | Plain-text MVP, server sanitization, React escaping |
| Realtime unavailable | Medium | REST polling/focus/reconnect fallback |

