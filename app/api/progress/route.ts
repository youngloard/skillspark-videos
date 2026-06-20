import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentSessionUser, canAccessVideo } from "@/lib/authorization";

/**
 * Hot-path progress sink for the student player.
 *
 * Why a route handler and not the `saveVideoProgress` Server Action:
 *   Server Actions in the App Router re-render the current route's Server
 *   Components on every call. The player saves progress every few seconds (and
 *   on play/pause/seek), so a Server Action would re-feed `initial` to the watch
 *   shell mid-playback — the player would re-seek and visibly "refresh". A plain
 *   route handler persists the row and returns 204 with zero router churn.
 *
 * Best-effort by design: unauthorized / malformed posts are silently dropped
 * (204) so a unload-time beacon never surfaces an error. Object-level access is
 * still enforced on every write.
 */
export const runtime = "nodejs";

const schema = z.object({
  videoId: z.string().min(1).max(64),
  lastTimestamp: z.coerce.number().int().min(0).max(60 * 60 * 24),
  completed: z.boolean().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentSessionUser();
  if (!user || user.role !== "student" || !user.studentId) {
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const studentId = user.studentId;
  const { videoId, lastTimestamp } = parsed.data;

  const ok = await canAccessVideo(studentId, videoId);
  if (!ok) return new NextResponse(null, { status: 204 });

  const existing = await prisma.videoProgress.findUnique({
    where: { studentId_videoId: { studentId, videoId } },
  });
  // `completed` is sticky: once true it never flips back to false on a plain
  // timestamp ping.
  const nextCompleted = parsed.data.completed ?? existing?.completed ?? false;

  // Defensive throttle (the client also throttles): skip writes that don't
  // meaningfully change the row.
  if (
    existing &&
    Math.abs(existing.lastTimestamp - lastTimestamp) < 5 &&
    existing.completed === nextCompleted
  ) {
    return new NextResponse(null, { status: 204 });
  }

  await prisma.videoProgress.upsert({
    where: { studentId_videoId: { studentId, videoId } },
    create: { studentId, videoId, lastTimestamp, completed: nextCompleted },
    update: { lastTimestamp, completed: nextCompleted },
  });
  return new NextResponse(null, { status: 204 });
}
