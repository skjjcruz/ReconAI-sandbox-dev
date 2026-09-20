// ══════════════════════════════════════════════════════════════════
// yahoo-proxy — Supabase Edge Function
// Handles Yahoo Fantasy OAuth 2.0 and API proxying.
//
// Setup: add these to Supabase secrets (Dashboard → Settings → Edge Functions):
//   YAHOO_CLIENT_ID     — from your Yahoo Developer app
//   YAHOO_CLIENT_SECRET — from your Yahoo Developer app
//
// Yahoo Developer app redirect URI must be set to:
//   https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy
//
// Actions:
//   POST { action:'auth_url', flow_version, browser_challenge, return_url }
//     → { auth_url } — starts a browser-bound, server-recorded OAuth flow
//   GET  ?code=XXX&state=XXX (Yahoo callback)
//     → relays code/state in a fragment; the initiating tab must complete_auth
//   POST { action:'complete_auth', state, code, browser_verifier, return_url, flow_version }
//     → verifies the initiating app account/tab, consumes state, exchanges code
//   POST { action:'api', endpoint, session_id }
//     → proxies Yahoo Fantasy API request with stored access token
//   POST { action:'refresh', session_id }
//     → refreshes expired access token
// ══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireYahooOwner, yahooOwnerIsCurrent, sha256Hex } from "../_shared/yahoo-owner.ts";
import { corsHeaders, isAllowedBrowserUrl } from "../_shared/cors.ts";
import { checkRateLimit as checkProxyLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const YAHOO_BASE      = "https://fantasysports.yahooapis.com/fantasy/v2";
const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const YAHOO_AUTH_URL  = "https://api.login.yahoo.com/oauth2/request_auth";

// This function's public URL — registered as redirect_uri in Yahoo Developer app
const REDIRECT_URI = "https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CLIENT_ID        = Deno.env.get("YAHOO_CLIENT_ID") || "";
const CLIENT_SECRET    = Deno.env.get("YAHOO_CLIENT_SECRET") || "";

async function requesterKey(req: Request): Promise<string | null> {
  return (await requireYahooOwner(adminClient(), req))?.ownerKey || null;
}

// The verifier is kept by the initiating app tab. A link, cookie acquired by a
// recipient, or a callback alone cannot authorize storage of provider tokens.
const FLOW_VERSION = 'browser-verifier-v2';
const FLOW_HASH_PREFIX = 'v2:';
const APP_PATHS = new Set(['/', '/index.html', '/ReconAI/', '/ReconAI/index.html',
  '/ReconAI-sandbox-dev/', '/ReconAI-sandbox-dev/index.html', '/dist-preview/', '/dist-preview/index.html']);
function allowedReturn(value: string, origin?: string): boolean {
  try {
    const url = new URL(value);
    return isAllowedBrowserUrl(value) && !url.username && !url.password &&
      APP_PATHS.has(url.pathname) && (!origin || url.origin === origin);
  } catch { return false; }
}

function oauthError(message: string, status = 400, cors: HeadersInit = {}): Response {
  return new Response(message, { status, headers: {
    ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  } });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE);
}

async function storeTokens(
  sessionId: string,
  tokens: Record<string, unknown>,
  returnUrl: string,
  ownerKey: string
) {
  if (typeof tokens.access_token !== 'string' || !tokens.access_token ||
      typeof tokens.refresh_token !== 'string' || !tokens.refresh_token ||
      !Number.isFinite(Number(tokens.expires_in || 3600)) || Number(tokens.expires_in || 3600) <= 0) {
    throw new Error('Yahoo returned an incomplete connection.');
  }
  const { error } = await adminClient()
    .from("yahoo_tokens")
    .upsert({
      session_id:    sessionId,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    Date.now() + Number(tokens.expires_in || 3600) * 1000,
      token_type:    tokens.token_type || "Bearer",
      return_url:    returnUrl,
      owner_key:     ownerKey,
      updated_at:    new Date().toISOString(),
    });
  if (error) throw new Error("Could not save Yahoo connection.");
}

async function getTokenRecord(sessionId: string, ownerKey: string) {
  const { data, error } = await adminClient()
    .from("yahoo_tokens")
    .select("*")
    .eq("session_id", sessionId)
    .eq("owner_key", ownerKey)
    .single();
  if (error || !data) throw new Error("Yahoo session not found — please reconnect.");
  return data;
}

