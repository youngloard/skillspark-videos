"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { CATALOG_TAGS } from "@/lib/catalog-cache";
import {
  batchSchema,
  batchEnrollmentsSchema,
  idSchema,
} from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

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
        if (data.packageIds.length) {
          await tx.batchPackage.createMany({
            data: data.packageIds.map((packageId) => ({ batchId: b.id, packageId })),
          });
        }
        return b;
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_CREATED", entityType: "Batch", entityId: batch.id,
        newValue: { ...batch, courseIds: data.courseIds, packageIds: data.packageIds },
      });
      for (const courseId of data.courseIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "BATCH_COURSE_ASSIGNED", entityType: "Batch", entityId: batch.id,
          newValue: { courseId },
        });
      }
      for (const packageId of data.packageIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "BATCH_PACKAGE_ASSIGNED", entityType: "Batch", entityId: batch.id,
          newValue: { packageId },
        });
      }
      invalidateBatchCatalog();
      revalidatePath("/admin/batches");
      return { ok: true, data: { id: batch.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate batchCode");
      if (e?.code === "P2003") return bad("invalid course/package reference");
      return bad("create failed");
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

/**
 * Replaces the batch's course/package assignments with the submitted set.
 * Only inserts/deletes the diff; audits each delta.
 */
export async function setBatchEnrollments(input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    const parsed = batchEnrollmentsSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { batchId, courseIds, packageIds } = parsed.data;

    const [currentCourses, currentPackages] = await Promise.all([
      prisma.batchCourse.findMany({ where: { batchId }, select: { courseId: true } }),
      prisma.batchPackage.findMany({ where: { batchId }, select: { packageId: true } }),
    ]);
    const haveCourses = new Set(currentCourses.map((c) => c.courseId));
    const havePackages = new Set(currentPackages.map((p) => p.packageId));
    const wantCourses = new Set(courseIds);
    const wantPackages = new Set(packageIds);

    const addCourses = [...wantCourses].filter((id) => !haveCourses.has(id));
    const removeCourses = [...haveCourses].filter((id) => !wantCourses.has(id));
    const addPackages = [...wantPackages].filter((id) => !havePackages.has(id));
    const removePackages = [...havePackages].filter((id) => !wantPackages.has(id));

    try {
      await prisma.$transaction([
        ...(addCourses.length
          ? [prisma.batchCourse.createMany({
              data: addCourses.map((courseId) => ({ batchId, courseId })),
            })]
          : []),
        ...(removeCourses.length
          ? [prisma.batchCourse.deleteMany({
              where: { batchId, courseId: { in: removeCourses } },
            })]
          : []),
        ...(addPackages.length
          ? [prisma.batchPackage.createMany({
              data: addPackages.map((packageId) => ({ batchId, packageId })),
            })]
          : []),
        ...(removePackages.length
          ? [prisma.batchPackage.deleteMany({
              where: { batchId, packageId: { in: removePackages } },
            })]
          : []),
      ]);
    } catch (e: any) {
      if (e?.code === "P2003") return bad("invalid course/package reference");
      return bad("save failed");
    }

    for (const courseId of addCourses) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_COURSE_ASSIGNED", entityType: "Batch", entityId: batchId,
        newValue: { courseId },
      });
    }
    for (const courseId of removeCourses) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_COURSE_REMOVED", entityType: "Batch", entityId: batchId,
        oldValue: { courseId },
      });
    }
    for (const packageId of addPackages) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_PACKAGE_ASSIGNED", entityType: "Batch", entityId: batchId,
        newValue: { packageId },
      });
    }
    for (const packageId of removePackages) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_PACKAGE_REMOVED", entityType: "Batch", entityId: batchId,
        oldValue: { packageId },
      });
    }
    revalidatePath(`/admin/batches/${batchId}`);
    return { ok: true };
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
