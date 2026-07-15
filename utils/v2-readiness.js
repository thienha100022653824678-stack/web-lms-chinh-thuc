import { runV2Diagnostics } from './v2-diagnostics.js';
import {
  isV2ReconciliationEnabled,
  runV2ReadOnlyReconciliation,
} from './v2-reconciliation.js';

function compactError(error) {
  return String(error?.message || error || 'Unknown V2 readiness error').slice(0, 500);
}

function gate(name, ok, status, message, details = {}) {
  return {
    name,
    ok,
    status,
    message,
    ...details,
  };
}

function summarizeReconciliation(reconciliation) {
  if (!reconciliation) return null;

  return {
    ok: reconciliation.ok,
    code: reconciliation.code || null,
    issueCount: reconciliation.issueCount || 0,
    failedChecks: reconciliation.failedChecks || 0,
    checks: (reconciliation.checks || []).map((check) => ({
      name: check.name,
      ok: check.ok,
      issueCount: check.issueCount || 0,
      missingCourseId: check.missingCourseId,
      missingNormalizedEmail: check.missingNormalizedEmail,
      missingKind: check.missingKind,
      pendingCount: check.pendingCount,
      staleProcessingCount: check.staleProcessingCount,
      deadLetterCount: check.deadLetterCount,
      totalScanned: check.totalScanned,
      code: check.code || null,
      message: check.message || null,
    })),
  };
}

function getFlagEnabled(diagnostics, key) {
  return Boolean(diagnostics?.flags?.flags?.[key]?.enabled);
}

function getSecretConfigured(diagnostics, key) {
  return Boolean(diagnostics?.flags?.secretsConfigured?.[key]);
}

// §4 policy: a reconciliation "issue" is a tracked identity gap (e.g. an
// order row whose course_slug has no matching courses row). Runbook §4
// says these are NOT required to be 0 — they only need to appear in the
// reconciliation report. So the gate is healthy (ok) whenever the checks
// themselves ran without failure (failedChecks === 0). The gate is still
// marked 'review' while any tracked issues exist, so the readiness level
// caps at ready_for_dry_run (not ready_for_guarded_delivery) until the
// owner accepts or cleans the gaps.
export function buildGates(diagnostics, reconciliation) {
  const migrationOk = Boolean(diagnostics?.migrations?.ok);
  const outboxOk = Boolean(diagnostics?.outbox?.ok);
  const staleProcessingCount = Number(diagnostics?.outbox?.staleProcessingCount || 0);
  const deadLetters = Number(diagnostics?.outbox?.deadLetters || 0);
  const reconciliationEnabled = isV2ReconciliationEnabled();
  const reconciliationSummary = summarizeReconciliation(reconciliation);
  const workerSecretReady = (
    getSecretConfigured(diagnostics, 'V2_WORKER_SECRET')
    || getSecretConfigured(diagnostics, 'INTERNAL_SYNC_SECRET')
  );
  const liveDeliveryDisabled = !getFlagEnabled(diagnostics, 'DELIVERY_HANDLERS_ENABLED');
  const portalProjectionLiveDisabled = (
    !getFlagEnabled(diagnostics, 'PORTAL_PROJECTION_ENABLED')
    || getFlagEnabled(diagnostics, 'PORTAL_PROJECTION_DRY_RUN')
  );

  // Reconciliation check health = all checks ran without failure.
  // issueCount (tracked gaps) is surfaced but does not make the gate fail.
  const reconciliationChecksOk = Boolean(reconciliationSummary?.ok)
    && Number(reconciliationSummary?.failedChecks || 0) === 0;
  const reconciliationIssueCount = Number(reconciliationSummary?.issueCount || 0);
  const reconciliationCleanStatus = (
    reconciliationSummary && reconciliationChecksOk && reconciliationIssueCount === 0
  ) ? 'pass' : 'review';

  return [
    gate(
      'migrations_visible',
      migrationOk,
      migrationOk ? 'pass' : 'blocked',
      migrationOk
        ? 'Committed V2 tables and additive columns are visible to runtime.'
        : 'Apply and verify V2 migrations before any V2 runtime trial.',
      {
        missingTables: diagnostics?.migrations?.missingTables || [],
        missingColumnGroups: diagnostics?.migrations?.missingColumnGroups || [],
      }
    ),
    gate(
      'worker_secret_configured',
      workerSecretReady,
      workerSecretReady ? 'pass' : 'blocked',
      workerSecretReady
        ? 'Internal V2 endpoints can be protected by a configured worker secret.'
        : 'Configure V2_WORKER_SECRET or INTERNAL_SYNC_SECRET before using V2 internal endpoints.'
    ),
    gate(
      'outbox_readable',
      outboxOk,
      outboxOk ? 'pass' : 'blocked',
      outboxOk
        ? 'Outbox health can be read by runtime.'
        : 'Outbox tables are missing, unreadable, or returning an error.'
    ),
    gate(
      'outbox_no_stale_processing',
      staleProcessingCount === 0,
      staleProcessingCount === 0 ? 'pass' : 'review',
      staleProcessingCount === 0
        ? 'No stale processing outbox rows detected.'
        : 'Stale processing outbox rows need review before delivery tests.',
      { staleProcessingCount }
    ),
    gate(
      'outbox_no_dead_letters',
      deadLetters === 0,
      deadLetters === 0 ? 'pass' : 'review',
      deadLetters === 0
        ? 'No V2 dead letters detected.'
        : 'Dead letters exist and should be reviewed before cutover.',
      { deadLetters }
    ),
    gate(
      'reconciliation_enabled',
      reconciliationEnabled,
      reconciliationEnabled ? 'pass' : 'review',
      reconciliationEnabled
        ? 'Read-only reconciliation is enabled.'
        : 'Enable V2_RECONCILIATION_READONLY before considering guarded delivery.'
    ),
    gate(
      'reconciliation_clean',
      reconciliationChecksOk,
      reconciliationCleanStatus,
      reconciliationSummary
        ? reconciliationIssueCount > 0
          ? `Reconciliation ran with ${reconciliationIssueCount} tracked identity gap(s); review per runbook §4 before guarded delivery.`
          : 'Read-only reconciliation summary is clean.'
        : 'Read-only reconciliation has not run in this readiness check.',
      { reconciliation: reconciliationSummary }
    ),
    gate(
      'live_delivery_still_guarded',
      liveDeliveryDisabled,
      liveDeliveryDisabled ? 'pass' : 'review',
      liveDeliveryDisabled
        ? 'Live delivery handlers are disabled.'
        : 'Live V2 delivery handlers are enabled; verify this is intentional.'
    ),
    gate(
      'portal_projection_still_guarded',
      portalProjectionLiveDisabled,
      portalProjectionLiveDisabled ? 'pass' : 'review',
      portalProjectionLiveDisabled
        ? 'Portal projection is disabled or still in dry-run mode.'
        : 'Portal projection appears live; verify this is intentional.'
    ),
  ];
}

