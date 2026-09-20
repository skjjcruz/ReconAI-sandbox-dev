-- Read-only preflight for the three ReconAI-owned provider functions.
-- No schema changes: Yahoo state storage was introduced by the earlier security
-- migration. The caller must reject any result other than all true checks.
begin read only;
select
  (select count(*) = 7 from information_schema.columns where table_schema='public' and table_name='yahoo_oauth_states'
    and (column_name,data_type) in (('state_hash','text'),('owner_key','text'),('return_url','text'),('session_version','integer'),('browser_hash','text'),('expires_at','timestamp with time zone'),('created_at','timestamp with time zone'))) as state_columns,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_users' and column_name='session_version' and data_type='integer') as account_version_column,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='yahoo_tokens' and column_name='owner_key' and data_type='text') as owner_binding_column,
  coalesce((select relrowsecurity and not has_table_privilege('anon',oid,'select,insert,update,delete') and not has_table_privilege('authenticated',oid,'select,insert,update,delete') and has_table_privilege('service_role',oid,'select,insert,update,delete') from pg_class where oid=to_regclass('public.yahoo_oauth_states')),false) as state_private,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.yahoo_tokens')),false) and
    not exists(select 1 from pg_policy where polrelid=to_regclass('public.yahoo_tokens') and polpermissive and (coalesce(pg_get_expr(polqual,polrelid),'true')<>'false' or coalesce(pg_get_expr(polwithcheck,polrelid),'true')<>'false')) as tokens_private,
  exists(select 1 from pg_constraint where conrelid=to_regclass('public.yahoo_oauth_states') and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (state_hash)') as state_atomic_key,
  coalesce((select prosecdef and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute') and has_function_privilege('service_role',oid,'execute') and md5(pg_get_functiondef(oid))='95ba057636fc3ec6a1da6fae5a4dea87' from pg_proc where oid=to_regprocedure('public.check_rate_limit(text,integer,integer)')),false) as reviewed_atomic_limiter;
rollback;
