# LMS V5 API Contract

All responses are JSON `{ ok, data?, error?: { code, message, details? }, meta? }`. Authentication failures remain 401, authorization/enrollment failures 403, absent resources 404, conflicts 409, validation 422, and unavailable dependencies 503.

## Student

- `GET /api/v5/channels`
- `GET /api/v5/channels/:courseSlug`
- `GET /api/v5/channels/:courseSlug/posts`
- `GET /api/v5/channels/:courseSlug/topics`
- `GET /api/v5/posts/:postId`
- `GET /api/v5/channels/:courseSlug/search`
- `POST /api/v5/posts/:postId/seen`
- `POST /api/v5/posts/:postId/complete`
- `POST /api/v5/channels/:courseSlug/read-state`

Feed/query parameters: `before_sequence`, `after_sequence`, `limit` (1–50, default 24), `topic_id`, `pinned`, and `search`. Offset is rejected. Cursors are strict integer sequences and results carry `next_before_sequence`/`next_after_sequence`.

## Admin

The paths match the requested create/update/delete/publish/schedule/pin/unpin/archive/restore/duplicate/version/upload/migration-preview contract. Mutations require `Idempotency-Key`; text is sanitized and sizes/types/status transitions are validated.

## Security

Student identity comes only from the existing server session. Every course read verifies active enrollment against canonical course slug and enforces the current protected-scope policy. Draft/hidden/deleted posts are excluded. Private media is returned only as short-lived signed access. Admin identity comes from the current admin session and allowlist.

