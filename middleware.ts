import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware: pre-route bouncer + tiny rate limiter.
 *
 * — Cheap auth pre-flight: if no session cookie, redirect protected routes to
 *   /login before they hit any RSC. Real authorization (admin vs student,
 *   active flag, expiry) still happens in `lib/authorization`.
 * — In-memory token bucket per-IP for /api/* and /login. This is a
 *   per-instance limiter; behind multiple instances you'd swap in Redis.
 * — Adds a `x-request-id` for correlated logs.
 */

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const LIMITS: Array<{ test: (path: string) => boolean; max: number }> = [
  { test: (p) => p.startsWith("/api/auth"), max: 30 },
  { test: (p) => p.startsWith("/api/"), max: 120 },
  { test: (p) => p === "/login", max: 30 },
];

function getClientKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function rateLimited(path: string, key: string): boolean {
  const limit = LIMITS.find((l) => l.test(path));
  if (!limit) return false;
  const now = Date.now();
  const bucketKey = `${path}|${key}`;
  const b = buckets.get(bucketKey);
  if (!b || now > b.resetAt) {
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  if (b.count > limit.max) return true;
  return false;
}

// Periodically prune to bound memory.
let lastPrune = 0;
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
}

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (req.cookies.get(name)?.value) return true;
  }
  return false;
}

const PROTECTED_PREFIXES = [
  "/admin",
  "/dashboard",
  "/courses",
  "/packages",
  "/videos",
];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  maybePrune();

  // 1) Rate-limit hot endpoints by client IP.
  const limitable = LIMITS.some((l) => l.test(pathname));
  if (limitable) {
    const key = getClientKey(req);
    if (rateLimited(pathname, key)) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: {
          "retry-after": "60",
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
  }

  // 2) Pre-route auth gate: redirect un-authed users on protected paths.
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/login") {
      url.searchParams.set("from", pathname + (search || ""));
    }
    return NextResponse.redirect(url);
  }

  // 3) Add a request-id header so server logs can correlate a request across
  //    the RSC + API boundary. Cheap; no PII.
  const res = NextResponse.next();
  if (!req.headers.get("x-request-id")) {
    res.headers.set("x-request-id", crypto.randomUUID());
  }
  return res;
}

export const config = {
  matcher: [
    /*
     * Skip Next.js internals + static assets — middleware would needlessly
     * run on every prefetched chunk otherwise.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|uploads/).*)",
  ],
};
