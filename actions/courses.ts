"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { CATALOG_TAGS } from "@/lib/catalog-cache";
import { courseSchema, idSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

const invalidateCourseCatalog = () => revalidateTag(CATALOG_TAGS.courses);

export async function createCourse(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = courseSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    try {
      const course = await prisma.course.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description || null,
          imageUrl: parsed.data.imageUrl || null,
          status: parsed.data.status,
          layout: parsed.data.layout,
        } as any,
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "COURSE_CREATED", entityType: "Course", entityId: course.id, newValue: course,
      });
      invalidateCourseCatalog();
      revalidatePath("/admin/courses");
      return { ok: true, data: { id: course.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate course name");
      return bad("create failed");
    }
  });
}

export async function updateCourse(courseId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(courseId).success) return bad("invalid id");
    const parsed = courseSchema.partial().safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.course.findUnique({
      where: { id: courseId },
      include: { _count: { select: { modules: true, videos: true } } },
    });
    if (!before) return bad("not found");

    // Block layout changes if the course already has content — switching would orphan it.
    if (parsed.data.layout && parsed.data.layout !== before.layout) {
      const hasContent = before._count.modules > 0 || before._count.videos > 0;
      if (hasContent) {
        return bad(
          "cannot change layout while the course has modules or videos — delete them first",
        );
      }
    }

    try {
      const after = await prisma.course.update({
        where: { id: courseId },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.description !== undefined && {
            description: parsed.data.description || null,
          }),
          ...(parsed.data.imageUrl !== undefined && {
            imageUrl: parsed.data.imageUrl || null,
          }),
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          ...(parsed.data.layout !== undefined && { layout: parsed.data.layout }),
        } as any,
      });
      const action =
        parsed.data.status === "active" && before.status !== "active"
          ? "COURSE_ACTIVATED"
          : parsed.data.status === "inactive" && before.status !== "inactive"
            ? "COURSE_INACTIVATED"
            : "COURSE_UPDATED";
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action, entityType: "Course", entityId: courseId,
        oldValue: before, newValue: after,
      });
      invalidateCourseCatalog();
      revalidatePath("/admin/courses");
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate course name");
      return bad("update failed");
    }
  });
}

export async function deleteCourse(courseId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(courseId).success) return bad("invalid id");
    const before = await prisma.course.findUnique({ where: { id: courseId } });
    if (!before) return bad("not found");
    await prisma.course.delete({ where: { id: courseId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "COURSE_DELETED", entityType: "Course", entityId: courseId, oldValue: before,
    });
    revalidatePath("/admin/courses");
    return { ok: true };
  });
}
