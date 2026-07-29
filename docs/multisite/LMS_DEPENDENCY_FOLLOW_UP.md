# LMS Dependency Follow-Up

Status: separate follow-up; not part of the multisite rollout.

`npm audit --omit=dev` reports four moderate transitive advisories and no
high/critical advisory. The chain is:

`googleapis` → `googleapis-common` → `gaxios` → `uuid < 11.1.1`.

The advisory concerns missing buffer bounds validation in UUID v3/v5/v6 when a
caller supplies a buffer. The available automatic resolution requires a
breaking Google APIs upgrade. `npm audit fix --force` was intentionally not
run.

Recommended separate work:

1. Create a dependency-only branch.
2. Upgrade Google APIs and UUID-compatible transitive packages.
3. Re-run Drive auth/upload/permission/retry tests and the full 317-test suite.
4. Deploy a separate protected Preview.
5. Do not combine the dependency release with the multisite canary.

Commerce audit is tracked separately and has no current reported advisory.
