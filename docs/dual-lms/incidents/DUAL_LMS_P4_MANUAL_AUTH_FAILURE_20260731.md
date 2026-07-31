# Dual LMS P4 Manual-Auth Failure — 2026-07-31

## Status

`ROLLED BACK / STOPPED AT P4`

- Approval: `OWNER-APPROVAL-20260731-DUAL-LMS-MANUAL-AUTH-05`
- Failed deployment: `dpl_2HABCZm5g44o8RhVr436pyphMU9K`
- Restored deployment: `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`
- `LMS_DUAL_SYSTEM_ENABLED`: removed/false
- `COMMERCE_DUAL_LMS_ROUTING_ENABLED`: absent/false
- P5–P7 were not run; no canary exists.

## Owner-observed symptoms

The authenticated owner smoke reported:

1. the two-LMS selector did not render;
2. `lms_tenant không hợp lệ`;
3. enrollment administration failed to load;
4. Drive Health returned `Invalid API key`;
5. account-sharing/risk failed to connect;
6. course, enrollment and Drive-backed data did not load normally.

No cookie, token, secret, email or PII was collected for diagnosis.

## Rollback evidence

At the owner FAIL attestation, the operator immediately:

1. removed `LMS_DUAL_SYSTEM_ENABLED` from Production;
2. promoted `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`;
3. left the Commerce flag absent;
4. did not roll back the compatible additive schema.

Post-rollback:

| Check | Result |
|---|---|
| `/` | HTTP 200 |
| `/lms-admin.html` | HTTP 200 |
| `/admin.html` | HTTP 200 |
| courses / orders / enrollments / lessons / site_config | `8 / 28 / 20 / 39 / 73` |
| non-NULL course/order `lms_tenant` | `0 / 0` |
| invalid tenant values | `0` |
| canary rows | `0` |
| reviewed constraints/indexes | `2 / 5` |

No course, order, enrollment, lesson, Drive credential or legacy mapping was
created, changed or deleted.

## Diagnosis by symptom

### 1. Why the switcher did not render

The reviewed runtime hid `#lmsTenantSelector` until a successful
`GET ?endpoint=courses` response set `STATE.dualSystemEnabled`.
Consequently, any first course-list error also hid the selector, even when the
server flag was enabled. This is a UI bootstrap defect: feature posture was
coupled to a database-backed request.

There is also a rollout compatibility hazard. A browser tab retaining the
restored B05 JavaScript does not send `X-LMS-Tenant`; once the new backend flag
is enabled, that old client receives `INVALID_LMS_TENANT`. The observed pairing
of “no selector” with “lms_tenant không hợp lệ” is consistent with this
stale-client/new-backend combination. This is an inference; browser cache and
request headers were deliberately not collected from the owner's session.

Corrective Preview code loads the safe feature posture from `public-config`
before session restoration and renders the selector independently of the first
database request.

### 2. Why `lms_tenant` was considered invalid

`requestLmsTenant()` correctly accepts only `yeunauan` or `yeubep` from body,
query or `X-LMS-Tenant`. A missing header fails closed with
`INVALID_LMS_TENANT`.

The new source initializes the selected tenant deterministically, but the old
B05 client has no tenant header. The CORS default header list also omitted
`X-LMS-Tenant`, which is incorrect for cross-origin/Preview preflight even
though same-origin Production GET requests do not normally require CORS
preflight. The correction adds the header explicitly.

Historical NULL tenant values did **not** cause this particular error:
`INVALID_LMS_TENANT` is raised before course resolution.

### 3. Was the actual runtime the approved SHA?

The deployment was built from a `git archive` of:

`044519300131745bf0e99a98ff152dd2c8afcc92`

Vercel recorded `gitSource=null` because it was a direct source archive, not a
Git integration build. While live, the Production Admin asset size was
`265348` bytes, matching the approved runtime asset and differing from the
restored B05 asset (`260196` bytes). The deployment was READY.

Therefore source provenance is established by the archived Git tree and asset
identity, not by Vercel Git metadata.

### 4. Did the domain point to the new deployment?

Yes. Deployment metadata for `dpl_2HABCZm5g44o8RhVr436pyphMU9K` recorded
Production target READY and aliases including:

