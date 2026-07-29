import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXPECTED_REF = "plgrmaktvudjetfkwmyg";
const FORBIDDEN_REF = "aqozjkfwzmyfunqvcyjv";
const ARTIFACT_DIR = path.join(ROOT, "_local_artifacts", "lms-admin-multisite-preview");
const SUBSTRATE_TABLES = [
  "courses", "lessons", "site_config", "students", "student_enrollments",
  "lesson_progress", "admin_audit_logs", "drive_permission_logs",
  "drive_sync_queue", "drive_admin_accounts"
];

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || /^\s*#/.test(line)) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function resolveEnvFile() {
  const explicit = process.env.LMS_PREVIEW_ENV_FILE;
  if (explicit) return path.resolve(explicit);
  const local = path.join(ROOT, ".env.local");
  if (fs.existsSync(local)) return local;
  throw new Error("PREVIEW_ENV_FILE_REQUIRED");
}

function connectionConfig(env) {
  const api = new URL(env.SUPABASE_URL);
  const direct = new URL(env.V5_PREVIEW_DATABASE_URL || env.DATABASE_URL);
  const apiRef = api.hostname.split(".")[0];
  const productionDetected = [api.hostname, direct.hostname, env.V5_PREVIEW_SUPABASE_REF]
    .some((value) => String(value || "").includes(FORBIDDEN_REF));
  if (productionDetected || String(env.VERCEL_ENV || "").toLowerCase() === "production") {
    throw Object.assign(new Error("PRODUCTION_DATABASE_FORBIDDEN"), { code: "PRODUCTION_DATABASE_FORBIDDEN" });
  }
  if (
    apiRef !== EXPECTED_REF ||
    !direct.hostname.includes(EXPECTED_REF) ||
    env.V5_PREVIEW_SUPABASE_REF !== EXPECTED_REF ||
    env.V5_FORBIDDEN_PRODUCTION_SUPABASE_REF !== FORBIDDEN_REF ||
    env.V5_INTEGRATION_PREVIEW !== "1"
  ) throw new Error("PREVIEW_RESOURCE_IDENTITY_MISMATCH");
  return {
    host: "aws-0-ap-northeast-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${EXPECTED_REF}`,
    password: decodeURIComponent(direct.password),
    database: direct.pathname.slice(1) || "postgres",
    ssl: { rejectUnauthorized: false },
    application_name: "lms-admin-multisite-preview-gate"
  };
}

function stableChecksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function snapshot(client, label) {
  const queries = {
    extensions: `select extname,extversion from pg_extension order by extname`,
    tables: `select n.nspname schema,c.relname name,c.relkind kind,c.relrowsecurity rls
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' order by c.relname`,
    columns: `select table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
    functions: `select p.proname name,pg_get_function_identity_arguments(p.oid) args,p.prosecdef security_definer
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' order by p.proname,args`,
    policies: `select tablename,policyname,roles,cmd,qual,with_check
      from pg_policies where schemaname='public' order by tablename,policyname`,
    grants: `select grantee,table_name,privilege_type
      from information_schema.role_table_grants where table_schema='public'
      order by table_name,grantee,privilege_type`,
    counts: `select c.relname name,greatest(c.reltuples,0)::bigint estimated_rows
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' order by c.relname`
  };
  const catalog = {};
  for (const [key, sql] of Object.entries(queries)) catalog[key] = (await client.query(sql)).rows;
  const exactCounts = {};
  for (const table of catalog.tables.filter((x) => x.kind === "r").map((x) => x.name)) {
    exactCounts[table] = Number((await client.query(`select count(*)::int count from public.${pg.escapeIdentifier(table)}`)).rows[0].count);
  }
  const v5Tables = catalog.tables
    .filter((x) => x.kind === "r" && x.name.startsWith("lms_v5_"))
    .map((x) => x.name);
  const v5DataChecksums = {};
  for (const table of v5Tables) {
    const data = (await client.query(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data
       from public.${pg.escapeIdentifier(table)} t`
    )).rows[0].data;
    v5DataChecksums[table] = stableChecksum(data);
  }
  const v5Catalog = {
    tables: catalog.tables.filter((x) => x.name.startsWith("lms_v5_")),
    columns: catalog.columns.filter((x) => x.table_name.startsWith("lms_v5_")),
    functions: catalog.functions.filter((x) => x.name.startsWith("lms_v5_")),
    policies: catalog.policies.filter((x) => x.tablename.startsWith("lms_v5_")),
    counts: Object.fromEntries(v5Tables.map((name) => [name, exactCounts[name]])),
    dataChecksums: v5DataChecksums
  };
  const result = {
    label,
    previewRef: EXPECTED_REF,
    capturedAt: new Date().toISOString(),
    catalog,
    exactCounts,
    catalogChecksum: stableChecksum({
      catalog: { ...catalog, counts: undefined },
      exactCounts
    }),
    v5Checksum: stableChecksum(v5Catalog)
  };
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACT_DIR, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return result;
}

async function assertSyntheticOnly(client, snapshotResult) {
  if (snapshotResult.catalog.tables.some((row) => row.name === "orders")) {
    throw new Error("PREVIEW_CONTAINS_ORDERS");
  }
  const emailTables = snapshotResult.catalog.columns
    .filter((row) => row.column_name === "email")
    .map((row) => row.table_name);
  for (const table of emailTables) {
    const bad = Number((await client.query(
      `select count(*)::int count from public.${pg.escapeIdentifier(table)}
       where email is not null and lower(email) not like '%@example.test'`
    )).rows[0].count);
    if (bad) throw new Error(`PREVIEW_CONTAINS_NON_SYNTHETIC_EMAIL:${table}:${bad}`);
  }
  const nonPreviewCourses = snapshotResult.catalog.tables.some((row) => row.name === "courses")
    ? Number((await client.query(`select count(*)::int count from public.courses where slug not like 'preview-%'`)).rows[0].count)
    : 0;
  if (nonPreviewCourses) throw new Error(`PREVIEW_CONTAINS_NON_FIXTURE_COURSES:${nonPreviewCourses}`);
}

async function applySql(client, relativePath) {
  const sql = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  await client.query(sql);
}

async function setGuard(client) {
  await client.query("select set_config('lms.preview_guard','1',false), set_config('lms.preview_ref',$1,false)", [EXPECTED_REF]);
}

async function seedEvidence(client) {
  const counts = {};
  for (const table of SUBSTRATE_TABLES) {
    counts[table] = Number((await client.query(`select count(*)::int count from public.${pg.escapeIdentifier(table)}`)).rows[0].count);
  }
  const rows = (await client.query(`
    select slug,title,sales_site,learning_course_slug,learning_site
    from public.courses where slug like 'preview-%' order by slug
  `)).rows;
  const lessons = (await client.query(`
    select course_slug,lesson_no,title,is_section,status,video_provider,video_url,materials,raw_data
    from public.lessons where course_slug like 'preview-%' order by course_slug,lesson_no
  `)).rows;
  const enrollments = (await client.query(`
    select email,course_slug,status from public.student_enrollments
    where email in (
      'student-a.yeunauan@example.test','student-b.yeubep@example.test',
      'student-no-enrollment@example.test','student-revoked@example.test','student-shared@example.test'
    ) order by email,course_slug
  `)).rows;
  return { counts, checksum: stableChecksum({ rows, lessons, enrollments }) };
}

async function migrationContract(client) {
  const column = (await client.query(`
    select data_type,is_nullable
    from information_schema.columns
    where table_schema='public' and table_name='courses' and column_name='learning_site'
  `)).rows[0] || null;
  const constraints = (await client.query(`
    select conname,pg_get_constraintdef(oid) definition
    from pg_constraint
    where conrelid='public.courses'::regclass
      and conname in ('courses_learning_site_check','courses_slug_key')
    order by conname
  `)).rows;
  const indexes = (await client.query(`
    select indexname,indexdef from pg_indexes
    where schemaname='public' and tablename='courses'
    order by indexname
  `)).rows;
  const enrollmentUnique = (await client.query(`
    select count(*)::int count from pg_constraint
    where conrelid='public.student_enrollments'::regclass
      and contype='u' and pg_get_constraintdef(oid) like '%(email, course_slug)%'
  `)).rows[0].count;
  return { column, constraints, indexes, enrollmentUnique };
}

const env = loadEnv(resolveEnvFile());
const client = new pg.Client(connectionConfig(env));
try {
  await client.connect();
  const command = process.argv[2] || "preflight";
  if (command === "preflight") {
    const before = await snapshot(client, `before-substrate-${Date.now()}`);
    await assertSyntheticOnly(client, before);
    console.log(JSON.stringify({
      ok: true, previewRef: EXPECTED_REF, catalogChecksum: before.catalogChecksum,
      v5Checksum: before.v5Checksum, exactCounts: before.exactCounts
    }));
  } else if (command === "rehearse") {
    await client.query(`set lock_timeout='5s'; set statement_timeout='30s'`);
    const before = await snapshot(client, `rehearsal-before-${Date.now()}`);
    await assertSyntheticOnly(client, before);
    const beforeV5 = before.v5Checksum;
    await setGuard(client);
    await applySql(client, "migrations/preview/20260729_lms_b05_preview_substrate.sql");
    const migrationStarted = performance.now();
    await applySql(client, "migrations/20260729_lms_learning_site.sql");
    const migrationDurationMs = Number((performance.now() - migrationStarted).toFixed(3));
    await applySql(client, "migrations/preview/20260729_lms_b05_preview_seed.sql");
    const firstSeed = await seedEvidence(client);
    const firstContract = await migrationContract(client);
    const idempotentStarted = performance.now();
    await applySql(client, "migrations/20260729_lms_learning_site.sql");
    const idempotentDurationMs = Number((performance.now() - idempotentStarted).toFixed(3));
    const idempotentContract = await migrationContract(client);
    const first = await snapshot(client, `rehearsal-first-forward-${Date.now()}`);
    const rollbackStarted = performance.now();
    await applySql(client, "migrations/20260729_lms_learning_site_rollback.sql");
    const rollbackDurationMs = Number((performance.now() - rollbackStarted).toFixed(3));
    await applySql(client, "migrations/preview/20260729_lms_b05_preview_substrate_rollback.sql");
    const rolledBack = await snapshot(client, `rehearsal-rollback-${Date.now()}`);
    if (rolledBack.v5Checksum !== beforeV5) throw new Error("V5_CHECKSUM_CHANGED_AFTER_ROLLBACK");
    if (rolledBack.catalog.tables.some((row) => SUBSTRATE_TABLES.filter((x) => x !== "student_enrollments").includes(row.name))) {
      throw new Error("SUBSTRATE_OBJECT_REMAINS_AFTER_ROLLBACK");
    }
    await setGuard(client);
    await applySql(client, "migrations/preview/20260729_lms_b05_preview_substrate.sql");
    const reapplyStarted = performance.now();
    await applySql(client, "migrations/20260729_lms_learning_site.sql");
    const reapplyDurationMs = Number((performance.now() - reapplyStarted).toFixed(3));
    await applySql(client, "migrations/preview/20260729_lms_b05_preview_seed.sql");
    const secondSeed = await seedEvidence(client);
    if (firstSeed.checksum !== secondSeed.checksum) throw new Error("SEED_CHECKSUM_NOT_REPRODUCIBLE");
    const final = await snapshot(client, `rehearsal-final-${Date.now()}`);
    if (final.v5Checksum !== beforeV5) throw new Error("V5_CHECKSUM_CHANGED_AFTER_REAPPLY");
    console.log(JSON.stringify({
      ok: true, previewRef: EXPECTED_REF, beforeCatalogChecksum: before.catalogChecksum,
      v5Checksum: beforeV5, rollbackCatalogChecksum: rolledBack.catalogChecksum,
      finalCatalogChecksum: final.catalogChecksum, seedChecksum: secondSeed.checksum,
      counts: secondSeed.counts,
      timeouts: { lock_timeout: "5s", statement_timeout: "30s" },
      durations_ms: {
        migration: migrationDurationMs,
        idempotent_second_apply: idempotentDurationMs,
        rollback: rollbackDurationMs,
        reapply: reapplyDurationMs
      },
      contract: firstContract,
      idempotent_contract_unchanged:
        stableChecksum(firstContract) === stableChecksum(idempotentContract)
    }));
  } else if (command === "snapshot") {
    const result = await snapshot(client, `snapshot-${Date.now()}`);
    console.log(JSON.stringify({ ok: true, catalogChecksum: result.catalogChecksum, v5Checksum: result.v5Checksum, exactCounts: result.exactCounts }));
  } else {
    throw new Error(`UNKNOWN_COMMAND:${command}`);
  }
} catch (error) {
  console.error(error.code === "PRODUCTION_DATABASE_FORBIDDEN" ? error.code : `${error.name}:${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
