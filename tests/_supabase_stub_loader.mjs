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

function makeChain(result) {
  // Read-only, thenable-ish chain. Each method returns the same chain
  // so callers can do `select().eq(...).maybeSingle()`.
  const chain = {
    _result: result,
    eq() { return chain; },
    neq() {
      return { order: () => Promise.resolve(chain._result) };
    },
    order() { return Promise.resolve(chain._result); },
    limit() { return Promise.resolve(chain._result); },
    maybeSingle: async () => chain._result,
    single: async () => chain._result,
    select() { return chain; }
  };
  return chain;
}

function fromStub(table) {
  const stub = readStub();
  maybeThrow(stub, table);
  const data = clone(stub[table]);
  if (data === undefined || data === null) {
    return makeChain({ data: null, error: null });
  }
  const isArray = Array.isArray(data);
  const result = isArray ? { data: data.slice(), error: null } : { data, error: null };
  return makeChain(result);
}

const supabase = {
  from(table) { return fromStub(table); },
  rpc(_name, _params) { return Promise.resolve({ data: null, error: null }); }
};

export { supabase };
export default supabase;