param(
  [string]$ProjectRef = "plgrmaktvudjetfkwmyg"
)

$ErrorActionPreference = "Stop"
$ExpectedRef = "plgrmaktvudjetfkwmyg"
$ForbiddenRef = "aqozjkfwzmyfunqvcyjv"
if ($ProjectRef -ne $ExpectedRef -or $ProjectRef -eq $ForbiddenRef) {
  throw "PRODUCTION_DATABASE_FORBIDDEN"
}

$credentialSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DualLmsCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredRead(string target, uint type, int flags, out IntPtr pointer);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr pointer);
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    try {
      var credential = Marshal.PtrToStructure<Credential>(pointer);
      var bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(pointer); }
  }
}
'@
if (-not ("DualLmsCredentialReader" -as [type])) {
  Add-Type -TypeDefinition $credentialSource
}
$accessToken = [DualLmsCredentialReader]::Read("Supabase CLI:supabase")
if ($accessToken -notmatch "^sbp_") { throw "SUPABASE_ACCESS_TOKEN_UNAVAILABLE" }
$headers = @{ Authorization = "Bearer $accessToken"; "Content-Type" = "application/json" }
$queryUri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"

function Invoke-PreviewSql([string]$Sql) {
  $body = @{ query = $Sql } | ConvertTo-Json -Compress
  return @(Invoke-RestMethod -Method Post -Uri $queryUri -Headers $headers -Body $body)
}

function Invoke-GuardedFile([string]$RelativePath) {
  $sql = Get-Content -LiteralPath $RelativePath -Raw
  $guard = "select set_config('lms.preview_guard','1',false), set_config('lms.preview_ref','$ExpectedRef',false);"
  [void](Invoke-PreviewSql "$guard`n$sql")
}

function Get-BusinessSnapshot {
  $courseSql = @'
select count(*)::int row_count,
 encode(digest(coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'slug',slug,'title',title,'subtitle',subtitle,'price',price,'image_url',image_url,
  'description',description,'teacher_name',teacher_name,'raw_data',raw_data,'active',active,
  'is_published',is_published,'sort_order',sort_order,'sync_lms_status',sync_lms_status,
  'sync_portal_status',sync_portal_status,'sync_error',sync_error,'drive_folder_id',drive_folder_id,
  'drive_permission_mode',drive_permission_mode,'expected_start_date',expected_start_date,
  'sales_site',sales_site,'learning_course_slug',learning_course_slug
) order by id),'[]'::jsonb)::text,'sha256'),'hex') checksum
from public.courses;
'@
  $orderSql = @'
select count(*)::int row_count,
 encode(digest(coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'order_code',order_code,'course_slug',course_slug,
  'learning_course_slug',learning_course_slug,'sales_site',sales_site,
  'status',status,'customer_email',customer_email,'raw_data',raw_data
) order by id),'[]'::jsonb)::text,'sha256'),'hex') checksum
from public.orders;
'@
  return @{
    courses = (Invoke-PreviewSql $courseSql)[0]
    orders = (Invoke-PreviewSql $orderSql)[0]
  }
}

function Get-V5Snapshot {
  $tables = Invoke-PreviewSql "select tablename from pg_tables where schemaname='public' and tablename like 'lms_v5_%' order by tablename"
  $result = [ordered]@{}
  foreach ($row in $tables) {
    $table = [string]$row.tablename
    if ($table -notmatch "^lms_v5_[a-z0-9_]+$") { throw "INVALID_V5_TABLE_NAME" }
    $result[$table] = (Invoke-PreviewSql @"
select count(*)::int row_count,
 encode(digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'sha256'),'hex') checksum
from public.$table t
"@)[0]
  }
  return $result
}

