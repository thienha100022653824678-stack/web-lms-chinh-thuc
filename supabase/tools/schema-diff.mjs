// supabase/tools/schema-diff.mjs
// V3 Phase 1 (⑦) — schema-drift diff engine.
//
// Pure module. Compares two catalog snapshots and classifies each difference:
//   EXPECTED = schema generated from supabase/migrations/* (source of truth).
//   ACTUAL   = schema dumped from the live DB (production B, read-only).
//
// Structural drift (missing/added table, column, index, constraint, RLS flag,
// policy, function security-mode/grant) is FAIL. Cosmetic drift (column order,
// comment, default reformat) is WARN. Anything matching drift_allowlist.json is
// moved to `allowed` and never fails — that is how the current production
// "hiện trạng" is baptized into the baseline (see docs/V3_SCHEMA_GAP_SQL_RESULTS.md).
//
// No DB access, no fs. Callers dump catalogs however they like and pass JSON in.

const KINDS = new Set([
  "table",
  "column",
  "index",
  "constraint",
  "rls",
  "policy",
  "function",
  "grant",
]);

// ── Allowlist ────────────────────────────────────────────────────────────────
// Shape (all keys optional):
//   { tables:[{object,reason}], columns:[...], indexes:[...], constraints:[...],
//     rls:[...], policies:[...], functions:[...], grants:[...] }
// `object` is the same identity string the engine emits per finding:
//   table      -> "<table>"
//   column     -> "<table>.<column>"
//   index      -> "<index_name>"
//   constraint -> "<constraint_name>"
//   rls        -> "<table>"
//   policy     -> "<table>.<policy>"
//   function   -> "<function_name>"
//   grant      -> "<function_name>:<role>"
export function loadAllowlist(json) {
  const map = new Map(); // kind -> Set(object)
  for (const kind of KINDS) map.set(kind, new Set());
  if (json && typeof json === "object") {
    const groups = {
      table: json.tables,
      column: json.columns,
      index: json.indexes,
      constraint: json.constraints,
      rls: json.rls,
      policy: json.policies,
      function: json.functions,
      grant: json.grants,
    };
    for (const [kind, entries] of Object.entries(groups)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        const object = typeof e === "string" ? e : e && e.object;
        if (object) map.get(kind).add(object);
      }
    }
  }
  return {
    has(kind, object) {
      const set = map.get(kind);
      return set ? set.has(object) : false;
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function finding(kind, object, detail, severity) {
  return { kind, object, detail, severity };
}

function keysEqualIgnoringOrder(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i]);
}

function sameOrder(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i]);
}