export function classifyReadiness(gates) {
  const blocked = gates.filter((item) => item.status === 'blocked');
  const reviews = gates.filter((item) => item.status === 'review');
  const reconciliationGate = gates.find((item) => item.name === 'reconciliation_clean');

  if (blocked.length > 0) {
    return {
      ok: false,
      level: 'blocked',
      summary: 'V2 is not ready for runtime trials.',
    };
  }

  if (reviews.length === 0) {
    return {
      ok: true,
      level: 'ready_for_guarded_delivery',
      summary: 'V2 looks ready for a tightly guarded delivery trial.',
    };
  }

  if (reconciliationGate?.ok) {
    return {
      ok: true,
      level: 'ready_for_dry_run',
      summary: 'V2 is ready for dry-run/shadow validation, but review gates remain before delivery.',
    };
  }

  return {
    ok: true,
    level: 'needs_review',
    summary: 'V2 can be observed, but reconciliation or operational review is still needed.',
  };
}

function buildNextActions(readiness, gates) {
  if (readiness.level === 'blocked') {
    return gates
      .filter((item) => item.status === 'blocked')
      .map((item) => item.message);
  }

  if (readiness.level === 'needs_review') {
    return [
      'Enable and run V2_RECONCILIATION_READONLY.',
      'Review every gate with status=review before enabling worker delivery.',
    ];
  }

  if (readiness.level === 'ready_for_dry_run') {
    return [
      'Keep V2_DELIVERY_HANDLERS_ENABLED=false.',
      'Run sync-worker with dryRun=true and inspect outbox/projection previews.',
      'Resolve any review gates before guarded delivery.',
    ];
  }

  return [
    'Run a small guarded delivery trial in staging or a non-critical course first.',
    'Keep rollback flags and V1 stable tags ready.',
  ];
}

export async function runV2Readiness() {
  try {
    const diagnostics = await runV2Diagnostics();
    const reconciliation = isV2ReconciliationEnabled()
      ? await runV2ReadOnlyReconciliation({ sampleLimit: 5 })
      : null;
    const gates = buildGates(diagnostics, reconciliation);
    const readiness = classifyReadiness(gates);

    return {
      ok: readiness.ok,
      mode: 'read_only',
      generatedAt: new Date().toISOString(),
      readiness,
      gates,
      diagnostics: {
        ok: diagnostics.ok,
        runtimeMode: diagnostics.flags?.runtimeMode,
        migrations: {
          ok: diagnostics.migrations?.ok,
          missingTables: diagnostics.migrations?.missingTables || [],
          missingColumnGroups: diagnostics.migrations?.missingColumnGroups || [],
        },
        outbox: diagnostics.outbox,
        flags: diagnostics.flags,
      },
      nextActions: buildNextActions(readiness, gates),
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'read_only',
      generatedAt: new Date().toISOString(),
      readiness: {
        ok: false,
        level: 'blocked',
        summary: 'V2 readiness check failed.',
      },
      error: 'V2 readiness check failed',
      message: compactError(error),
    };
  }
}
