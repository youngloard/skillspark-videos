/**
 * Modular video provider so we can later swap Google Drive for Vimeo, Mux,
 * AWS S3+CloudFront with signed URLs, an HLS player, or a DRM provider —
 * without touching pages or actions.
 *
 * V1 stores a canonical `driveFileId` in the DB. We can play the file two ways:
 *
 *   1. Streaming proxy (preferred): server route /api/videos/{id}/stream
 *      proxies Drive bytes with Range support. The HTML5 <video> element gets
 *      real currentTime / seeking, so resume actually works. Requires
 *      GOOGLE_DRIVE_API_KEY.
 *
 *   2. Drive iframe (fallback): when the API key isn't configured. No
 *      programmatic currentTime — resume is best-effort (i.e. doesn't work).
 */

import { buildDriveEmbedUrl, hasDriveAuth } from "@/lib/drive";

export type EmbedRequest = {
  driveFileId?: string | null;
  videoId?: string | null;
};

export type EmbedResult = {
  /** URL to feed to <video src> (streaming) or <iframe src> (iframe). */
  url: string;
  /** When true, render <video>. When false, render <iframe>. */
  streaming: boolean;
  /** Whether seek/currentTime works. Same as `streaming` for now. */
  supportsResume: boolean;
  provider: "google_drive_proxy" | "google_drive_iframe" | "vimeo" | "mux" | "hls" | "unknown";
};

export interface VideoProvider {
  resolveEmbed(req: EmbedRequest): EmbedResult | null;
}

export class GoogleDriveVideoProvider implements VideoProvider {
  resolveEmbed(req: EmbedRequest): EmbedResult | null {
    if (!req.driveFileId) return null;
    if (hasDriveAuth() && req.videoId) {
      return {
        url: `/api/videos/${encodeURIComponent(req.videoId)}/stream`,
        streaming: true,
        supportsResume: true,
        provider: "google_drive_proxy",
      };
    }
    return {
      url: buildDriveEmbedUrl(req.driveFileId),
      streaming: false,
      supportsResume: false,
      provider: "google_drive_iframe",
    };
  }
}

const defaultProvider: VideoProvider = new GoogleDriveVideoProvider();

export function getVideoProvider(): VideoProvider {
  return defaultProvider;
}

export function resolveEmbed(req: EmbedRequest): EmbedResult | null {
  return getVideoProvider().resolveEmbed(req);
}
