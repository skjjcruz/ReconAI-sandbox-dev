-- ══════════════════════════════════════════════════════════════════
-- Durable proxy rate limiting
--
-- Replaces the per-instance in-memory limiter in the public proxy Edge
-- Functions with a global, restart-proof fixed-window counter shared by
-- every running function instance. Edge Functions are serverless: many
-- copies run in parallel and each is torn down when idle, so an in-memory
-- Map both resets on cold start and only counts the traffic of its own
-- instance. Keeping the count in Postgres makes the limit authoritative.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.rate_limit_counters (
  bucket_key   text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

-- Only Edge Functions (service role / SECURITY DEFINER) ever touch this
-- table; browser clients have no business reading it. RLS enabled with no
-- policy = deny-all to anon/authenticated (same posture as ai_rate_limits).
alter table public.rate_limit_counters enable row level security;

create index if not exists idx_rate_limit_counters_window
  on public.rate_limit_counters (window_start);

-- Atomic increment-and-check for a fixed time window. Returns whether the
-- call is allowed, the current count, the limit, and seconds until the
-- window resets. search_path pinned empty (advisor lint 0011); every
-- reference is schema-qualified or a pg_catalog built-in.
create or replace function public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch        bigint;
  v_window_epoch bigint;
  v_window_start timestamptz;
  v_count        integer;
begin
  -- Misconfiguration: fail open so a bad call never blocks live traffic.
  if p_key is null or p_window_seconds is null or p_window_seconds <= 0 then
    return json_build_object('allowed', true, 'count', 0, 'limit', p_limit, 'retry_after', 0);
  end if;

  v_epoch        := floor(extract(epoch from clock_timestamp()))::bigint;
  v_window_epoch := (v_epoch / p_window_seconds) * p_window_seconds;
  v_window_start := to_timestamp(v_window_epoch);

  insert into public.rate_limit_counters (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = public.rate_limit_counters.count + 1,
                updated_at = now()
  returning count into v_count;

  if p_limit > 0 and v_count > p_limit then
    return json_build_object(
      'allowed',     false,
      'count',       v_count,
      'limit',       p_limit,
      'retry_after', greatest(1, p_window_seconds - (v_epoch - v_window_epoch))
    );
  end if;

  return json_build_object('allowed', true, 'count', v_count, 'limit', p_limit, 'retry_after', 0);
end;
$$;

-- Edge Functions call this with the auto-injected service-role key. Lock it
-- to service_role only: Postgres grants EXECUTE to PUBLIC by default, which
-- would let anon/authenticated call the SECURITY DEFINER function directly via
-- PostgREST (/rest/v1/rpc) and grief the rate-limit counters.
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Cleanup: drop stale windows (schedule via pg_cron if the extension is on).
-- select cron.schedule('cleanup-rate-limit-counters', '*/30 * * * *',
--   $$delete from public.rate_limit_counters where window_start < now() - interval '1 day'$$);
