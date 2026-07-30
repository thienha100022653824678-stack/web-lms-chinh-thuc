import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import {
  BUSINESS_COLUMN_ALLOWLIST,
  BUSINESS_PRIMARY_KEYS,
  businessDataChecksum,
  businessSelectList,
  businessTableCounts
} from "../lib/dual-lms-business-checksum.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXPECTED_REF = "plgrmaktvudjetfkwmyg";
const FORBIDDEN_REF = "aqozjkfwzmyfunqvcyjv";
const ARTIFACT_DIR = path.join(ROOT, "_local_artifacts", "lms-admin-dual-lms-preview");
const SUBSTRATE_TABLES = [
  "courses", "orders", "lessons", "site_config", "students", "student_enrollments",
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
    application_name: "lms-admin-dual-lms-preview-gate"
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
    const nonSyntheticOrders = Number((await client.query(`
      select count(*)::int count from public.orders
      where order_code is null or order_code not like 'PREVIEW-%'
         or (customer_email is not null and lower(customer_email) not like '%@example.test')
    `)).rows[0].count);
    if (nonSyntheticOrders) {
      throw new Error(`PREVIEW_CONTAINS_NON_SYNTHETIC_ORDERS:${nonSyntheticOrders}`);
    }
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
    select slug,title,sales_site,learning_course_slug,lms_tenant
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
    where table_schema='public' and table_name='courses' and column_name='lms_tenant'
  `)).rows[0] || null;
  const constraints = (await client.query(`
    select conname,pg_get_constraintdef(oid) definition
    from pg_constraint
    where conrelid='public.courses'::regclass
      and conname in ('courses_lms_tenant_check','courses_slug_key')
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

async function businessSnapshot(client) {
  const rows = {};
  for (const table of Object.keys(BUSINESS_COLUMN_ALLOWLIST)) {
    const exists = (await client.query(
      `select to_regclass($1) is not null exists`,
      [`public.${table}`]
    )).rows[0].exists;
    rows[table] = exists
      ? (await client.query(
        `select ${businessSelectList(table)} from public.${pg.escapeIdentifier(table)} t
         order by ${BUSINESS_PRIMARY_KEYS[table].map((column) => `t.${pg.escapeIdentifier(column)}`).join(",")}`
      )).rows
      : [];
  }
  return {
    checksum: businessDataChecksum(rows),
    counts: businessTableCounts(rows),
    tableChecksums: Object.fromEntries(
      Object.keys(BUSINESS_COLUMN_ALLOWLIST).sort().map((table) => [
        table,
        businessDataChecksum(Object.fromEntries(
          Object.keys(BUSINESS_COLUMN_ALLOWLIST).map((name) => [name, name === table ? rows[name] : []])
        ))
      ])
    ),
    fieldChecksums: Object.fromEntries(
      Object.keys(BUSINESS_COLUMN_ALLOWLIST).sort().map((table) => [
        table,
        Object.fromEntries(BUSINESS_COLUMN_ALLOWLIST[table].map((column) => [
          column,
          stableChecksum(
            [...rows[table]]
              .sort((a, b) => String(a[BUSINESS_PRIMARY_KEYS[table][0]]).localeCompare(
                String(b[BUSINESS_PRIMARY_KEYS[table][0]]), "en"
              ))
              .map((row) => row[column] ?? null)
          )
        ]))
      ])
    ),
    rows
  };
}

async function dualLmsSchemaSnapshot(client) {
  const result = {
    column: (await client.query(`
      select column_name,data_type,is_nullable,column_default
      from information_schema.columns
      where table_schema='public' and table_name='courses'
      order by ordinal_position
    `)).rows,
    constraints: (await client.query(`
      select conname,pg_get_constraintdef(oid,true) definition
      from pg_constraint where conrelid='public.courses'::regclass order by conname
    `)).rows,
    indexes: (await client.query(`
      select indexname,indexdef from pg_indexes
      where schemaname='public' and tablename='courses' order by indexname
    `)).rows,
    learningSiteComment: (await client.query(`
      select col_description('public.courses'::regclass,ordinal_position::int) comment
      from information_schema.columns where table_schema='public'
        and table_name='courses' and column_name='lms_tenant'
    `)).rows[0]?.comment || null
  };
  return { ...result, checksum: stableChecksum(result) };
}

function expectedSchemaDeltaMatches(before, after) {
  const newColumn = after.column.find((row) => row.column_name === "lms_tenant");
  const unchangedColumns = after.column.filter((row) => row.column_name !== "lms_tenant");
  const newConstraintNames = new Set(["courses_lms_tenant_check"]);
  const newIndexNames = new Set([
    "idx_courses_lms_tenant",
    "idx_courses_lms_tenant_active_status",
    "idx_courses_learning_target_tenant"
  ]);
  const unchangedConstraints = after.constraints.filter((row) => !newConstraintNames.has(row.conname));
  const unchangedIndexes = after.indexes.filter((row) => !newIndexNames.has(row.indexname));
  const constraint = after.constraints.find((row) => row.conname === "courses_lms_tenant_check");
  const actualNewIndexes = after.indexes.filter((row) => newIndexNames.has(row.indexname));
  return Boolean(
    newColumn?.data_type === "text" &&
    newColumn?.is_nullable === "YES" &&
    newColumn?.column_default === null &&
    stableChecksum(unchangedColumns) === stableChecksum(before.column) &&
    stableChecksum(unchangedConstraints) === stableChecksum(before.constraints) &&
    stableChecksum(unchangedIndexes) === stableChecksum(before.indexes) &&
    constraint?.definition.includes("lms_tenant IS NULL") &&
    constraint?.definition.includes("yeunauan") &&
    constraint?.definition.includes("yeubep") &&
    actualNewIndexes.length === 3 &&
    after.learningSiteComment === "Logical LMS content owner. Nullable for deterministic legacy compatibility."
  );
}

async function withRolledBackMutation(client, action) {
  await client.query("begin");
  try {
    return await action();
  } finally {
    await client.query("rollback");
  }
}

async function negativeControls(client, baseline) {
  const baselineChecksum = baseline.checksum;
  const first = (await client.query(`select id,slug,sales_site,learning_course_slug from public.courses order by id limit 1`)).rows[0];
  const second = (await client.query(`select id,slug from public.courses where id<>$1 order by id limit 1`, [first.id])).rows[0];
  const changed = async (sql, params) => withRolledBackMutation(client, async () => {
    await client.query(sql, params);
    return (await businessSnapshot(client)).checksum !== baselineChecksum;
  });
  const titleDetected = await changed(`update public.courses set title=title || ' NEGATIVE' where id=$1`, [first.id]);
  const slugDetected = await changed(`update public.courses set slug=slug || '-negative' where id=$1`, [first.id]);
  const salesSiteDetected = await changed(
    `update public.courses set sales_site=case when sales_site='yeunauan' then 'yeubep' else 'yeunauan' end where id=$1`,
    [first.id]
  );
  const targetDetected = await withRolledBackMutation(client, async () => {
    await client.query(`update public.courses set learning_course_slug='missing-negative-target' where id=$1`, [first.id]);
    const checksumChanged = (await businessSnapshot(client)).checksum !== baselineChecksum;
    const unresolved = Number((await client.query(`
      select count(*)::int count from public.courses c
      left join public.courses target on target.slug=coalesce(nullif(trim(c.learning_course_slug),''),c.slug)
      where target.id is null
    `)).rows[0].count);
    return checksumChanged && unresolved > 0;
  });
  const deleteDetected = await withRolledBackMutation(client, async () => {
    await client.query(`delete from public.lessons where id=(select id from public.lessons order by id limit 1)`);
    const current = await businessSnapshot(client);
    return current.checksum !== baselineChecksum &&
      current.counts.lessons !== baseline.counts.lessons;
  });
  const addDetected = await withRolledBackMutation(client, async () => {
    await client.query(`
      insert into public.courses(id,slug,title,active,is_published,sales_site,learning_course_slug,lms_tenant)
      values(gen_random_uuid(),'preview-negative-added','Negative added',false,false,'yeunauan','preview-negative-added',null)
    `);
    const current = await businessSnapshot(client);
    return current.checksum !== baselineChecksum;
  });
  const collisionDetected = await withRolledBackMutation(client, async () => {
    try {
      await client.query(`update public.courses set slug=$1 where id=$2`, [second.slug, first.id]);
      return false;
    } catch (error) {
      return error.code === "23505";
    }
  });
  const explicitSiteDetected = await withRolledBackMutation(client, async () => {
    await client.query(`update public.courses set lms_tenant='yeunauan' where id=$1`, [first.id]);
    return Number((await client.query(`select count(*)::int count from public.courses where lms_tenant is not null`)).rows[0].count) > 0;
  });
  return {
    titleDetected, slugDetected, salesSiteDetected, targetDetected,
    addDetected, deleteDetected, collisionDetected, explicitSiteDetected
  };
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
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_substrate.sql");
    const migrationStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant.sql");
    const migrationDurationMs = Number((performance.now() - migrationStarted).toFixed(3));
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_seed.sql");
    const firstSeed = await seedEvidence(client);
    const firstContract = await migrationContract(client);
    const idempotentStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant.sql");
    const idempotentDurationMs = Number((performance.now() - idempotentStarted).toFixed(3));
    const idempotentContract = await migrationContract(client);
    const first = await snapshot(client, `rehearsal-first-forward-${Date.now()}`);
    const rollbackStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant_rollback.sql");
    const rollbackDurationMs = Number((performance.now() - rollbackStarted).toFixed(3));
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_substrate_rollback.sql");
    const rolledBack = await snapshot(client, `rehearsal-rollback-${Date.now()}`);
    if (rolledBack.v5Checksum !== beforeV5) throw new Error("V5_CHECKSUM_CHANGED_AFTER_ROLLBACK");
    if (rolledBack.catalog.tables.some((row) => SUBSTRATE_TABLES.filter((x) => x !== "student_enrollments").includes(row.name))) {
      throw new Error("SUBSTRATE_OBJECT_REMAINS_AFTER_ROLLBACK");
    }
    await setGuard(client);
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_substrate.sql");
    const reapplyStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant.sql");
    const reapplyDurationMs = Number((performance.now() - reapplyStarted).toFixed(3));
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_seed.sql");
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
  } else if (command === "checksum-rehearse") {
    await client.query(`set lock_timeout='5s'; set statement_timeout='30s'`);
    const previewBefore = await snapshot(client, `checksum-rehearsal-before-${Date.now()}`);
    await assertSyntheticOnly(client, previewBefore);
    const beforeV5 = previewBefore.v5Checksum;

    // Normalize the guarded synthetic substrate to the exact pre-migration shape.
    await setGuard(client);
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_substrate.sql");
    await applySql(client, "migrations/20260730_dual_lms_tenant_rollback.sql");
    const businessBefore = await businessSnapshot(client);
    const schemaBefore = await dualLmsSchemaSnapshot(client);

    const migrationStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant.sql");
    const migrationDurationMs = Number((performance.now() - migrationStarted).toFixed(3));
    const businessAfter = await businessSnapshot(client);
    const schemaAfter = await dualLmsSchemaSnapshot(client);
    const contractAfter = await migrationContract(client);
    const siteInvariant = (await client.query(`
      select count(*) filter(where lms_tenant is null)::int null_count,
        count(*) filter(where lms_tenant is not null)::int non_null_count,
        count(*) filter(where lms_tenant is not null and lms_tenant not in ('yeunauan','yeubep'))::int invalid_count
      from public.courses
    `)).rows[0];
    const duplicateSlugs = Number((await client.query(`
      select count(*)::int count from (select slug from public.courses group by slug having count(*)>1) d
    `)).rows[0].count);
    const unresolved = Number((await client.query(`
      select count(*)::int count from public.courses c
      left join public.courses target on target.slug=coalesce(nullif(trim(c.learning_course_slug),''),c.slug)
      where target.id is null
    `)).rows[0].count);
    const controls = await negativeControls(client, businessAfter);
    if (Object.values(controls).some((value) => value !== true)) {
      throw new Error(`NEGATIVE_CONTROL_FAILED:${JSON.stringify(controls)}`);
    }
    const idempotentStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant.sql");
    const idempotentDurationMs = Number((performance.now() - idempotentStarted).toFixed(3));
    const idempotentSchema = await dualLmsSchemaSnapshot(client);

    const rollbackStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant_rollback.sql");
    const rollbackDurationMs = Number((performance.now() - rollbackStarted).toFixed(3));
    const businessRollback = await businessSnapshot(client);
    const schemaRollback = await dualLmsSchemaSnapshot(client);

    const reapplyStarted = performance.now();
    await applySql(client, "migrations/20260730_dual_lms_tenant.sql");
    const reapplyDurationMs = Number((performance.now() - reapplyStarted).toFixed(3));
    const businessReapply = await businessSnapshot(client);
    const schemaReapply = await dualLmsSchemaSnapshot(client);

    const expectedDelta = expectedSchemaDeltaMatches(schemaBefore, schemaAfter);
    const checks = {
      business_after_match: businessBefore.checksum === businessAfter.checksum,
      counts_after_match: stableChecksum(businessBefore.counts) === stableChecksum(businessAfter.counts),
      expected_schema_delta_match: expectedDelta,
      lms_tenant_all_null: Number(siteInvariant.null_count) === businessAfter.counts.courses &&
        Number(siteInvariant.non_null_count) === 0 && Number(siteInvariant.invalid_count) === 0,
      duplicate_slug_zero: duplicateSlugs === 0,
      unresolved_zero: unresolved === 0,
      rollback_business_match: businessBefore.checksum === businessRollback.checksum,
      rollback_schema_match: schemaBefore.checksum === schemaRollback.checksum,
      reapply_business_match: businessBefore.checksum === businessReapply.checksum,
      reapply_schema_deterministic: schemaAfter.checksum === schemaReapply.checksum,
      second_apply_idempotent: schemaAfter.checksum === idempotentSchema.checksum,
      global_slug_unique_preserved: contractAfter.constraints.some((row) =>
        row.definition.includes("UNIQUE (slug)")
      ),
      enrollment_identity_preserved: Number(contractAfter.enrollmentUnique) === 1
    };
    if (Object.values(checks).some((value) => value !== true)) {
      throw new Error(`CHECKSUM_REHEARSAL_FAILED:${JSON.stringify(checks)}`);
    }

    // Restore the deterministic synthetic Preview owners while retaining the migrated schema.
    await applySql(client, "migrations/preview/20260730_dual_lms_preview_seed.sql");
    const previewFinal = await snapshot(client, `checksum-rehearsal-final-${Date.now()}`);
    if (previewFinal.v5Checksum !== beforeV5) throw new Error("V5_CHECKSUM_CHANGED_DURING_CHECKSUM_REHEARSAL");

    console.log(JSON.stringify({
      ok: true,
      preview_ref: EXPECTED_REF,
      BUSINESS_DATA_CHECKSUM_BEFORE: businessBefore.checksum,
      BUSINESS_DATA_CHECKSUM_AFTER: businessAfter.checksum,
      BUSINESS_DATA_CHECKSUM_MATCH: checks.business_after_match,
      SCHEMA_CHECKSUM_BEFORE: schemaBefore.checksum,
      SCHEMA_CHECKSUM_AFTER: schemaAfter.checksum,
      EXPECTED_SCHEMA_DELTA_MATCH: checks.expected_schema_delta_match,
      LMS_TENANT_NULL_COUNT: Number(siteInvariant.null_count),
      LMS_TENANT_NON_NULL_COUNT: Number(siteInvariant.non_null_count),
      INVALID_LMS_TENANT_COUNT: Number(siteInvariant.invalid_count),
      counts: businessAfter.counts,
      table_checksums: businessAfter.tableChecksums,
      student_enrollment_field_checksums: businessAfter.fieldChecksums.student_enrollments,
      checks,
      negative_controls: controls,
      v5_checksum_before: beforeV5,
      v5_checksum_after: previewFinal.v5Checksum,
      timeouts: { lock_timeout: "5s", statement_timeout: "30s" },
      durations_ms: {
        migration: migrationDurationMs,
        idempotent_second_apply: idempotentDurationMs,
        rollback: rollbackDurationMs,
        reapply: reapplyDurationMs
      }
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
