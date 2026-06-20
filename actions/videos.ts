"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { videoSchema, videoUpdateSchema, idSchema } from "@/lib/validations";
import { fetchDriveVideoMetadata } from "@/lib/drive";
import { bad, withAdmin, type R } from "./_shared";

/** Fire-and-forget; never throws. Updates duration if Drive API returns it. */
async function tryFetchAndStoreDuration(videoId: string, fileId: string) {
  const meta = await fetchDriveVideoMetadata(fileId);
  if (!meta) {
    // Mark fetched-at to avoid retry storms; admin can hit "refresh" to retry.
    await prisma.video.update({
      where: { id: videoId },
      data: { durationFetchedAt: new Date() },
    }).catch(() => {});
    return;
  }
  await prisma.video.update({
    where: { id: videoId },
    data: {
      duration: meta.durationSeconds ?? null,
      durationFetchedAt: new Date(),
    },
  }).catch(() => {});
  if (meta.durationSeconds !== null) {
    await createAuditLog({
      actorType: "system",
      action: "VIDEO_DURATION_FETCHED",
      entityType: "Video",
      entityId: videoId,
      newValue: { durationSeconds: meta.durationSeconds },
    });
  }
}

export async function createVideo(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = videoSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;

    // Confirm the parent's layout matches what's being submitted.
    if (data.moduleId) {
      const mod = await prisma.module.findUnique({
        where: { id: data.moduleId },
        select: { course: { select: { layout: true } } },
      });
      if (!mod) return bad("module not found");
      if (mod.course.layout !== "module")
        return bad("module belongs to a flat-layout course; pass courseId instead");
    } else if (data.courseId) {
      const c = await prisma.course.findUnique({
        where: { id: data.courseId },
        select: { layout: true },
      });
      if (!c) return bad("course not found");
      if (c.layout !== "flat")
        return bad("course is module-layout; pass moduleId pointing to one of its modules");
    }

    try {
      const v = await prisma.video.create({
        data: {
          moduleId: data.moduleId ?? null,
          courseId: data.courseId ?? null,
          title: data.title,
          description: data.description || null,
          driveFileId: data.driveFileId,
          videoOrder: data.videoOrder,
          status: data.status,
        },
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "VIDEO_CREATED", entityType: "Video", entityId: v.id, newValue: v,
      });
      void tryFetchAndStoreDuration(v.id, v.driveFileId);
      if (data.moduleId) revalidatePath(`/admin/modules/${data.moduleId}`);
      if (data.courseId) revalidatePath(`/admin/courses/${data.courseId}`);
      return { ok: true, data: { id: v.id } };
    } catch (e: any) {
      if (e?.code === "P2003") return bad("module/course not found");
      return bad("create failed");
    }
  });
}

export async function updateVideo(videoId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(videoId).success) return bad("invalid id");
    const parsed = videoUpdateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.video.findUnique({ where: { id: videoId } });
    if (!before) return bad("not found");

    const data: any = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.description !== undefined) data.description = parsed.data.description || null;
    if (parsed.data.driveFileId !== undefined) data.driveFileId = parsed.data.driveFileId;
    if (parsed.data.videoOrder !== undefined) data.videoOrder = parsed.data.videoOrder;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;

    const after = await prisma.video.update({ where: { id: videoId }, data });
    const action =
      parsed.data.status === "active" && before.status !== "active"
        ? "VIDEO_ACTIVATED"
        : parsed.data.status === "inactive" && before.status !== "inactive"
          ? "VIDEO_INACTIVATED"
          : "VIDEO_UPDATED";
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action, entityType: "Video", entityId: videoId,
      oldValue: before, newValue: after,
    });
    if (data.driveFileId && data.driveFileId !== before.driveFileId) {
      void tryFetchAndStoreDuration(videoId, data.driveFileId);
    }
    if (after.moduleId) revalidatePath(`/admin/modules/${after.moduleId}`);
    if (after.courseId) revalidatePath(`/admin/courses/${after.courseId}`);
    revalidatePath(`/admin/videos/${videoId}`);
    return { ok: true };
  });
}

export async function refreshVideoDuration(videoId: string): Promise<R> {
  return withAdmin(async () => {
    if (!idSchema.safeParse(videoId).success) return bad("invalid id");
    const v = await prisma.video.findUnique({ where: { id: videoId } });
    if (!v) return bad("not found");
    await tryFetchAndStoreDuration(videoId, v.driveFileId);
    revalidatePath(`/admin/videos/${videoId}`);
    return { ok: true };
  });
}

export async function deleteVideo(videoId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(videoId).success) return bad("invalid id");
    const before = await prisma.video.findUnique({ where: { id: videoId } });
    if (!before) return bad("not found");
    await prisma.video.delete({ where: { id: videoId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "VIDEO_DELETED", entityType: "Video", entityId: videoId, oldValue: before,
    });
    if (before.moduleId) revalidatePath(`/admin/modules/${before.moduleId}`);
    if (before.courseId) revalidatePath(`/admin/courses/${before.courseId}`);
    return { ok: true };
  });
}

export type MoveDirection = "up" | "down" | "top" | "bottom";

/**
 * Renumbers siblings to dense 0..N-1 so order numbers stay tidy.
 * Single transaction. Audits as VIDEO_REORDERED.
 */
export async function moveVideo(videoId: string, direction: MoveDirection): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(videoId).success) return bad("invalid id");
    const target = await prisma.video.findUnique({ where: { id: videoId } });
    if (!target) return bad("not found");

    // Sibling partition depends on layout: same moduleId for module-layout, same courseId for flat.
    const where = target.moduleId
      ? { moduleId: target.moduleId }
      : target.courseId
        ? { courseId: target.courseId }
        : null;
    if (!where) return bad("video has no parent");

    const siblings = await prisma.video.findMany({
      where,
      orderBy: { videoOrder: "asc" },
      select: { id: true },
    });
    const ids = siblings.map((v) => v.id);
    const idx = ids.indexOf(videoId);
    if (idx === -1) return bad("video missing from siblings");

    let next: string[] = ids.slice();
    if (direction === "up" && idx > 0) {
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    } else if (direction === "down" && idx < ids.length - 1) {
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    } else if (direction === "top" && idx > 0) {
      next = [videoId, ...ids.filter((i) => i !== videoId)];
    } else if (direction === "bottom" && idx < ids.length - 1) {
      next = [...ids.filter((i) => i !== videoId), videoId];
    } else {
      return { ok: true };
    }

    await prisma.$transaction(
      next.map((id, i) =>
        prisma.video.update({ where: { id }, data: { videoOrder: i } }),
      ),
    );
    const parentEntity = target.moduleId ? "Module" : "Course";
    const parentId = target.moduleId ?? target.courseId!;
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "VIDEO_REORDERED", entityType: parentEntity, entityId: parentId,
      newValue: { direction, videoId, order: next },
    });
    if (target.moduleId) revalidatePath(`/admin/modules/${target.moduleId}`);
    if (target.courseId) revalidatePath(`/admin/courses/${target.courseId}`);
    return { ok: true };
  });
}