$startedAt = (Get-Date).ToUniversalTime()
$identity = (Invoke-PreviewSql "select current_database() database, current_user db_user")[0]
$unsafeEmails = (Invoke-PreviewSql @"
select coalesce(sum(bad),0)::int bad_count from (
 select count(*) bad from public.student_enrollments where email is not null and lower(email) not like '%@example.test'
) checks
"@)[0]
if ([int]$unsafeEmails.bad_count -ne 0) { throw "PREVIEW_CONTAINS_NON_SYNTHETIC_EMAIL" }

$v5Before = Get-V5Snapshot
Invoke-GuardedFile "migrations/preview/20260730_dual_lms_preview_substrate.sql"
Invoke-GuardedFile "migrations/20260730_dual_lms_tenant_rollback.sql"
$businessBefore = Get-BusinessSnapshot

$applyStarted = Get-Date
Invoke-GuardedFile "migrations/20260730_dual_lms_tenant.sql"
$applyMs = [math]::Round(((Get-Date) - $applyStarted).TotalMilliseconds, 3)
$businessAfter = Get-BusinessSnapshot
$schemaContract = (Invoke-PreviewSql @'
select
 (select count(*) from information_schema.columns where table_schema='public' and table_name='courses'
   and column_name='lms_tenant' and data_type='text' and is_nullable='YES')::int courses_column,
 (select count(*) from information_schema.columns where table_schema='public' and table_name='orders'
   and column_name='lms_tenant' and data_type='text' and is_nullable='YES')::int orders_column,
 (select count(*) from pg_constraint where conname in ('courses_lms_tenant_check','orders_lms_tenant_check'))::int constraints,
 (select count(*) from pg_indexes where schemaname='public' and indexname in (
   'idx_courses_lms_tenant','idx_courses_lms_tenant_active_status','idx_courses_learning_target_tenant',
   'idx_orders_lms_tenant_status','idx_orders_learning_target_tenant'))::int indexes,
 (select count(*) from public.courses where lms_tenant is null)::int course_nulls,
 (select count(*) from public.courses where lms_tenant is not null)::int course_non_nulls,
 (select count(*) from public.orders where lms_tenant is null)::int order_nulls,
 (select count(*) from public.orders where lms_tenant is not null)::int order_non_nulls;
'@)[0]

if ($businessBefore.courses.checksum -ne $businessAfter.courses.checksum -or
    $businessBefore.orders.checksum -ne $businessAfter.orders.checksum) {
  throw "BUSINESS_DATA_CHECKSUM_MISMATCH"
}
if ([int]$schemaContract.courses_column -ne 1 -or [int]$schemaContract.orders_column -ne 1 -or
    [int]$schemaContract.constraints -ne 2 -or [int]$schemaContract.indexes -ne 5 -or
    [int]$schemaContract.course_non_nulls -ne 0 -or [int]$schemaContract.order_non_nulls -ne 0) {
  throw "EXPECTED_SCHEMA_DELTA_MISMATCH"
}

Invoke-GuardedFile "migrations/preview/20260730_dual_lms_preview_seed.sql"
$seedFirst = Get-BusinessSnapshot
Invoke-GuardedFile "migrations/20260730_dual_lms_tenant_rollback.sql"
Invoke-GuardedFile "migrations/preview/20260730_dual_lms_preview_substrate_rollback.sql"
$v5Rollback = Get-V5Snapshot

Invoke-GuardedFile "migrations/preview/20260730_dual_lms_preview_substrate.sql"
Invoke-GuardedFile "migrations/20260730_dual_lms_tenant.sql"
Invoke-GuardedFile "migrations/preview/20260730_dual_lms_preview_seed.sql"
$seedSecond = Get-BusinessSnapshot
$v5Final = Get-V5Snapshot

$v5BeforeJson = $v5Before | ConvertTo-Json -Depth 10 -Compress
$v5RollbackJson = $v5Rollback | ConvertTo-Json -Depth 10 -Compress
$v5FinalJson = $v5Final | ConvertTo-Json -Depth 10 -Compress
$seedMatch = $seedFirst.courses.checksum -eq $seedSecond.courses.checksum -and
  $seedFirst.orders.checksum -eq $seedSecond.orders.checksum
if (-not $seedMatch) { throw "SEED_CHECKSUM_NOT_REPRODUCIBLE" }
if ($v5BeforeJson -ne $v5RollbackJson -or $v5BeforeJson -ne $v5FinalJson) {
  throw "V5_CHECKSUM_CHANGED"
}

$evidence = [ordered]@{
  ok = $true
  preview_ref = $ProjectRef
  database = $identity.database
  started_at = $startedAt.ToString("o")
  ended_at = (Get-Date).ToUniversalTime().ToString("o")
  migration_duration_ms = $applyMs
  business_before = $businessBefore
  business_after = $businessAfter
  business_checksum_match = $true
  schema_contract = $schemaContract
  seed_first = $seedFirst
  seed_second = $seedSecond
  seed_checksum_match = $seedMatch
  v5_checksum_match = $true
  production_ref_forbidden = $ForbiddenRef
}
$artifactDir = "_local_artifacts/dual-lms-preview"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$artifact = Join-Path $artifactDir ("rehearsal-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $artifact -Encoding utf8
$evidence | ConvertTo-Json -Depth 10 -Compress
