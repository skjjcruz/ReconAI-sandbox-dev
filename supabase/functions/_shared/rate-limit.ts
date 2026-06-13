// ══════════════════════════════════════════════════════════════════
// Durable, cross-instance rate limiting for the public proxy functions.
//
// Edge Functions are serverless: many instances run in parallel and each
// is torn down when idle, so an in-memory counter both resets on cold
// start and only sees its own instance's traffic. This helper keeps the
// authoritative count in Postgres (public.check_rate_limit) so the limit
// is enforced globally and survives restarts.
//
// If the database is briefly unreachable it degrades to a per-instance
// in-memory limiter (fail-open backstop) rather than dropping traffic.
// ══════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

let client: SupabaseClient | null = null;
function admin(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } });
  }
  return client;
}

// Per-instance fallback, used only when the DB call fails.
const fallbackBuckets = new Map<string, { window: number; count: number }>();

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfter: number; // seconds until the window resets
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP")
    || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || req.headers.get("X-Real-IP")
    || "unknown";
}

function fallbackCheck(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const current = fallbackBuckets.get(key);
  let count: number;
  if (!current || current.window !== window) {
    fallbackBuckets.set(key, { window, count: 1 });
    count = 1;
  } else {
    current.count += 1;
    count = current.count;
  }
  const allowed = limit <= 0 || count <= limit;
  return { allowed, count, limit, retryAfter: allowed ? 0 : windowSeconds };
}

// Authoritative check against Postgres; falls back to in-memory on error.
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const db = admin();
  if (!db) return fallbackCheck(key, limit, windowSeconds);
  try {
    const { data, error } = await db.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data) throw error || new Error("empty rate-limit response");
    return {
      allowed: Boolean(data.allowed),
      count: Number(data.count) || 0,
      limit: Number(data.limit) || limit,
      retryAfter: Number(data.retry_after) || 0,
    };
  } catch (err) {
    console.warn("[rate-limit] DB check failed, using in-memory fallback:", (err as Error).message);
    return fallbackCheck(key, limit, windowSeconds);
  }
}

// Returns a 429 Response when the limit is exceeded, otherwise null.
export function rateLimitResponse(result: RateLimitResult, headers: HeadersInit): Response | null {
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }),
    {
      status: 429,
      headers: { ...headers, "Content-Type": "application/json", "Retry-After": String(result.retryAfter || 60) },
    },
  );
}
