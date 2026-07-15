// tests/v3-outbox-migration.test.mjs
// V3 Phase 3 (④) — static assertions on migration_v3_outbox_dead_letters.sql.
// Owner-applied; no DB. Assert additive-only + the sync_dead_letters shape the
// V2 worker already expects.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "..", "migration_v3_outbox_dead_letters.sql"),
  "utf8"
);
const EXEC_SQL = SQL.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("migration is additive-only (no DROP/RENAME/ALTER TYPE/TRUNCATE/DELETE)", () => {
  for (const forbidden of [/\bDROP\b/i, /\bRENAME\b/i, /ALTER\s+TYPE/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i]) {
    assert.equal(forbidden.test(EXEC_SQL), false, `must not contain ${forbidden}`);
  }
});

test("wraps changes in a transaction", () => {
  assert.match(SQL, /^\s*BEGIN;/m);
  assert.match(SQL, /COMMIT;\s*$/m);
});

test("creates sync_dead_letters idempotently with the worker-expected shape", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.sync_dead_letters/);
  assert.match(SQL, /outbox_id uuid not null unique references public\.sync_outbox\(id\)/i);
  assert.match(SQL, /status text not null default 'open'[\s\S]*'resolved'[\s\S]*'ignored'/i);
  assert.match(SQL, /reason text not null/i);
  assert.match(SQL, /payload jsonb not null default '\{\}'::jsonb/i);
});

test("enables RLS (service-role only, no public policy)", () => {
  assert.match(SQL, /ALTER TABLE public\.sync_dead_letters ENABLE ROW LEVEL SECURITY/i);
  assert.equal(/CREATE POLICY/i.test(SQL), false);
});

test("creates the status index idempotently", () => {
  assert.match(SQL, /CREATE INDEX IF NOT EXISTS idx_sync_dead_letters_status/);
});
