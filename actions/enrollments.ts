"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog, type AuditAction } from "@/lib/audit-log";
import { idSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";
import type { Admin } from "@prisma/client";

/**
 * The eight enrollment actions all share the same shape: validate two IDs,
 * call a Prisma create/delete, audit, revalidate. Extract the shape to keep
 * each named action a one-liner.
 */
type AssignSpec = {
  primaryId: string;
  secondaryId: string;
  assignAuditAction: AuditAction;
  primaryEntity: "Student" | "Batch";
  secondaryKey: "courseId" | "packageId";
  notFoundMsg: string;
  revalidatePaths: string[];
  create: () => Promise<unknown>;
};

async function doAssign(admin: Admin, spec: AssignSpec): Promise<R> {
  if (!idSchema.safeParse(spec.primaryId).success || !idSchema.safeParse(spec.secondaryId).success)
    return bad("invalid id");
  try {
    await spec.create();
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: spec.assignAuditAction,
      entityType: spec.primaryEntity, entityId: spec.primaryId,
      newValue: { [spec.secondaryKey]: spec.secondaryId },
    });
    for (const p of spec.revalidatePaths) revalidatePath(p);
    return { ok: true };
  } catch (e: any) {
    if (e?.code === "P2002") return bad("already assigned");
    if (e?.code === "P2003") return bad(spec.notFoundMsg);
    return bad("assign failed");
  }
}

type RemoveSpec = {
  primaryId: string;
  secondaryId: string;
  removeAuditAction: AuditAction;
  primaryEntity: "Student" | "Batch";
  secondaryKey: "courseId" | "packageId";
  revalidatePaths: string[];
  remove: () => Promise<unknown>;
};

async function doRemove(admin: Admin, spec: RemoveSpec): Promise<R> {
  if (!idSchema.safeParse(spec.primaryId).success || !idSchema.safeParse(spec.secondaryId).success)
    return bad("invalid id");
  await spec.remove();
  await createAuditLog({
    actorId: admin.id, actorEmail: admin.email, actorType: "admin",
    action: spec.removeAuditAction,
    entityType: spec.primaryEntity, entityId: spec.primaryId,
    oldValue: { [spec.secondaryKey]: spec.secondaryId },
  });
  for (const p of spec.revalidatePaths) revalidatePath(p);
  return { ok: true };
}

// ---------- Student ↔ Course ----------
export async function assignCourseToStudent(studentId: string, courseId: string): Promise<R> {
  return withAdmin((admin) => doAssign(admin, {
    primaryId: studentId, secondaryId: courseId,
    assignAuditAction: "STUDENT_COURSE_ASSIGNED",
    primaryEntity: "Student", secondaryKey: "courseId",
    notFoundMsg: "student or course not found",
    revalidatePaths: [`/admin/students/${studentId}`, "/admin/enrollments"],
    create: () => prisma.studentCourse.create({ data: { studentId, courseId } }),
  }));
}

export async function removeCourseFromStudent(studentId: string, courseId: string): Promise<R> {
  return withAdmin((admin) => doRemove(admin, {
    primaryId: studentId, secondaryId: courseId,
    removeAuditAction: "STUDENT_COURSE_REMOVED",
    primaryEntity: "Student", secondaryKey: "courseId",
    revalidatePaths: [`/admin/students/${studentId}`],
    remove: () => prisma.studentCourse.deleteMany({ where: { studentId, courseId } }),
  }));
}

// ---------- Student ↔ Package ----------
export async function assignPackageToStudent(studentId: string, packageId: string): Promise<R> {
  return withAdmin((admin) => doAssign(admin, {
    primaryId: studentId, secondaryId: packageId,
    assignAuditAction: "STUDENT_PACKAGE_ASSIGNED",
    primaryEntity: "Student", secondaryKey: "packageId",
    notFoundMsg: "student or package not found",
    revalidatePaths: [`/admin/students/${studentId}`],
    create: () => prisma.studentPackage.create({ data: { studentId, packageId } }),
  }));
}

