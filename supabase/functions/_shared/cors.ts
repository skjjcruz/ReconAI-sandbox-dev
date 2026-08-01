const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "https://c2-football.github.io",
  "https://jcc100218.github.io",
  "https://skjjcruz.github.io",
  "https://warroom.skjjcruz.com",
  // Live marketing/app domain (dhqfootball.com cutover) — the website calls
  // these proxies for league connect; without these origins every browser
  // call from production is CORS-blocked.
  "https://dhqfootball.com",
  "https://www.dhqfootball.com",
  // Capacitor native app origins. iOS serves the bundled web app from the
  // 'capacitor' scheme; Android uses the 'https' scheme. Kept in sync with
  // War Room's _shared/security.ts so both apps enforce one shared allowlist
  // on the shared Supabase project.
  "capacitor://localhost",
  "https://localhost",
];

export function allowedOrigins(): string[] {
  const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Union the built-in defaults with any env-configured origins, so the known
  // production origins are always allowed even when APP_ALLOWED_ORIGINS is set
  // to a narrower list. Matches War Room's _shared/security.ts behavior.
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || origin || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function isAllowedBrowserUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return allowedOrigins().includes(parsed.origin);
  } catch {
    return false;
  }
}
