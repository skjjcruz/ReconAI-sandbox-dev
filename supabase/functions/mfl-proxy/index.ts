// ══════════════════════════════════════════════════════════════════
// mfl-proxy — Supabase Edge Function
// Proxies requests to the MyFantasyLeague API to bypass CORS.
// MFL explicitly blocks cross-origin browser requests, so this
// Edge Function acts as a server-side relay.
//
// POST body: { url: string }
// The url must start with https://api.myfantasyleague.com/ or
// https://www followed by myfantasyleague.com to be accepted.
// ══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 60;

function isValidMflUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return typeof url === "string" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") && parsed.protocol === "https:"
      && (parsed.hostname === "myfantasyleague.com" || parsed.hostname.endsWith(".myfantasyleague.com"));
  } catch {
    return false;
  }
}

// Validate every redirect before forwarding a cookie, login form or write.
// Fetch's automatic redirects do not enforce this provider boundary.
async function fetchMfl(url: string, init: RequestInit, preserveMethod = false, login = false) {
  let current = url;
  let method = init.method || 'GET';
  let body = init.body;
  const headers = new Headers(init.headers);
  const setCookies: string[] = [];
  const signal = AbortSignal.timeout(15000);
  for (let hop = 0; hop < 5; hop++) {
    if (!isValidMflUrl(current)) throw new Error('Invalid MFL redirect');
    const response = await fetch(current, { ...init, method, body, headers, redirect: 'manual', signal });
    if (login) {
      for (const cookie of response.headers.getSetCookie()) {
        setCookies.unshift(cookie);
        const match = cookie.match(/MFL_USER_ID=([^;]+)/);
        if (match) headers.set('Cookie', `MFL_USER_ID=${match[1]}`);
      }
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: current, setCookies };
    const location = response.headers.get('location');
    if (!location) throw new Error('Missing MFL redirect');
    const next = new URL(location, current).toString();
    if (!isValidMflUrl(next)) throw new Error('Invalid MFL redirect');
    if (!preserveMethod && (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST'))) {
      method = 'GET'; body = undefined; headers.delete('Content-Type');
    }
    current = next;
  }
  throw new Error('Too many MFL redirects');
}

serve(async (req: Request) => {
  const responseHeaders = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: responseHeaders });
  let body;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } });
  }

  const limit = await checkRateLimit(`mfl-proxy:${clientIp(req)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  const limited = rateLimitResponse(limit, responseHeaders);
  if (limited) return limited;

  try {
    const { url, method, cookie, form, login } = body;

    if (typeof url !== "string" || !url || !isValidMflUrl(url)) {
      return new Response(
        JSON.stringify({ error: "Invalid URL — only myfantasyleague.com URLs are allowed" }),
        { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseHeaders: Record<string, string> = {
      "User-Agent": "FantasyWarRoom/1.0",
      "Accept": "application/json",
    };
    if (cookie) baseHeaders["Cookie"] = String(cookie);

    // Login mode: POST credentials as a FORM body (keeps the password out of the
    // URL) and return the MFL_USER_ID auth token + resolved shard host. Nothing
    // is persisted server-side.
    if (login) {
      const result = await fetchMfl(url, { method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
        body: typeof form === "string" ? form : "",
      }, false, true);
      const res = result.response;
      const text = await res.text();
      let mflUserId: string | null = null;
      for (const sc of result.setCookies) { const m = String(sc).match(/MFL_USER_ID=([^;]+)/); if (m) { mflUserId = m[1]; break; } }
      if (!mflUserId) { const bm = text.match(/MFL_USER_ID="?([^";\s<]+)"?/); if (bm) mflUserId = bm[1]; }
      let host: string | null = null;
      try { host = new URL(result.url).host; } catch { host = null; }
      const failedText = !res.ok || (/invalid|incorrect|denied|not\s*log|error/i.test(text) && !mflUserId);
      const message = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      return new Response(
        JSON.stringify({ ok: !!mflUserId && !failedText, mflUserId: failedText ? null : mflUserId, host, message }),
        { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    // Writes (e.g. TYPE=lineup import) arrive as method:'POST'; params stay in the
    // query string so a shard 302 still carries them. With a cookie we resolve the
    // redirect MANUALLY and re-send the Cookie to the shard (fetch drops it on a
    // cross-host redirect otherwise).
    const { response: mflRes } = await fetchMfl(url, {
      method: method === "POST" ? "POST" : "GET", headers: baseHeaders,
    }, method === "POST");

    if (!mflRes.ok) {
      const status = mflRes.status;
      let msg = `MFL API error ${status}`;
      if (status === 401 || status === 403) {
        msg = "MFL authorization failed — your login may have expired. Reconnect and try again.";
      } else if (status === 404) {
        msg = "MFL league not found. Check your League ID and year.";
      } else if (status === 429) {
        msg = "MFL rate limit reached. Wait a moment and try again.";
      }
      return new Response(
        JSON.stringify({ error: msg }),
        { status, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await mflRes.text();
    return new Response(data, {
      status: 200,
      headers: { ...responseHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[mfl-proxy] Provider request failed");
    return new Response(
      JSON.stringify({ error: "MFL is temporarily unavailable. Try again shortly." }),
      { status: 502, headers: { ...responseHeaders, "Content-Type": "application/json" } }
    );
  }
});
