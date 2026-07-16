# Owner Approvals — web-lms-chinh-thuc

_Tracks the 9 OWNER APPROVAL GATES: what needs approval, what has been approved, and what is
pending. The agent system never auto-proceeds past these. See `.agent/README.md`._

## The 9 gates

1. Deploy to production.
2. Run a migration on production.
3. Delete or overwrite real data.
4. Change DNS or domain.
5. Rotate, print, or replace a secret.
6. Move real traffic between V1, V2, and V3.
7. Send email or mass notifications.
8. Auto-lock student accounts.
9. Force-push, rewrite Git history, or delete an important branch.

---

## Status log (append-only; newest at top)

### 2026-07-16 — Bootstrap
- **GATE 1 (deploy prod):** NOT approved. Bootstrap deployed nothing.
- **GATE 2 (prod migration):** NOT approved. No migration applied (no DB tooling in this env anyway).
- **GATE 3 (delete/overwrite real data):** NOT approved. No data touched.
- **GATE 4 (DNS/domain):** NOT approved. None changed.
- **GATE 5 (rotate/print/replace secret):** NOT approved. No secret read, printed, rotated, or committed. Env files listed by name only.
- **GATE 6 (move V1/V2/V3 traffic):** NOT approved. No flag flipped, no `active_mode` change, no cutover.
- **GATE 7 (mass email/notification):** NOT approved. None sent.
- **GATE 8 (auto-lock student accounts):** NOT approved. None locked.
- **GATE 9 (force-push / rewrite history / delete branch):** NOT approved. No force-push, no history rewrite, no branch deletion. Bootstrap commit is a normal commit on `feat/v2-runtime-switch` staging only `.agent/**` + `.claude/agents/**` by explicit path (`.claude/` is gitignored, so the three agent files used `git add -f`). Zero product-code changes in the commit. The owner's uncommitted V2 runtime-switch WIP was left untouched and unstaged.

## Pending owner approvals (not yet requested by the agent system; listed for awareness)

- **V2 P5 live delivery** (GATE 6, and adjacent to GATE 1/2): owner already authorized auto-run per memory; the agent system treats each canary step as needing the owner's go-ahead and will not advance/reverse P5 without explicit instruction.
- **Untrack env files on this branch** (additive `git rm --cached` of `.env.prod.local/.env.prod.raw/.env.production`): reversible repo action — a controller task CAN do this without a gate, BUT the paired rotation of `VERCEL_OIDC_TOKEN` + history rewrite is **GATE 5 + GATE 9** and is owner-only. Recorded in RISKS R-1.
- **V3 production steps** (GATE 2 for the 4 additive migrations; GATE 5 for provisioning `SUPABASE_DB_URL_RO`/`SUPABASE_ANON_KEY`; GATE 6 for `active_mode`→v3; Portal PR merge; DRM provider; Phase-10 destructive checklist): all owner-only. Recorded in `v3-owner-pending-actions` memory.

## Approved actions (none yet from this agent system)
_(When the owner approves a gated action, record it here with date + exact scope so the controller
can proceed within that scope and no further.)_
