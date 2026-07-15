import { createClient } from '@supabase/supabase-js';

// Test-only fallback. When the test runner sets
// `LMS_RP2B1_SUPABASE_STUB=1` and writes a JSON blob to
// `tests/.supabase-stub.json`, `supabase` resolves to the in-memory
// stub defined in `tests/_supabase_stub.mjs`. This keeps the test
// surface ESM-native without spinning up a Node module loader.
// Production NEVER sets this flag (default undefined → false).
const isTestStubEnabled = process.env.LMS_RP2B1_SUPABASE_STUB === "1";

async function loadTestStub() {
  const stubUrl = new URL("../tests/_supabase_stub_loader.mjs", import.meta.url).href;
  const mod = await import(stubUrl);
  return mod.supabase;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("CẢNH BÁO: Thiếu biến môi trường SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
}

if (isTestStubEnabled) {
  supabase = await loadTestStub();
} else {
  supabase = createClient(supabaseUrl || '', supabaseServiceKey || '', {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export { supabase };
