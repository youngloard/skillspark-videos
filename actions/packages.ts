"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { CATALOG_TAGS } from "@/lib/catalog-cache";
import { packageSchema, packageCoursesSchema, idSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

const invalidatePackageCatalog = () => revalidateTag(CATALOG_TAGS.packages);

export async function createPackage(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = packageSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;
    try {
      const pkg = await prisma.$transaction(async (tx) => {
        const p = await tx.package.create({
          data: {
            name: data.name,
            description: data.description || null,
            imageUrl: data.imageUrl || null,
            status: data.status,
          } as any,
        });
        if (data.courseIds.length) {
          await tx.packageCourse.createMany({
            data: data.courseIds.map((courseId) => ({ packageId: p.id, courseId })),
          });
        }
        return p;
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "PACKAGE_CREATED", entityType: "Package", entityId: pkg.id,
        newValue: { ...pkg, courseIds: data.courseIds },
      });
      for (const courseId of data.courseIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "PACKAGE_COURSE_ADDED", entityType: "Package", entityId: pkg.id,
          newValue: { courseId },
        });
      }
      invalidatePackageCatalog();
      revalidatePath("/admin/packages");
      return { ok: true, data: { id: pkg.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate package name");
      if (e?.code === "P2003") return bad("invalid course reference");
      return bad("create failed");
    }
  });
}

/**
 * Replaces the package's course list with the submitted set; insert/delete diff.
 */
export async function setPackageCourses(input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    const parsed = packageCoursesSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { packageId, courseIds } = parsed.data;

    const current = await prisma.packageCourse.findMany({
      where: { packageId },
      select: { courseId: true },
    });
    const have = new Set(current.map((c) => c.courseId));
    const want = new Set(courseIds);
    const add = [...want].filter((id) => !have.has(id));
    const remove = [...have].filter((id) => !want.has(id));

    try {
      await prisma.$transaction([
        ...(add.length
          ? [prisma.packageCourse.createMany({
              data: add.map((courseId) => ({ packageId, courseId })),
            })]
          : []),
        ...(remove.length
          ? [prisma.packageCourse.deleteMany({
              where: { packageId, courseId: { in: remove } },
            })]
          : []),
      ]);
    } catch (e: any) {
      if (e?.code === "P2003") return bad("invalid course reference");
      return bad("save failed");
    }
    for (const courseId of add) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "PACKAGE_COURSE_ADDED", entityType: "Package", entityId: packageId,
        newValue: { courseId },
      });
    }
    for (const courseId of remove) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "PACKAGE_COURSE_REMOVED", entityType: "Package", entityId: packageId,
        oldValue: { courseId },
      });
    }
    revalidatePath(`/admin/packages/${packageId}`);
    return { ok: true };
  });
}

export async function updatePackage(packageId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(packageId).success) return bad("invalid id");
    const parsed = packageSchema.partial().safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.package.findUnique({ where: { id: packageId } });
    if (!before) return bad("not found");
    try {
      const after = await prisma.package.update({
        where: { id: packageId },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.description !== undefined && {
            description: parsed.data.description || null,
          }),
          ...(parsed.data.imageUrl !== undefined && {
            imageUrl: parsed.data.imageUrl || null,
          }),
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
        } as any,
      });
      const action =
        parsed.data.status === "active" && before.status !== "active"
          ? "PACKAGE_ACTIVATED"
          : parsed.data.status === "inactive" && before.status !== "inactive"
            ? "PACKAGE_INACTIVATED"
            : "PACKAGE_UPDATED";
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action, entityType: "Package", entityId: packageId,
        oldValue: before, newValue: after,
      });
      invalidatePackageCatalog();
      revalidatePath("/admin/packages");
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate package name");
      return bad("update failed");
    }
  });
}

export async function deletePackage(packageId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(packageId).success) return bad("invalid id");
    const before = await prisma.package.findUnique({ where: { id: packageId } });
    if (!before) return bad("not found");
    await prisma.package.delete({ where: { id: packageId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "PACKAGE_DELETED", entityType: "Package", entityId: packageId, oldValue: before,
    });
    revalidatePath("/admin/packages");
    return { ok: true };
  });
}

export async function addCourseToPackage(packageId: string, courseId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(packageId).success || !idSchema.safeParse(courseId).success)
      return bad("invalid id");
    try {
      await prisma.packageCourse.create({ data: { packageId, courseId } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "PACKAGE_COURSE_ADDED", entityType: "Package", entityId: packageId,
        newValue: { courseId },
      });
      revalidatePath(`/admin/packages/${packageId}`);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("course already in package");
      if (e?.code === "P2003") return bad("course or package not found");
      return bad("add failed");
    }
  });
}

export async function removeCourseFromPackage(packageId: string, courseId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(packageId).success || !idSchema.safeParse(courseId).success)
      return bad("invalid id");
    await prisma.packageCourse.deleteMany({ where: { packageId, courseId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "PACKAGE_COURSE_REMOVED", entityType: "Package", entityId: packageId,
      oldValue: { courseId },
    });
    revalidatePath(`/admin/packages/${packageId}`);
    return { ok: true };
  });
}