export async function removePackageFromStudent(studentId: string, packageId: string): Promise<R> {
  return withAdmin((admin) => doRemove(admin, {
    primaryId: studentId, secondaryId: packageId,
    removeAuditAction: "STUDENT_PACKAGE_REMOVED",
    primaryEntity: "Student", secondaryKey: "packageId",
    revalidatePaths: [`/admin/students/${studentId}`],
    remove: () => prisma.studentPackage.deleteMany({ where: { studentId, packageId } }),
  }));
}

// ---------- Batch ↔ Course ----------
export async function assignCourseToBatch(batchId: string, courseId: string): Promise<R> {
  return withAdmin((admin) => doAssign(admin, {
    primaryId: batchId, secondaryId: courseId,
    assignAuditAction: "BATCH_COURSE_ASSIGNED",
    primaryEntity: "Batch", secondaryKey: "courseId",
    notFoundMsg: "batch or course not found",
    revalidatePaths: [`/admin/batches/${batchId}`],
    create: () => prisma.batchCourse.create({ data: { batchId, courseId } }),
  }));
}

export async function removeCourseFromBatch(batchId: string, courseId: string): Promise<R> {
  return withAdmin((admin) => doRemove(admin, {
    primaryId: batchId, secondaryId: courseId,
    removeAuditAction: "BATCH_COURSE_REMOVED",
    primaryEntity: "Batch", secondaryKey: "courseId",
    revalidatePaths: [`/admin/batches/${batchId}`],
    remove: () => prisma.batchCourse.deleteMany({ where: { batchId, courseId } }),
  }));
}

// ---------- Batch ↔ Package ----------
export async function assignPackageToBatch(batchId: string, packageId: string): Promise<R> {
  return withAdmin((admin) => doAssign(admin, {
    primaryId: batchId, secondaryId: packageId,
    assignAuditAction: "BATCH_PACKAGE_ASSIGNED",
    primaryEntity: "Batch", secondaryKey: "packageId",
    notFoundMsg: "batch or package not found",
    revalidatePaths: [`/admin/batches/${batchId}`],
    create: () => prisma.batchPackage.create({ data: { batchId, packageId } }),
  }));
}

export async function removePackageFromBatch(batchId: string, packageId: string): Promise<R> {
  return withAdmin((admin) => doRemove(admin, {
    primaryId: batchId, secondaryId: packageId,
    removeAuditAction: "BATCH_PACKAGE_REMOVED",
    primaryEntity: "Batch", secondaryKey: "packageId",
    revalidatePaths: [`/admin/batches/${batchId}`],
    remove: () => prisma.batchPackage.deleteMany({ where: { batchId, packageId } }),
  }));
}

// ---------- Course denial (per-student hard block) ----------
export async function denyCourseForStudent(
  studentId: string,
  courseId: string,
  reason?: string,
): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success || !idSchema.safeParse(courseId).success)
      return bad("invalid id");
    try {
      await prisma.studentCourseDenial.upsert({
        where: { studentId_courseId: { studentId, courseId } },
        create: { studentId, courseId, reason: reason?.trim() || null },
        update: { reason: reason?.trim() || null },
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_COURSE_DENIED", entityType: "Student", entityId: studentId,
        newValue: { courseId, reason: reason ?? null },
      });
      revalidatePath(`/admin/students/${studentId}`);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2003") return bad("student or course not found");
      return bad("deny failed");
    }
  });
}

export async function undenyCourseForStudent(
  studentId: string,
  courseId: string,
): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success || !idSchema.safeParse(courseId).success)
      return bad("invalid id");
    await prisma.studentCourseDenial.deleteMany({ where: { studentId, courseId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "STUDENT_COURSE_DENIAL_REMOVED", entityType: "Student", entityId: studentId,
      oldValue: { courseId },
    });
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true };
  });
}
