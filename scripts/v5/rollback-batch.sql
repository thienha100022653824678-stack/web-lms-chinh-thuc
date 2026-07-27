-- Preview-only template. Replace :migration_batch_id through a parameterized client.
begin;
update public.lms_v5_posts
set status = 'archived', deleted_at = null, updated_at = now()
where migration_batch_id = :migration_batch_id
  and status <> 'deleted';
insert into public.lms_v5_audit_logs(action,target_type,target_id,admin_email,metadata)
select 'migration.batch.rollback','post',id,:admin_email,jsonb_build_object('migration_batch_id', migration_batch_id)
from public.lms_v5_posts where migration_batch_id = :migration_batch_id;
commit;
