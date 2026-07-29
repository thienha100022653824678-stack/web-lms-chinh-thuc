import { createClient } from "@supabase/supabase-js";
import {
  BUSINESS_COLUMN_ALLOWLIST,
  BUSINESS_PRIMARY_KEYS,
  businessDataChecksum,
  businessFieldChecksums,
  businessSelectList,
  businessTableCounts
} from "./lib/multisite-business-checksum.mjs";

const EXPECTED_PRODUCTION_REF = "aqozjkfwzmyfunqvcyjv";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("PRODUCTION_READ_ONLY_CREDENTIALS_REQUIRED");
if (process.env.MULTISITE_VERIFICATION_MODE !== "read-only") {
  throw new Error("READ_ONLY_VERIFICATION_MODE_REQUIRED");
}
const ref = new URL(url).hostname.split(".")[0];
if (ref !== EXPECTED_PRODUCTION_REF) throw new Error("PRODUCTION_RESOURCE_IDENTITY_MISMATCH");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "x-read-only-purpose": "lms-multisite-business-checksum" } }
});

async function loadRows(table) {
  const columns = businessSelectList(table, "");
  const orderColumn = BUSINESS_PRIMARY_KEYS[table][0];
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

const tableRows = {};
for (const table of Object.keys(BUSINESS_COLUMN_ALLOWLIST)) {
  tableRows[table] = await loadRows(table);
}

console.log(JSON.stringify({
  captured_at: new Date().toISOString(),
  production_ref: ref,
  mode: "read-only",
  pii_output: false,
  BUSINESS_DATA_CHECKSUM: businessDataChecksum(tableRows),
  counts: businessTableCounts(tableRows),
  field_checksums: businessFieldChecksums(tableRows)
}));
