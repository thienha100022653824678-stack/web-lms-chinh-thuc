import crypto from "node:crypto";

export const BUSINESS_COLUMN_ALLOWLIST = Object.freeze({
  courses: Object.freeze([
    "id", "slug", "title", "subtitle", "price", "image_url", "description",
    "teacher_name", "active", "sort_order", "raw_data", "sync_lms_status",
    "sync_portal_status", "sync_error", "is_published", "drive_folder_id",
    "drive_permission_mode", "expected_start_date", "sales_site",
    "learning_course_slug"
  ]),
  lessons: Object.freeze([
    "id", "course_id", "course_slug", "lesson_no", "title", "description",
    "video_provider", "video_url", "bunny_library_id", "bunny_video_id",
    "recipe_url", "document_url", "photo_url", "thumbnail_url", "duration_text",
    "level", "media_urls", "views", "is_free", "active", "status", "sort_order",
    "raw_data", "is_section", "materials", "kind", "parent_section_id", "position"
  ]),
  student_enrollments: Object.freeze([
    "id", "student_id", "course_id", "course_slug", "email", "status",
    "source_order_id", "drive_permission_status", "drive_permission_admin_email",
    "drive_permission_id", "drive_folder_id", "drive_permission_error",
    "drive_permission_retry_count", "normalized_email", "sync_correlation_id",
    "source_system"
  ]),
  lesson_progress: Object.freeze([
    "id", "email", "course_slug", "lesson_id", "progress_percent", "completed"
  ]),
  site_config: Object.freeze(["key", "value"])
});

export const BUSINESS_PRIMARY_KEYS = Object.freeze({
  courses: Object.freeze(["id"]),
  lessons: Object.freeze(["id"]),
  student_enrollments: Object.freeze(["id"]),
  lesson_progress: Object.freeze(["id"]),
  site_config: Object.freeze(["key"])
});

function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_NUMBER_FORBIDDEN");
    return value;
  }
  if (typeof value === "boolean" || typeof value === "string") return value;
  return String(value);
}

export function projectBusinessRow(table, row, columnOrder = BUSINESS_COLUMN_ALLOWLIST[table]) {
  const allowlist = BUSINESS_COLUMN_ALLOWLIST[table];
  if (!allowlist) throw new Error(`UNKNOWN_BUSINESS_TABLE:${table}`);
  if (
    columnOrder.length !== allowlist.length ||
    columnOrder.some((column) => !allowlist.includes(column))
  ) throw new Error(`BUSINESS_COLUMN_ALLOWLIST_MISMATCH:${table}`);

  // Key insertion order is deliberately irrelevant because canonicalValue sorts keys.
  return canonicalValue(Object.fromEntries(columnOrder.map((column) => [
    column,
    canonicalValue(Object.hasOwn(row, column) ? row[column] : null)
  ])));
}

export function canonicalBusinessPayload(tableRows, columnOrders = {}) {
  const tables = Object.keys(BUSINESS_COLUMN_ALLOWLIST).sort();
  return Object.fromEntries(tables.map((table) => {
    const keyColumns = BUSINESS_PRIMARY_KEYS[table];
    const rows = [...(tableRows[table] || [])]
      .map((row) => projectBusinessRow(table, row, columnOrders[table]))
      .sort((a, b) => {
        const left = JSON.stringify(keyColumns.map((key) => a[key]));
        const right = JSON.stringify(keyColumns.map((key) => b[key]));
        return left.localeCompare(right, "en");
      });
    return [table, rows];
  }));
}

export function businessDataChecksum(tableRows, columnOrders = {}) {
  const payload = canonicalBusinessPayload(tableRows, columnOrders);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function businessTableCounts(tableRows) {
  return Object.fromEntries(
    Object.keys(BUSINESS_COLUMN_ALLOWLIST)
      .sort()
      .map((table) => [table, (tableRows[table] || []).length])
  );
}

export function businessFieldChecksums(tableRows) {
  return Object.fromEntries(
    Object.keys(BUSINESS_COLUMN_ALLOWLIST).sort().map((table) => {
      const key = BUSINESS_PRIMARY_KEYS[table][0];
      const rows = [...(tableRows[table] || [])].sort((a, b) =>
        String(a[key]).localeCompare(String(b[key]), "en")
      );
      return [table, Object.fromEntries(BUSINESS_COLUMN_ALLOWLIST[table].map((column) => [
        column,
        crypto.createHash("sha256")
          .update(JSON.stringify(rows.map((row) => canonicalValue(row[column]))), "utf8")
          .digest("hex")
      ]))];
    })
  );
}

export function businessSelectList(table, alias = "t") {
  const columns = BUSINESS_COLUMN_ALLOWLIST[table];
  if (!columns) throw new Error(`UNKNOWN_BUSINESS_TABLE:${table}`);
  const prefix = alias ? `${alias}.` : "";
  return columns.map((column) => `${prefix}"${column}"`).join(",");
}
