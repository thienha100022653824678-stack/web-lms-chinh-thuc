// tests/_supabase_stub_loader.mjs
//
// Lightweight loader invoked only when `utils/supabase.js` detects the
// `LMS_RP2B1_SUPABASE_STUB=1` env. Reads its configuration from
// `tests/.supabase-stub.json` each time a query runs so a single test
// process can swap stubs between cases without module reloads.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.json");

function readStub() {
  try {
    return JSON.parse(readFileSync(STUB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function maybeThrow(stub, table) {
  if (stub.throwOn && stub.throwOn[table]) {
    throw new Error(`[stub] simulated failure for table=${table}`);
  }
}

function makeChain(result, table) {
  // Read-only + write, thenable-ish chain. Each read method returns the
  // same chain so callers can do `select().eq(...).maybeSingle()`.
  // `upsert`/`insert` are supported (additive) so write-path tests
  // (e.g. v2-runtime-mode endpoint) can exercise the controller's
  // site_config upsert + admin_audit_logs insert without a real DB.
  // When `globalThis.__V2RM_SUPABASE_WRITES__` is an array, each write is
  // recorded as { table, operation, payload } for test assertions.
  //
  // Thenable: awaiting a read chain (e.g. `await supabase.from(t).select().in(...)`
  // without a terminal .maybeSingle) resolves to { data, error }.
  const chain = {
    _result: result,
    eq() { return chain; },
    in() { return chain; },
    neq() {
      return { order: () => Promise.resolve(chain._result) };
    },
    order() { return Promise.resolve(chain._result); },
    limit() { return Promise.resolve(chain._result); },
    maybeSingle: async () => chain._result,
    single: async () => chain._result,
    select() { return chain; },
    upsert(data) {
      recordWrite(table, "upsert", data);
      // Return a thenable that resolves to the standard { data, error }.
      return Promise.resolve({ data: null, error: null });
    },
    insert(data) {
      recordWrite(table, "insert", data);
      return Promise.resolve({ data: null, error: null });
    },
    // `update` returns the chain so callers can chain `.eq().eq()` and
    // then `await` the chain (thenable → { data, error }). Some write-path
    // handlers (e.g. verify-entry-token stale-session expiry) fire an
    // `update().eq().eq()` before returning; without this method the stub
    // threw "update is not a function" and masked the real 401 under a 500.
    update(data) {
      recordWrite(table, "update", data);
      return chain;
    },
    delete() {
      recordWrite(table, "delete", null);
      return chain;
    },
    then(resolve, reject) {
      return Promise.resolve(chain._result).then(resolve, reject);
    }
  };
  return chain;
}

function recordWrite(table, operation, payload) {
  try {
    const recorder = globalThis.__V2RM_SUPABASE_WRITES__;
    if (Array.isArray(recorder)) {
      recorder.push({ table, operation, payload });
    }
  } catch {
    /* best-effort; never let recording break a write */
  }
}

function fromStub(table) {
  const stub = readStub();
  maybeThrow(stub, table);
  const data = clone(stub[table]);
  if (data === undefined || data === null) {
    return makeChain({ data: null, error: null }, table);
  }
  const isArray = Array.isArray(data);
  const result = isArray ? { data: data.slice(), error: null } : { data, error: null };
  return makeChain(result, table);
}

const supabase = {
  from(table) { return fromStub(table); },
  rpc(_name, _params) { return Promise.resolve({ data: null, error: null }); }
};

export { supabase };
export default supabase;