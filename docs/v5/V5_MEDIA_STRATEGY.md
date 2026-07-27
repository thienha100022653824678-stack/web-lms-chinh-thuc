# LMS V5 Media Strategy

## Provider choice

- Existing lesson/Drive URLs are preserved for migrated content.
- Cloudinary remains suitable for images and thumbnails where current credentials/configuration exist.
- Large video stays on the existing video/Drive provider and uploads directly from the browser with server-issued authorization.
- Private documents retain Drive/provider access semantics and are serialized through signed/authorized access.

## Upload protocol

`uploads/init` validates declared metadata and returns a provider-scoped, expiring authorization without credentials. Browser uploads directly. `uploads/complete` verifies MIME from provider response, extension, size, dimensions/duration, asset ID, ownership, checksum when available, and upload-session state before inserting media. `cancel` marks the session cancelled; scheduled cleanup handles expired/orphaned provider assets.

Vercel Functions never receive large video bodies. A post is not reported published until database/media operations complete. Retry is per file and idempotent. Soft-deleting a post does not delete its provider asset.

