// supabase/tools/run-drift-gate.mjs
// V3 Phase 1 (⑦) — CLI wrapper around schema-diff.mjs for the CI gate.
//
// Usage:
//   node supabase/tools/run-drift-gate.mjs <expected.json> <actual.json> [allowlist.json]
//
// Reads two catalog snapshots (produced by catalog-query.sql) and the drift
// allowlist, runs diffCatalogs, prints a human report, and exits:
//   0  -> PASS (no un-allowlisted structural drift; WARNs allowed)
//   1  -> FAIL (structural drift outside the allowlist)
//   2  -> usage / IO error
//
// No DB access here; the workflow dumps the snapshots before calling this.
import { readFileSync } from "node:fs";
import { diffCatalogs, loadAllowlist } from "./schema-diff.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv) {
  const [expectedPath, actualPath, allowlistPath] = argv;
  if (!expectedPath || !actualPath) {
    console.error(
      "usage: node supabase/tools/run-drift-gate.mjs <expected.json> <actual.json> [allowlist.json]"
    );
    return 2;
  }
  let expected, actual, allow;
  try {
    expected = readJson(expectedPath);
    actual = readJson(actualPath);
    allow = loadAllowlist(allowlistPath ? readJson(allowlistPath) : {});
  } catch (err) {
    console.error(`drift-gate: cannot read inputs: ${err.message}`);
    return 2;
  }

  const res = diffCatalogs(expected, actual, allow);

  const line = (f) => `  [${f.kind}] ${f.object} — ${f.detail}`;
  if (res.allowed.length) {
    console.log(`ALLOWED (${res.allowed.length}) — accepted baseline drift:`);
    res.allowed.forEach((f) => console.log(line(f)));
  }
  if (res.warns.length) {
    console.log(`WARN (${res.warns.length}) — cosmetic, non-blocking:`);
    res.warns.forEach((f) => console.log(line(f)));
  }
  if (res.fails.length) {
    console.log(`FAIL (${res.fails.length}) — structural drift:`);
    res.fails.forEach((f) => console.log(line(f)));
  }
  console.log(`\nVERDICT: ${res.verdict}`);
  return res.verdict === "FAIL" ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
