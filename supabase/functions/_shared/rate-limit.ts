// ══════════════════════════════════════════════════════════════════
// Durable, cross-instance rate limiting for the public proxy functions.
//
// Edge Functions are serverless: many instances run in parallel and each
// is torn down when idle, so an in-memory counter both resets on cold
// start and only sees its own instance's traffic. This helper keeps the
// authoritative count in Postgres (public.check_rate_limit) so the limit
// is enforced globally and survives restarts.
//
// If durable storage is unavailable, deny provider access with a retryable
// service error. A new worker must not reset the authoritative allowance.
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

export interface RateLimitResult {
  allowed: boolean;
  unavailable?: boolean;
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

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const unavailable = { allowed: false, unavailable: true, count: 0, limit, retryAfter: 60 };
  if (!key || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) return unavailable;
  const db = admin();
  if (!db) return unavailable;
  try {
    const { data, error } = await db.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data || typeof data.allowed !== 'boolean' ||
        !Number.isInteger(data.count) || data.count < 1 || data.limit !== limit ||
        !Number.isInteger(data.retry_after) || data.retry_after < 0 ||
        data.allowed !== (data.count <= limit)) return unavailable;
    return {
      allowed: data.allowed,
      count: data.count,
      limit: data.limit,
      retryAfter: data.retry_after,
    };
  } catch {
    return unavailable;
  }
}

// A full budget is 429; unavailable durable storage is 503. Neither contacts the provider.
export function rateLimitResponse(result: RateLimitResult, headers: HeadersInit): Response | null {
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({ error: result.unavailable ? "Provider connection is temporarily unavailable. Try again shortly." : "Rate limit exceeded. Try again shortly." }),
    {
      status: result.unavailable ? 503 : 429,
      headers: { ...headers, "Content-Type": "application/json", "Retry-After": String(result.retryAfter || 60) },
    },
  );
}
