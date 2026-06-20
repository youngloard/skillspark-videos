/**
 * Google Drive utilities. Pure URL parsing + a thin Drive REST call.
 *
 * Admins paste any of these formats — we extract the file ID and store one
 * canonical value in the DB. All embed/download URLs are derived at render time.
 */

const DRIVE_ID_REGEX = /^[A-Za-z0-9_-]{10,128}$/;

const URL_PATTERNS: RegExp[] = [
  // /file/d/{id}/...
  /\/file\/d\/([A-Za-z0-9_-]{10,128})(?:[/?#]|$)/,
  // /document/d/{id}/...
  /\/document\/d\/([A-Za-z0-9_-]{10,128})(?:[/?#]|$)/,
  // ?id={id}  or  &id={id}
  /[?&]id=([A-Za-z0-9_-]{10,128})(?:[&#]|$)/,
  // /uc/{id}/... (rare)
  /\/uc\/([A-Za-z0-9_-]{10,128})(?:[/?#]|$)/,
];

/**
 * Returns the Drive file ID, or null if `input` doesn't look like one.
 * Accepts bare IDs and the common Drive URL shapes.
 */
export function parseDriveFileId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (DRIVE_ID_REGEX.test(trimmed)) return trimmed;
  for (const re of URL_PATTERNS) {
    const m = trimmed.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

export function buildDriveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

export function buildDriveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

export function buildDriveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export type DriveFileMeta = {
  durationSeconds: number | null;
  name: string | null;
  mimeType: string | null;
};

let warnedNoAuth = false;

/**
 * Returns true if the server has any way to authenticate with Drive — either
 * a service account (preferred, works for restricted files) or a public-link
 * API key (fallback, only works for "anyone with link" files).
 */
export function hasDriveAuth(): boolean {
  return (
    !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    !!process.env.GOOGLE_DRIVE_API_KEY
  );
}

/**
 * Builds an authenticated request to a Drive API URL. Prefers the service
 * account access token; falls back to API key as a query string.
 *
 * Returns `null` if the file isn't a known Drive ID or no auth is configured.
 */
export async function authedDriveFetch(
  url: URL,
  init?: RequestInit,
): Promise<Response | null> {
  // Lazy import keeps the auth module out of bundles that don't need it.
  const { getDriveAccessToken } = await import("@/lib/drive-auth");
  const token = await getDriveAccessToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
    if (!apiKey) return null;
    if (!url.searchParams.has("key")) url.searchParams.set("key", apiKey);
  }
  return fetch(url.toString(), { ...init, headers, cache: "no-store" });
}

/**
 * Fetches Drive metadata for a file. Uses the service account if configured
 * (works for restricted files); falls back to the API key (public-link
 * files only). Returns null on any failure — never throws — so callers can
 * fire-and-forget.
 */
export async function fetchDriveVideoMetadata(fileId: string): Promise<DriveFileMeta | null> {
  if (!fileId || !DRIVE_ID_REGEX.test(fileId)) return null;
  if (!hasDriveAuth()) {
    if (!warnedNoAuth) {
      console.warn(
        "[drive] no GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_API_KEY; skipping metadata fetch",
      );
      warnedNoAuth = true;
    }
    return null;
  }
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  url.searchParams.set("fields", "videoMediaMetadata,name,mimeType");
  // Service-account fetches need explicit support for files in shared drives.
  url.searchParams.set("supportsAllDrives", "true");
  try {
    const res = await authedDriveFetch(url);
    if (!res || !res.ok) {
      console.warn(
        `[drive] metadata fetch failed for ${fileId}: ${res?.status ?? "no-auth"}`,
      );
      return null;
    }
    const json = (await res.json()) as {
      name?: string;
      mimeType?: string;
      videoMediaMetadata?: { durationMillis?: string | number };
    };
    let durationSeconds: number | null = null;
    const ms = json.videoMediaMetadata?.durationMillis;
    if (ms !== undefined && ms !== null) {
      const n = typeof ms === "string" ? Number(ms) : ms;
      if (Number.isFinite(n) && n >= 0) durationSeconds = Math.round(n / 1000);
    }
    return {
      durationSeconds,
      name: json.name ?? null,
      mimeType: json.mimeType ?? null,
    };
  } catch (e) {
    console.warn("[drive] metadata fetch error", e);
    return null;
  }
}
