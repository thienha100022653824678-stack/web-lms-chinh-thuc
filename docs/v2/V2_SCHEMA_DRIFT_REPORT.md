# V2 Schema Drift Report

Inspection date: 2026-07-13

Target:

- Supabase B / LMS production
- Project ref: `aqozjkfwzmyfunqvcyjv`

## Summary

The database is not yet fully ready for V2 identity mapping.

The V2 outbox foundation appears to exist, but the V2 identity-mapping migration is only partially represented in the current database state. Existing V1 runtime should continue unchanged, but V2 delivery/cutover must not be enabled until the missing columns are applied and postflight checks pass.

## Drift Findings

### Present

- `sync_outbox`
- `sync_deliveries`
- `sync_dead_letters`
- `course_slug_mappings`
- `portal_post_course_mappings`
- Session guard tables
- Account sharing P0/P1 tables
- Drive admin pool tables

### Missing / Not Visible Through REST

Expected from `migration_v2_identity_mapping.sql`:

| Table | Missing Expected Columns |
|---|---|
| `orders` | `course_id`, `normalized_customer_email`, `sync_correlation_id`, `source_system` |
| `student_enrollments` | `normalized_email`, `sync_correlation_id`, `source_system` |
| `lessons` | `kind`, `parent_section_id`, `position` |

Existing columns observed:

| Table | Present Relevant Columns |
|---|---|
| `student_enrollments` | `course_id` is already present from older schema |
| `lessons` | `course_id` is already present from older schema |
| `courses` | `expected_start_date`, `drive_folder_id`, `drive_permission_mode` are present |

## Risk

If V2 identity-dependent code is enabled while these columns are missing:

- `orders` mapping/reconciliation can fail.
- enrollment normalization can fail or silently skip required correlation fields.
- lesson section/position mapping can be incomplete.
- V2 readiness may report blocked or needs-review.

## Recommended Fix Path

1. Keep all V2 delivery flags disabled.
2. Run `scripts/v2/preflight-v2.sql` in Supabase B SQL Editor.
3. Apply `migration_v2_identity_mapping.sql` in Supabase B only after reviewing preflight counts.
4. Run `scripts/v2/postflight-v2.sql`.
5. Check that the missing column list is empty.
6. Run `/api/v2/readiness` with the internal worker secret.
7. Only proceed to V2 dry-run after readiness is no longer blocked by schema drift.

## Rollback

Because the missing work is additive, the preferred rollback is:

1. Do not enable V2 feature flags.
2. Leave additive columns/tables in place.
3. If a non-production cleanup is needed, use `scripts/v2/rollback-v2.sql` as a template only after export/backup.

Do not drop V2 tables/columns from production without explicit owner approval and backup.