// ── Core diff ─────────────────────────────────────────────────────────────────
export function diffCatalogs(expected, actual, allowlist) {
  const allow = allowlist || loadAllowlist({});
  const raw = []; // all findings before allowlist routing

  const eTables = (expected && expected.tables) || {};
  const aTables = (actual && actual.tables) || {};

  // Tables: added (in ACTUAL, not EXPECTED) or missing (in EXPECTED, not ACTUAL).
  for (const name of Object.keys(aTables)) {
    if (!(name in eTables)) {
      raw.push(finding("table", name, "table present in ACTUAL but not EXPECTED", "FAIL"));
    }
  }
  for (const name of Object.keys(eTables)) {
    if (!(name in aTables)) {
      raw.push(finding("table", name, "table in EXPECTED but missing in ACTUAL", "FAIL"));
    }
  }

  // Per-table: columns + RLS flags (only for tables present on both sides).
  for (const name of Object.keys(eTables)) {
    if (!(name in aTables)) continue;
    const et = eTables[name];
    const at = aTables[name];
    const ecols = et.columns || {};
    const acols = at.columns || {};

    // Column presence + type.
    for (const col of Object.keys(acols)) {
      if (!(col in ecols)) {
        raw.push(finding("column", `${name}.${col}`, "column present in ACTUAL but not EXPECTED (drift)", "FAIL"));
      } else if (ecols[col] !== acols[col]) {
        raw.push(finding("column", `${name}.${col}`, `type ${ecols[col]} -> ${acols[col]}`, "FAIL"));
      }
    }
    for (const col of Object.keys(ecols)) {
      if (!(col in acols)) {
        raw.push(finding("column", `${name}.${col}`, "column in EXPECTED but missing in ACTUAL", "FAIL"));
      }
    }
    // Column order (cosmetic) — WARN only when the sets match but order differs.
    if (keysEqualIgnoringOrder(ecols, acols) && !sameOrder(ecols, acols)) {
      raw.push(finding("column", name, "column order differs (cosmetic)", "WARN"));
    }

    // RLS flags.
    if (Boolean(et.rls_enabled) !== Boolean(at.rls_enabled)) {
      raw.push(finding("rls", name, `rls_enabled ${et.rls_enabled} -> ${at.rls_enabled}`, "FAIL"));
    }
    if (Boolean(et.rls_forced) !== Boolean(at.rls_forced)) {
      raw.push(finding("rls", name, `rls_forced ${et.rls_forced} -> ${at.rls_forced}`, "FAIL"));
    }
  }

  // Indexes (keyed by name).
  diffList(raw, "index", expected.indexes, actual.indexes, (x) => x.name, (e, a) => {
    const diffs = [];
    if (Boolean(e.unique) !== Boolean(a.unique)) diffs.push(`unique ${e.unique}->${a.unique}`);
    if ((e.partial || null) !== (a.partial || null)) diffs.push(`partial ${e.partial}->${a.partial}`);
    return diffs;
  });

  // Constraints (keyed by name).
  diffList(raw, "constraint", expected.constraints, actual.constraints, (x) => x.name, (e, a) => {
    const diffs = [];
    if ((e.type || "") !== (a.type || "")) diffs.push(`type ${e.type}->${a.type}`);
    if ((e.def || "") !== (a.def || "")) diffs.push("definition changed");
    return diffs;
  });

  // Policies (keyed by table.policyname).
  diffList(raw, "policy", expected.policies, actual.policies, (x) => `${x.table}.${x.name}`, () => []);

  // Functions (keyed by name): security-mode + grants.
  const eFns = indexBy(expected.functions, (f) => f.name);
  const aFns = indexBy(actual.functions, (f) => f.name);
  for (const name of Object.keys(aFns)) {
    if (!(name in eFns)) raw.push(finding("function", name, "function present in ACTUAL but not EXPECTED", "FAIL"));
  }
  for (const name of Object.keys(eFns)) {
    if (!(name in aFns)) {
      raw.push(finding("function", name, "function in EXPECTED but missing in ACTUAL", "FAIL"));
      continue;
    }
    const e = eFns[name];
    const a = aFns[name];
    if ((e.security || "") !== (a.security || "")) {
      raw.push(finding("function", name, `security ${e.security} -> ${a.security}`, "FAIL"));
    }
    const eg = new Set(e.grants || []);
    const ag = new Set(a.grants || []);
    for (const role of ag) if (!eg.has(role)) raw.push(finding("grant", `${name}:${role}`, "grant added in ACTUAL", "FAIL"));
    for (const role of eg) if (!ag.has(role)) raw.push(finding("grant", `${name}:${role}`, "grant missing in ACTUAL", "FAIL"));
  }

  // Route findings through the allowlist.
  const fails = [];
  const warns = [];
  const allowed = [];
  for (const f of raw) {
    if (allow.has(f.kind, f.object)) {
      allowed.push(f);
    } else if (f.severity === "WARN") {
      warns.push(f);
    } else {
      fails.push(f);
    }
  }

  return { verdict: fails.length > 0 ? "FAIL" : "PASS", fails, warns, allowed };
}

function indexBy(list, keyFn) {
  const out = {};
  for (const item of list || []) out[keyFn(item)] = item;
  return out;
}

// Diff two lists keyed by keyFn; compareFn(e,a) returns an array of change
// descriptions (each => FAIL). Missing/added => FAIL.
function diffList(raw, kind, expectedList, actualList, keyFn, compareFn) {
  const e = indexBy(expectedList, keyFn);
  const a = indexBy(actualList, keyFn);
  for (const key of Object.keys(a)) {
    if (!(key in e)) raw.push(finding(kind, key, `${kind} present in ACTUAL but not EXPECTED`, "FAIL"));
  }
  for (const key of Object.keys(e)) {
    if (!(key in a)) {
      raw.push(finding(kind, key, `${kind} in EXPECTED but missing in ACTUAL`, "FAIL"));
      continue;
    }
    for (const detail of compareFn(e[key], a[key])) {
      raw.push(finding(kind, key, detail, "FAIL"));
    }
  }
}
