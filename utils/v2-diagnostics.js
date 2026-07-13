import { supabase } from './supabase.js';
import { getV2RuntimeMode, isV2FlagEnabled, V2_FLAGS } from './v2-flags.js';

const REQUIRED_V2_TABLES = [
  'sync_outbox',
  'sync_deliveries',
  'sync_dead_letters',
  'course_slug_mappings',
  'portal_post_course_mappings',
];

const REQUIRED_COLUMN_CHECKS = [
  {
    table: 'orders',
    columns: 'id,course_id,normalized_customer_email,sync_correlation_id,source_system',
  },
  {
    table: 'student_enrollments',
    columns: 'id,course_id,normalized_email,sync_correlation_id,source_system',
  },
  {
    table: 'lessons',
    columns: 'id,kind,parent_section_id,position',
  },
];

const OUTBOX_STATUSES = ['pending', 'processing', 'delivered', 'failed', 'dead_letter'];

function compactError(error) {
  return String(error?.message || error || 'Unknown diagnostic error').slice(0, 500);
}

async function checkTable(table) {
  const { error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true });

  if (!error) {
    return { table, ok: true, status: 'present' };
  }

  return {
    table,
    ok: false,
    status: 'missing_or_unreadable',
    message: compactError(error),
  };
}

async function checkColumns(check) {
  const { error } = await supabase
    .from(check.table)
    .select(check.columns)
    .limit(1);

  if (!error) {
    return {
      table: check.table,
      ok: true,
      status: 'present',
      columns: check.columns.split(','),
    };
  }

  return {
    table: check.table,
    ok: false,
    status: 'missing_or_unreadable',
    columns: check.columns.split(','),
    message: compactError(error),
  };
}

async function countRows(table, buildQuery) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (buildQuery) query = buildQuery(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function getOutboxStatusCounts() {
  const checks = await Promise.all(
    OUTBOX_STATUSES.map(async (status) => ({
      status,
      count: await countRows('sync_outbox', (query) => query.eq('status', status)),
    }))
  );

  return checks.reduce((result, item) => {
    result[item.status] = item.count;
    return result;
  }, {});
}

async function getOutboxHealth() {
  try {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const counts = await getOutboxStatusCounts();
    const staleProcessingCount = await countRows('sync_outbox', (query) => (
      query.eq('status', 'processing').lt('locked_at', staleBefore)
    ));
    const pendingDeliveries = await countRows('sync_deliveries', (query) => query.eq('status', 'pending'));
    const deadLetters = await countRows('sync_dead_letters');

    return {
      ok: true,
      counts,
      staleProcessingCount,
      pendingDeliveries,
      deadLetters,
    };
  } catch (error) {
    return {
      ok: false,
      message: compactError(error),
    };
  }
}

function getFlagSnapshot() {
  return {
    runtimeMode: getV2RuntimeMode(),
    flags: Object.fromEntries(
      Object.entries(V2_FLAGS).map(([key, envName]) => [
        key,
        {
          envName,
          enabled: isV2FlagEnabled(envName),
        },
      ])
    ),
    secretsConfigured: {
      V2_WORKER_SECRET: !!process.env.V2_WORKER_SECRET,
      INTERNAL_SYNC_SECRET: !!process.env.INTERNAL_SYNC_SECRET,
    },
  };
}

function summarizeMigrationStatus(tableChecks, columnChecks) {
  const missingTables = tableChecks.filter((check) => !check.ok).map((check) => check.table);
  const missingColumnGroups = columnChecks.filter((check) => !check.ok).map((check) => check.table);

  return {
    ok: missingTables.length === 0 && missingColumnGroups.length === 0,
    missingTables,
    missingColumnGroups,
  };
}

export async function runV2Diagnostics() {
  const [tableChecks, columnChecks, outboxHealth] = await Promise.all([
    Promise.all(REQUIRED_V2_TABLES.map(checkTable)),
    Promise.all(REQUIRED_COLUMN_CHECKS.map(checkColumns)),
    getOutboxHealth(),
  ]);

  const migrationStatus = summarizeMigrationStatus(tableChecks, columnChecks);

  return {
    ok: migrationStatus.ok,
    mode: 'read_only',
    generatedAt: new Date().toISOString(),
    flags: getFlagSnapshot(),
    migrations: {
      ok: migrationStatus.ok,
      tableChecks,
      columnChecks,
      missingTables: migrationStatus.missingTables,
      missingColumnGroups: migrationStatus.missingColumnGroups,
    },
    outbox: outboxHealth,
    nextAction: migrationStatus.ok
      ? 'V2 database foundation is visible to runtime. Keep write handlers disabled until staging verification passes.'
      : 'Apply and verify committed V2 migrations before enabling any V2 worker delivery handlers.',
  };
}
