# V3 Secret Hygiene — untracking committed `.env.prod.*` files

> **Status:** repo-side cleanup done 2026-07-16 on branch `v3/research-20260715`.
> **Scope of this doc:** the safe, reversible repo-side portion only. The
> history rewrite (irreversible) is an **owner gate** recorded at the bottom.

## What was wrong

Three environment files were committed in `8758c3a` and remained git-tracked on
`v3/research-20260715` HEAD `51b62e4`:

- `.env.prod.local`
- `.env.prod.raw`
- `.env.production`

These are build-time env dumps captured under Vercel and contain, among other
keys, a populated `VERCEL_OIDC_TOKEN` (a 1374-char token). The other secret keys
(`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `INTERNAL_SYNC_SECRET`,
`GOOGLE_CLIENT_SECRET`, `SUPABASE_URL`) are present as **empty** placeholders in
the committed copy, but the files are still secret-shaped and must never be
tracked. This is **pre-existing security debt, not a V3 regression** — recorded
as a non-blocking exception in Stage 1 and accepted by the owner.

## What was done (safe, reversible)

1. `git rm --cached .env.prod.local .env.prod.raw .env.production`
   — removes the three files from the index **without deleting the on-disk
   copies**. The files are preserved locally so any local tooling that reads
   them keeps working.
2. The existing `.gitignore` already matches these via the `.env*` glob
   (line 14), confirmed with `git check-ignore` — all three are now ignored.
   No `.gitignore` edit was required.
3. The deletion is staged as an ordinary commit on the V3 branch. The files
   remain on disk, unchanged, and are no longer in the working tree's tracked
   set.

This change is **fully reversible** (`git checkout HEAD~1 -- .env.prod.*` would
re-add them) and touches **no runtime code, no V1 path, and no production**.

## What was NOT done (owner gate — irreversible)

The token still lives in git **history** (commit `8758c3a` and any descendants
that carried the files). Removing it from history requires a history rewrite,
which is **irreversible and rewrites every descendant commit SHA**. That is an
owner-only decision and is **not** performed here. Specifically:

- **`git filter-repo` / BFG** to purge the files from all history.
- **Force-push** of the rewritten branch (and coordination with any other
  clones/worktrees).
- **Rotation of the leaked `VERCEL_OIDC_TOKEN`** at Vercel — the committed copy
  must be treated as compromised regardless of the rewrite, because anyone with
  repository access before the rewrite could have copied it.

Recommended owner sequence (record pending, do **not** auto-run):

1. Rotate the `VERCEL_OIDC_TOKEN` (and any other key that was ever populated in
   a committed copy) at the provider. **Do this first** — a history rewrite does
   not undo a leaked secret, only rotation does.
2. Confirm no clone/worktree still has the old history before rewriting.
3. Run `git filter-repo --path .env.prod.local --path .env.prod.raw --path .env.production --invert-paths` (or BFG `--delete-files`).
4. Force-push the rewritten branch.
5. Have all collaborators re-clone.

## Verification performed

- `git ls-files | grep -iE '\.env'` → empty after the commit (no tracked env files).
- `git check-ignore .env.prod.local .env.prod.raw .env.production` → all three matched.
- On-disk copies preserved (`ls -la` confirms all three still present).
- Secret scan of the staged diff: the diff is a pure deletion of three files;
  **no secret value is introduced or re-emitted** by this change.
