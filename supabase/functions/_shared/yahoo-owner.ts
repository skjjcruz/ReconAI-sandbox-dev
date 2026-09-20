// Provider-local verification of the app-issued session contract. This module
// cannot issue/change accounts or sessions; account lifecycle stays native-owned.
import { jwtVerify } from "https://esm.sh/jose@5";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function yahooOwnerIsCurrent(db: SupabaseClient, ownerKey: string, sessionVersion: number | null): Promise<boolean> {
  if (ownerKey.startsWith('sleeper:')) return sessionVersion === null;
  if (!ownerKey.startsWith('app:') || !Number.isInteger(sessionVersion) || Number(sessionVersion) < 1) return false;
  try {
    const { data, error } = await db.from('app_users').select('session_version')
      .eq('id', ownerKey.slice(4)).maybeSingle();
    return !error && !!data && data.session_version === sessionVersion;
  } catch { return false; }
}

export async function requireYahooOwner(db: SupabaseClient, req: Request): Promise<{ ownerKey: string; sessionVersion: number | null } | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  for (const name of ['JWT_SECRET', 'SUPABASE_JWT_SECRET']) {
    const secret = Deno.env.get(name); if (!secret) continue;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
      const metadata = payload.app_metadata as Record<string, unknown> || {};
      const id = metadata.user_id || payload.sub;
      // An app-shaped token must never fall back to a legacy username after
      // revocation, deletion or a failed account lookup.
      if (metadata.user_id || metadata.session_version || (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
        if (metadata.user_id && payload.sub && payload.sub !== metadata.user_id) return null;
        const version = metadata.session_version;
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
        const ownerKey = `app:${id}`;
        return await yahooOwnerIsCurrent(db, ownerKey, version) ? { ownerKey, sessionVersion: version } : null;
      }
      // Retain signed legacy Sleeper claims. Those sessions do not carry an
      // account version; this is not a claim of legacy revocation parity.
      const username = metadata.sleeper_username || payload.sleeper_username;
      if (typeof username === 'string' && username.trim() && username.length <= 100) {
        return { ownerKey: `sleeper:${username.toLowerCase()}`, sessionVersion: null };
      }
      return null;
    } catch { /* Try the second configured issuer key, never an unsigned token. */ }
  }
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
