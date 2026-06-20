import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentSessionUser, canAccessVideo } from "@/lib/authorization";
// Wait — canAccessVideo is exported by authorization, but only requireVideoAccess writes audit logs.
// For a beacon, we don't want noisy audit logs on every page-unload — silently drop unauthorized writes.

const schema = z.object({
  videoId: z.string().min(1).max(64),
  lastTimestamp: z.coerce.number().int().min(0).max(60 * 60 * 24),
});

export async function POST(req: Request) {
  const user = await getCurrentSessionUser();
  if (!user || user.role !== "student" || !user.studentId) {
    return new NextResponse(null, { status: 204 }); // best-effort, silently drop
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const ok = await canAccessVideo(user.studentId, parsed.data.videoId);
  if (!ok) return new NextResponse(null, { status: 204 });

  await prisma.videoProgress.upsert({
    where: { studentId_videoId: { studentId: user.studentId, videoId: parsed.data.videoId } },
    create: {
      studentId: user.studentId,
      videoId: parsed.data.videoId,
      lastTimestamp: parsed.data.lastTimestamp,
    },
    update: { lastTimestamp: parsed.data.lastTimestamp },
  });
  return new NextResponse(null, { status: 204 });
}
