/**
 * Google service-account auth for Drive.
 *
 * Why this exists:
 *   A bare API key (`GOOGLE_DRIVE_API_KEY`) can ONLY read files shared as
 *   "anyone with the link". The moment the admin restricts the file to
 *   specific people, the key gets a 403/404 because it has no user identity
 *   to check membership against.
 *
 * Solution: a Google Cloud service account. The admin shares each Drive file
 * (or the parent folder) with the service-account email; the server requests
 * an OAuth access token by signing a JWT with the SA's private key, and uses
 * that token for both metadata reads and `alt=media` byte streaming.
 *
 * The student NEVER needs to be signed in to a Google account that has
 * direct file access — our app's own authorization (canAccessVideo) is the
 * gate. Drive sees only the service account.
 *
 * Env contract:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   — the full JSON of the SA key file, as a
 *                                    single string. The `private_key` may
 *                                    contain real newlines or escaped \n.
 *
 * Token caching: we keep the access_token in memory until ~60 s before
 * expiry, with an in-flight promise so concurrent requests don't trigger
 * parallel token exchanges.
 */

import { createSign } from "node:crypto";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

let cachedSa: ServiceAccount | null | undefined;
let cachedToken: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

function loadServiceAccount(): ServiceAccount | null {
  if (cachedSa !== undefined) return cachedSa;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    cachedSa = null;
    return null;
  }
  try {
    const obj = JSON.parse(raw);
    const email = typeof obj.client_email === "string" ? obj.client_email : null;
    const key = typeof obj.private_key === "string" ? obj.private_key : null;
    if (!email || !key) {
      cachedSa = null;
      return null;
    }
    cachedSa = {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    };
    return cachedSa;
  } catch (e) {
    console.warn("[drive-auth] GOOGLE_SERVICE_ACCOUNT_JSON parse failed", e);
    cachedSa = null;
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function exchangeJwtForToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const claimsB64 = base64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${claimsB64}`;

  let signature: Buffer;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    signature = signer.sign(sa.private_key);
  } catch (e) {
    console.warn("[drive-auth] JWT signing failed (bad private_key?)", e);
    return null;
  }
  const jwt = `${signingInput}.${base64url(signature)}`;

  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      cache: "no-store",
    });
  } catch (e) {
    console.warn("[drive-auth] token exchange network error", e);
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[drive-auth] token exchange ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }
  const json = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!json?.access_token) {
    console.warn("[drive-auth] token response missing access_token");
    return null;
  }
  cachedToken = {
    token: json.access_token,
    // 60 s safety margin
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.token;
}

/**
 * Returns a valid access_token, or null if no service account is configured
 * or the exchange failed. Concurrent callers share a single in-flight
 * exchange so we don't spin up parallel JWT->token calls.
 */
export async function getDriveAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (inflight) return inflight;
  const sa = loadServiceAccount();
  if (!sa) return null;
  inflight = exchangeJwtForToken(sa).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Sync probe — for environments deciding which provider to use. */
export function hasDriveServiceAccount(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

/** Service-account email for nice error messages / setup hints. */
export function getServiceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}