async function refreshAccessToken(sessionId: string, ownerKey: string): Promise<string> {
  const record = await getTokenRecord(sessionId, ownerKey);
  const basic  = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(record.refresh_token)}`,
  });
  if (!res.ok) throw new Error("Token refresh failed: " + res.status);
  const tokens = await res.json();

  await storeTokens(sessionId, {
    ...tokens,
    refresh_token: tokens.refresh_token || record.refresh_token,
  }, record.return_url || "", ownerKey);

  return tokens.access_token as string;
}

async function yahooFetch(endpoint: string, accessToken: string) {
  return fetch(YAHOO_BASE + endpoint, {
    headers: { "Authorization": `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15000),
  });
}

serve(async (req: Request) => {
  const responseHeaders = corsHeaders(req);
  const fail = (message: string, status = 400) => oauthError(message, status, responseHeaders);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  // The provider callback only relays a code to the recorded app. No token
  // exchange or persistence happens until that tab proves its saved verifier.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const state = url.searchParams.get('state') || '';
    if (url.searchParams.has('start') || !/^[a-f0-9]{64}$/.test(state)) {
      return fail('This Yahoo connection needs to be restarted from the updated app.');
    }
    try {
      const { data: pending, error } = await adminClient().from('yahoo_oauth_states')
        .select('owner_key, return_url, session_version, browser_hash')
        .eq('state_hash', await sha256Hex(state)).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (error) return fail('Yahoo connection could not be checked. Start again from the app.', 503);
      if (!pending || !/^v2:[a-f0-9]{64}$/.test(pending.browser_hash || '') || !allowedReturn(pending.return_url)) {
        return fail('This Yahoo connection has expired or needs to be restarted from the updated app.');
      }
      const code = url.searchParams.get('code') || '';
      const rejected = url.searchParams.has('error') || !code || code.length > 8192;
      const appUrl = new URL(pending.return_url);
      // Fragments are not sent to the app host or in asset referrers. The app's
      // first inline script removes this fragment before loading any assets.
      appUrl.hash = 'dhq-yahoo=' + encodeURIComponent(JSON.stringify({
        state, ...(rejected ? { error: 'not_approved' } : { code }),
      }));
      return new Response(null, { status: 302, headers: {
        Location: appUrl.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      } });
    } catch {
      return fail('Yahoo connection could not be checked. Start again from the app.', 503);
    }
  }

  // ── POST: app actions ─────────────────────────────────────────────
  if (req.method === "POST") {
    let body: Record<string, string>;
    try {
      body = await req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    } catch (_) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
    const action = body.action;

    if (action === 'auth_url' || action === 'complete_auth') {
      const db = adminClient();
      const appSession = await requireYahooOwner(db, req);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status, headers: { ...responseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      if (!appSession) return json({ error: 'Sign in again before connecting Yahoo.', auth_required: true }, 401);
      if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Yahoo connection is not configured.' }, 503);
      if (body.flow_version !== FLOW_VERSION) {
        return json({ error: 'Refresh the app before starting a new Yahoo connection.', code: 'client_upgrade_required' }, 409);
      }
      const origin = req.headers.get('Origin') || '';
      const returnUrl = body.return_url;
      if (!origin || typeof returnUrl !== 'string' || !allowedReturn(returnUrl, origin)) {
        return json({ error: 'Return to the app and start Yahoo connection again.' }, 400);
      }
      const limit = await checkProxyLimit(`yahoo-oauth:${action}:${appSession.ownerKey}`, 10, 600);
      const limited = rateLimitResponse(limit, responseHeaders);
      if (limited) return limited;
      if (action === 'auth_url') {
        if (!/^[a-f0-9]{64}$/.test(body.browser_challenge || '')) return json({ error: 'Missing browser connection proof.' }, 400);
        const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        await db.from('yahoo_oauth_states').delete().lt('expires_at', new Date().toISOString());
        const { error } = await db.from('yahoo_oauth_states').insert({
          state_hash: await sha256Hex(state), owner_key: appSession.ownerKey, return_url: returnUrl,
          session_version: appSession.sessionVersion, browser_hash: FLOW_HASH_PREFIX + body.browser_challenge,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        });
        if (error) return json({ error: 'Could not start Yahoo connection.' }, 503);
        const consent = new URL(YAHOO_AUTH_URL);
        consent.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
          response_type: 'code', scope: 'fspt-r', state }).toString();
        return json({ flow_version: FLOW_VERSION, state, auth_url: consent.toString() });
      }
      if (!/^[a-f0-9]{64}$/.test(body.state || '') || !/^[a-f0-9]{64}$/.test(body.browser_verifier || '') ||
          typeof body.code !== 'string' || !body.code || body.code.length > 8192) {
        return json({ error: 'This Yahoo connection needs to be restarted from this tab.' }, 400);
      }
      // The database consumes one exact account + return URL + browser proof.
      // Concurrent completions cannot both exchange the single-use code.
      let consume = db.from('yahoo_oauth_states').delete()
        .eq('state_hash', await sha256Hex(body.state))
        .eq('browser_hash', FLOW_HASH_PREFIX + await sha256Hex(body.browser_verifier))
        .eq('owner_key', appSession.ownerKey).eq('return_url', returnUrl)
        .gt('expires_at', new Date().toISOString());
      consume = appSession.sessionVersion === null ? consume.is('session_version', null) : consume.eq('session_version', appSession.sessionVersion);
      const { data: pending, error } = await consume.select('owner_key, return_url, session_version').maybeSingle();
      if (error) return json({ error: 'Yahoo connection could not be checked. Start again from the app.' }, 503);
      if (!pending) return json({ error: 'This Yahoo connection expired, already finished, or belongs to a different tab or account.' }, 409);
      try {
        const tokenRes = await fetch(YAHOO_TOKEN_URL, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code: body.code, redirect_uri: REDIRECT_URI }).toString(),
        });
        if (!tokenRes.ok) throw new Error('Provider rejected code');
        const tokens = await tokenRes.json();
        if (!await yahooOwnerIsCurrent(db, appSession.ownerKey, appSession.sessionVersion)) {
          return json({ error: 'Sign in again before connecting Yahoo.', auth_required: true }, 401);
        }
        const sessionId = crypto.randomUUID();
        await storeTokens(sessionId, tokens, returnUrl, appSession.ownerKey);
        return json({ flow_version: FLOW_VERSION, session_id: sessionId });
      } catch {
        return json({ error: 'Yahoo connection was not confirmed. Start a new connection from this tab.' }, 503);
      }
    }

    // ── api: proxy Yahoo Fantasy API request ──
    if (action === "api") {
      const ownerKey = await requesterKey(req);
      if (!ownerKey) {
        return new Response(
          JSON.stringify({ error: "Valid session token required.", auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      // Retain the deployed cross-instance owner limit without discarding the
      // current-session and browser-bound OAuth protections above.
      const limit = await checkProxyLimit(`yahoo-proxy:${ownerKey}`, 120, 60);
      const limited = rateLimitResponse(limit, responseHeaders);
      if (limited) return limited;
      const { endpoint, session_id } = body;
      if (typeof endpoint !== "string" || typeof session_id !== "string" || !endpoint || !session_id) {
        return new Response(
          JSON.stringify({ error: "Missing endpoint or session_id" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      // Security: only allow relative paths to Yahoo Fantasy API
      if (!endpoint.startsWith("/")) {
        return new Response(
          JSON.stringify({ error: "endpoint must be a relative path starting with /" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }

      let record;
      try { record = await getTokenRecord(session_id, ownerKey); }
      catch (e) {
        return new Response(
          JSON.stringify({ error: (e as Error).message, auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }

      let accessToken: string = record.access_token;

      // Refresh proactively if within 60s of expiry
      if (Date.now() > record.expires_at - 60_000) {
        try { accessToken = await refreshAccessToken(session_id, ownerKey); }
        catch (e) { console.warn("[yahoo-proxy] Proactive refresh failed:", e); }
      }

      let yahooRes = await yahooFetch(endpoint, accessToken);

      // Retry once with fresh token on 401
      if (yahooRes.status === 401) {
        try {
          accessToken = await refreshAccessToken(session_id, ownerKey);
          yahooRes = await yahooFetch(endpoint, accessToken);
        } catch (_) {
          return new Response(
            JSON.stringify({ error: "Yahoo auth expired — please reconnect.", auth_required: true }),
            { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      if (!yahooRes.ok) {
        const errText = await yahooRes.text();
        return new Response(
          JSON.stringify({ error: `Yahoo API ${yahooRes.status}: ${errText.slice(0, 300)}` }),
          { status: yahooRes.status, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await yahooRes.json();
      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── refresh: refresh access token on demand ──
    if (action === "refresh") {
      const ownerKey = await requesterKey(req);
      if (!ownerKey) {
        return new Response(
          JSON.stringify({ error: "Valid session token required.", auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const { session_id } = body;
      if (typeof session_id !== "string" || !session_id) {
        return new Response(
          JSON.stringify({ error: "Missing session_id" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const limit = await checkProxyLimit(`yahoo-proxy:${ownerKey}`, 120, 60);
      const limited = rateLimitResponse(limit, responseHeaders);
      if (limited) return limited;
      try {
        await refreshAccessToken(session_id, ownerKey);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: (err as Error).message, auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
    );
    } catch {
      return new Response(JSON.stringify({ error: 'Yahoo is temporarily unavailable. Try again shortly.' }), {
        status: 503, headers: { ...responseHeaders, 'Content-Type': 'application/json', 'Retry-After': '30' },
      });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: responseHeaders });
});
