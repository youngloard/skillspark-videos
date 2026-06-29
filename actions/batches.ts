"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { CATALOG_TAGS } from "@/lib/catalog-cache";
import {
  batchSchema,
  idSchema,
} from "@/lib/validations";
import { bad, withAdmin, withAdminD, type R, type RD } from "./_shared";

const invalidateBatchCatalog = () => revalidateTag(CATALOG_TAGS.batches);

export async function createBatch(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = batchSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;
    try {
      const batch = await prisma.$transaction(async (tx) => {
        const b = await tx.batch.create({
          data: {
            batchCode: data.batchCode,
            batchName: data.batchName,
            description: data.description || null,
          },
        });
        if (data.courseIds.length) {
          await tx.batchCourse.createMany({
            data: data.courseIds.map((courseId) => ({ batchId: b.id, courseId })),
          });
        }
        return b;
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_CREATED", entityType: "Batch", entityId: batch.id,
        newValue: { ...batch, courseIds: data.courseIds },
      });
      for (const courseId of data.courseIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "BATCH_COURSE_ASSIGNED", entityType: "Batch", entityId: batch.id,
          newValue: { courseId },
        });
      }
      invalidateBatchCatalog();
      revalidatePath("/admin/batches");
      return { ok: true, data: { id: batch.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate batchCode");
      if (e?.code === "P2003") return bad("invalid course reference");
      return bad("create failed");
    }
  });
}

/**
 * Creatable-dropdown helper: turn whatever the admin typed in the batch search
 * into a real batch on the spot (batchCode = batchName = the typed text). Used
 * by the bulk "add students to a batch" flow so a missing batch can be added
 * without leaving the page. Returns a ready-to-select dropdown option. If a
 * batch with that code already exists it's reused (never duplicated).
 */
export async function quickCreateBatch(
  label: string,
): Promise<RD<{ value: string; label: string; hint?: string }>> {
  return withAdminD(async (admin) => {
    const name = String(label ?? "").trim();
    const parsed = batchSchema
      .pick({ batchCode: true, batchName: true })
      .safeParse({ batchCode: name, batchName: name });
    if (!parsed.success)
      return bad("batch name can only use letters, numbers, spaces, _ or -");

    const existing = await prisma.batch.findUnique({
      where: { batchCode: name },
      select: { id: true, batchCode: true, batchName: true },
    });
    if (existing)
      return { ok: true, data: { value: existing.id, label: existing.batchCode, hint: existing.batchName } };

    try {
      const b = await prisma.batch.create({
        data: { batchCode: name, batchName: name, description: "Quick-added from bulk upload" },
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_CREATED", entityType: "Batch", entityId: b.id,
        newValue: { batchCode: name, source: "bulk-quick-add" },
      });
      invalidateBatchCatalog();
      revalidatePath("/admin/batches");
      return { ok: true, data: { value: b.id, label: b.batchCode, hint: b.batchName } };
    } catch (e: any) {
      if (e?.code === "P2002") {
        const again = await prisma.batch.findUnique({
          where: { batchCode: name },
          select: { id: true, batchCode: true, batchName: true },
        });
        if (again) return { ok: true, data: { value: again.id, label: again.batchCode, hint: again.batchName } };
      }
      return bad("couldn't add that batch");
    }
  });
}

export async function updateBatch(batchId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(batchId).success) return bad("invalid id");
    const parsed = batchSchema.partial().safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!before) return bad("not found");
    try {
      const after = await prisma.batch.update({
        where: { id: batchId },
        data: {
          ...(parsed.data.batchCode !== undefined && { batchCode: parsed.data.batchCode }),
          ...(parsed.data.batchName !== undefined && { batchName: parsed.data.batchName }),
          ...(parsed.data.description !== undefined && {
            description: parsed.data.description || null,
          }),
        },
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_UPDATED", entityType: "Batch", entityId: batchId,
        oldValue: before, newValue: after,
      });
      invalidateBatchCatalog();
      revalidatePath("/admin/batches");
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate batchCode");
      return bad("update failed");
    }
  });
}

export async function deleteBatch(batchId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(batchId).success) return bad("invalid id");
    const before = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!before) return bad("not found");
    await prisma.batch.delete({ where: { id: batchId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BATCH_DELETED", entityType: "Batch", entityId: batchId, oldValue: before,
    });
    revalidatePath("/admin/batches");
    return { ok: true };
  });
}
