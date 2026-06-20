"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { moduleSchema, idSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

export async function createModule(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = moduleSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    try {
      const m = await prisma.module.create({
        data: {
          courseId: parsed.data.courseId,
          title: parsed.data.title,
          description: parsed.data.description || null,
          moduleOrder: parsed.data.moduleOrder,
        },
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "MODULE_CREATED", entityType: "Module", entityId: m.id, newValue: m,
      });
      revalidatePath(`/admin/courses/${parsed.data.courseId}`);
      return { ok: true, data: { id: m.id } };
    } catch (e: any) {
      if (e?.code === "P2003") return bad("course not found");
      return bad("create failed");
    }
  });
}

export async function updateModule(moduleId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(moduleId).success) return bad("invalid id");
    const parsed = moduleSchema.partial().safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.module.findUnique({ where: { id: moduleId } });
    if (!before) return bad("not found");
    const after = await prisma.module.update({
      where: { id: moduleId },
      data: {
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.description !== undefined && {
          description: parsed.data.description || null,
        }),
        ...(parsed.data.moduleOrder !== undefined && { moduleOrder: parsed.data.moduleOrder }),
      },
    });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "MODULE_UPDATED", entityType: "Module", entityId: moduleId,
      oldValue: before, newValue: after,
    });
    revalidatePath(`/admin/courses/${after.courseId}`);
    return { ok: true };
  });
}

export async function deleteModule(moduleId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(moduleId).success) return bad("invalid id");
    const before = await prisma.module.findUnique({ where: { id: moduleId } });
    if (!before) return bad("not found");
    await prisma.module.delete({ where: { id: moduleId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "MODULE_DELETED", entityType: "Module", entityId: moduleId, oldValue: before,
    });
    revalidatePath(`/admin/courses/${before.courseId}`);
    return { ok: true };
  });
}

export type MoveDirection = "up" | "down" | "top" | "bottom";

export async function moveModule(moduleId: string, direction: MoveDirection): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(moduleId).success) return bad("invalid id");
    const target = await prisma.module.findUnique({ where: { id: moduleId } });
    if (!target) return bad("not found");
    const siblings = await prisma.module.findMany({
      where: { courseId: target.courseId },
      orderBy: { moduleOrder: "asc" },
      select: { id: true },
    });
    const ids = siblings.map((m) => m.id);
    const idx = ids.indexOf(moduleId);
    if (idx === -1) return bad("module missing from siblings");

    let next: string[] = ids.slice();
    if (direction === "up" && idx > 0) {
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    } else if (direction === "down" && idx < ids.length - 1) {
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    } else if (direction === "top" && idx > 0) {
      next = [moduleId, ...ids.filter((i) => i !== moduleId)];
    } else if (direction === "bottom" && idx < ids.length - 1) {
      next = [...ids.filter((i) => i !== moduleId), moduleId];
    } else {
      return { ok: true };
    }

    await prisma.$transaction(
      next.map((id, i) =>
        prisma.module.update({ where: { id }, data: { moduleOrder: i } }),
      ),
    );
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "MODULE_REORDERED", entityType: "Course", entityId: target.courseId,
      newValue: { direction, moduleId, order: next },
    });
    revalidatePath(`/admin/courses/${target.courseId}`);
    return { ok: true };
  });
}
