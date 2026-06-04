-- ══════════════════════════════════════════════════════════════════
-- 021_verify_account_locks.sql
--
-- PURPOSE (plain English)
--   Migrations 018 + 020 are applied BY HAND in the Supabase dashboard,
--   so there's no guarantee they were actually run on the live database.
--   If 020 was skipped, email/password accounts have NO row-level lock on
--   their private data (boards, notes, targets, strategy, …).
--
--   This migration is a safety net: it re-asserts the account identity
--   helper and the per-account ("…_account_own") row locks on every
--   single-owner table. It is fully IDEMPOTENT — safe to run any number
--   of times — and only ADDS protection; it never loosens an existing
--   policy. It deliberately does NOT touch primary keys or unique indexes
--   (020 already handled those), so re-running here is low-risk.
--
--   After applying, run the VERIFICATION block at the bottom: you want to
--   see one "…_account_own" policy per protected table.
--
-- DEPLOY: Supabase Dashboard → SQL editor (CLI is read-only on this
--   project). Safe to re-run.
-- ══════════════════════════════════════════════════════════════════

-- ── Identity helpers (re-assert; harmless if already present) ─────
-- Account tokens: the security principal is app_users.id, carried in the
-- JWT as app_metadata.user_id. We deliberately do NOT fall back to `sub`
-- (legacy tokens set sub = username, a non-UUID).
create or replace function public.current_app_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(auth.jwt() -> 'app_metadata' ->> 'user_id', '');
  if raw is null then
    return null;
  end if;
  begin
    return raw::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- Legacy tokens: the Sleeper username claim minted only by password-backed
-- legacy/gifted sessions.
create or replace function public.current_dhq_username()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
    auth.jwt() ->> 'sleeper_username'
  );
$$;

-- ── Guarantee the per-account row lock on every single-owner table ─
-- For each table: enable RLS, ensure a nullable user_id column exists
-- (the lock references it), then (re)create the account policy. The WRITE
-- check requires the legacy owner column IS NULL so an account can never
-- stamp a victim's username/sleeper_username onto a row it owns.
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('gm_strategy',     'username'),
      ('field_log',       'username'),
      ('ai_chat_memory',  'username'),
      ('league_docs',     'username'),
      ('player_tags',     'username'),
      ('owner_dna',       'username'),
      ('fa_targets',      'username'),
      ('calendar_events', 'username'),
      ('earnings',        'username'),
      ('ai_analysis',     'username'),
      ('draft_boards',    'sleeper_username')
    ) as t(tbl, owner_col)
  loop
    if to_regclass('public.' || rec.tbl) is null then
      continue;  -- table doesn't exist in this environment; skip
    end if;

    execute format('alter table public.%I enable row level security', rec.tbl);

    -- The lock references user_id; make sure the column exists.
    execute format(
      'alter table public.%I add column if not exists user_id uuid '
      || 'references public.app_users(id) on delete cascade',
      rec.tbl
    );
    execute format(
      'create index if not exists %I on public.%I (user_id)',
      rec.tbl || '_user_id_idx', rec.tbl
    );

    -- (Re)assert the account-owner policy.
    execute format('drop policy if exists %I on public.%I', rec.tbl || '_account_own', rec.tbl);
    execute format(
      'create policy %I on public.%I for all to public '
      || 'using (user_id is not null and user_id = public.current_app_user_id()) '
      || 'with check (user_id = public.current_app_user_id() and %I is null)',
      rec.tbl || '_account_own', rec.tbl, rec.owner_col
    );

    -- Account tokens use the `authenticated` role; RLS still restricts rows.
    execute format('grant select, insert, update, delete on public.%I to authenticated, anon', rec.tbl);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- VERIFICATION (run these AFTER applying — they are read-only)
--
-- 1) One account lock per protected table — expect ~11 rows:
--      select tablename, policyname
--      from pg_policies
--      where schemaname = 'public' and policyname like '%\_account\_own'
--      order by tablename;
--
-- 2) Identity helpers exist (each should return one row):
--      select proname from pg_proc where proname = 'current_app_user_id';
--      select proname from pg_proc where proname = 'current_dhq_username';
--
-- 3) RLS is actually ON for every protected table — expect rowsecurity = true:
--      select relname, relrowsecurity
--      from pg_class
--      where relname in ('gm_strategy','field_log','ai_chat_memory',
--        'league_docs','player_tags','owner_dna','fa_targets',
--        'calendar_events','earnings','ai_analysis','draft_boards')
--      order by relname;
-- ══════════════════════════════════════════════════════════════════