- `www.daubepnho.store`;
- `daubepnho.store`;
- the LMS project aliases.

Historical runtime logs for the deployment recorded requests whose domain was
`www.daubepnho.store`. After rollback the same aliases point to
`dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.

### 5. Did backend configuration receive the Production flag?

Yes. The Production environment-name inventory contained
`LMS_DUAL_SYSTEM_ENABLED` during P4. The response
`lms_tenant không hợp lệ` is emitted only by the feature-on tenant path for the
affected course-dependent handlers. The flag was removed during rollback.

The correction exposes only the boolean posture in `public-config`; it does
not expose any secret or environment value.

### 6. Why did NULL historical tenants not resolve?

The resolver itself supports NULL:

1. valid explicit `lms_tenant`;
2. canonical course with valid `sales_site`;
3. canonical course with NULL `sales_site` → restored deterministic
   `yeunauan` fallback;
4. alias → canonical target owner.

The current mapper resolves all 8 courses with unresolved count `0`. During
the failed UI flow, execution stopped at request-tenant validation or the
Supabase connection error before legacy course resolution. There is no
evidence that the legacy resolver rejected a historical NULL row.

### 7. Why Drive Health returned `Invalid API key`

Drive Health first queries Supabase tables and does not call Google for the
initial dashboard load. Therefore this message identifies the LMS data
boundary, not a Google Drive access-token failure.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` names existed at Production
scope, but owner-observed `Invalid API key` is strong evidence that the newly
built deployment received a service-role value that was invalid for the URL,
redacted/empty, or otherwise mismatched. Sensitive values were not read.

The restored deployment can still work because Vercel deployments retain the
environment snapshot captured at their own build time. Restoring an old
deployment does not prove that the current project-level values are valid for
a new build.

The Preview correction converts raw backend-key errors to the non-secret
`LMS_DATA_BACKEND_UNAVAILABLE` contract.

### 8. Why enrollment and account-sharing/risk failed

Both handlers use the same server-side Supabase client.

- Enrollment can fail first on missing/invalid tenant, then on the Supabase
  query.
- Account-sharing/risk is global but still needs Supabase and therefore fails
  when the service-role boundary is invalid.

The failed deployment logs contained 400/403 responses for Admin API requests
and no attributable 500 in the retained sample. Response bodies were not
retained by Vercel logs, so the owner-observed UI errors provide the specific
error text.

## Environment-name audit

Present Production names required for the basic LMS boundary:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `ADMIN_EMAILS`
- `INTERNAL_SYNC_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SYSTEM1_URL`

Source-referenced names absent from the current Production manifest include:

- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SERVICE_ACCOUNT`
- `GOOGLE_DRIVE_IMAGE_FOLDER_ID`
- `GOOGLE_DRIVE_RECIPE_FOLDER_ID`
- `BUNNY_STREAM_TOKEN_KEY`

Some have fallback semantics, but the first two are directly used by lesson,
course-data and public-lesson Google authentication; folder variables are used
when course-specific folders cannot be resolved. Their correct Production
scope must be reconstructed from the last known-good env-name snapshot before
another new build. No value should be copied from Preview or printed.

Preview/test-only variables must remain absent from Production.

## Protected Preview corrective changes

The correction is intentionally narrow:

1. publish a non-secret `lmsDualSystemEnabled` boolean from `public-config`;
2. bootstrap/render the switcher before DB-backed course loading;
3. add `X-LMS-Tenant` to the Admin CORS header contract;
4. replace raw Supabase key messages in Drive Health with a safe 503 contract;
5. add regression tests for all four behaviors.

It does not change migrations, resolver ownership rules, tenant mappings,
course identities, credentials, Drive operations or Production data.

## Conditions before any future Production retry

1. Validate `SUPABASE_URL`/service-role pairing through a server-side,
   read-only database probe in a protected deployment.
2. Restore the complete Production env-name contract from a known-good
   snapshot without exposing values.
3. Prove fresh-client and stale-client rollout behavior.
4. Prove authenticated courses, enrollment, Drive Health and risk endpoints
   against protected Preview.
5. Obtain a new owner approval; this failed approval cannot be reused.
