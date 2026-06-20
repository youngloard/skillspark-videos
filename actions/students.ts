"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { CATALOG_TAGS } from "@/lib/catalog-cache";
import {
  studentCreateSchema,
  studentUpdateSchema,
  studentEnrollmentsSchema,
  idSchema,
} from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";
import type { Admin } from "@prisma/client";

/**
 * Resolve a batchCode submitted by the student-add/edit form:
 *   - if it matches an existing batch, returns that id;
 *   - if it's a new code, creates the batch on the fly (batchName = batchCode,
 *     description marked as auto-created so admins can later spot/edit it);
 *   - empty string → null (no batch).
 * Returns null on empty input. Throws on invalid format (caller treats as bad input).
 */
async function resolveOrCreateBatchByCode(
  admin: Admin,
  rawCode: string | null | undefined,
): Promise<{ id: string | null; created: boolean }> {
  const code = (rawCode ?? "").trim();
  if (!code) return { id: null, created: false };
  if (!/^[A-Za-z0-9 _-]+$/.test(code)) {
    throw new Error("invalid batchCode format");
  }
  const existing = await prisma.batch.findUnique({ where: { batchCode: code } });
  if (existing) return { id: existing.id, created: false };
  try {
    const created = await prisma.batch.create({
      data: {
        batchCode: code,
        batchName: code,
        description: "Auto-created from student form",
      },
    });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BATCH_CREATED", entityType: "Batch", entityId: created.id,
      newValue: {
        batchCode: code, batchName: code,
        source: "student-form-auto",
      },
    });
    revalidateTag(CATALOG_TAGS.batches);
    revalidatePath("/admin/batches");
    return { id: created.id, created: true };
  } catch (e: any) {
    // Race: another writer created it between our read and our write. Re-read.
    if (e?.code === "P2002") {
      const again = await prisma.batch.findUnique({ where: { batchCode: code } });
      if (again) return { id: again.id, created: false };
    }
    throw e;
  }
}

/** Re-exported for callers that imported the old name. */
export type ActionResult<T = unknown> = R<T>;

/**
 * One-shot student creation: row + direct course/package enrollments in one transaction.
 * Emits one STUDENT_CREATED audit log plus per-enrollment audit logs.
 */
export async function createStudent(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = studentCreateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;

    // Resolve batchCode (preferred) or fall back to a pre-resolved batchId.
    let batchId: string | null = data.batchId ?? null;
    if (data.batchCode !== undefined && data.batchCode !== null) {
      try {
        const r = await resolveOrCreateBatchByCode(admin, data.batchCode);
        batchId = r.id;
      } catch (e: any) {
        return bad(e?.message === "invalid batchCode format" ? e.message : "batch resolution failed");
      }
    }

    try {
      const student = await prisma.$transaction(async (tx) => {
        const s = await tx.student.create({
          data: {
            studentCode: data.studentCode,
            name: data.name,
            email: data.email,
            batchId,
            accessStartDate: data.accessStartDate,
            accessEndDate: data.accessEndDate,
          },
        });
        if (data.courseIds.length) {
          await tx.studentCourse.createMany({
            data: data.courseIds.map((courseId) => ({ studentId: s.id, courseId })),
          });
        }
        if (data.packageIds.length) {
          await tx.studentPackage.createMany({
            data: data.packageIds.map((packageId) => ({ studentId: s.id, packageId })),
          });
        }
        return s;
      });

      await createAuditLog({
        actorId: admin.id,
        actorEmail: admin.email,
        actorType: "admin",
        action: "STUDENT_CREATED",
        entityType: "Student",
        entityId: student.id,
        newValue: {
          ...student,
          courseIds: data.courseIds,
          packageIds: data.packageIds,
        },
      });
      for (const courseId of data.courseIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "STUDENT_COURSE_ASSIGNED", entityType: "Student", entityId: student.id,
          newValue: { courseId },
        });
      }
      for (const packageId of data.packageIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "STUDENT_PACKAGE_ASSIGNED", entityType: "Student", entityId: student.id,
          newValue: { packageId },
        });
      }
      revalidatePath("/admin/students");
      return { ok: true, data: { id: student.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate email or studentCode");
      if (e?.code === "P2003") return bad("invalid course/package/batch reference");
      return bad("create failed");
    }
  });
}

export async function updateStudent(studentId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success) return bad("invalid id");
    const parsed = studentUpdateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.student.findUnique({ where: { id: studentId } });
    if (!before) return bad("not found");

    // Resolve batchCode → batchId (auto-creating the batch if it's new) so
    // the edit form can use the same quick-entry as the add form.
    const { batchCode, ...rest } = parsed.data;
    let resolvedBatchId: string | null | undefined = rest.batchId;
    if (batchCode !== undefined && batchCode !== null) {
      try {
        const r = await resolveOrCreateBatchByCode(admin, batchCode);
        resolvedBatchId = r.id;
      } catch (e: any) {
        return bad(e?.message === "invalid batchCode format" ? e.message : "batch resolution failed");
      }
    }

    try {
      const after = await prisma.student.update({
        where: { id: studentId },
        data: { ...rest, ...(resolvedBatchId !== undefined && { batchId: resolvedBatchId }) },
      });
      const action =
        rest.status === "blocked" && before.status !== "blocked"
          ? "STUDENT_BLOCKED"
          : rest.status === "active" && before.status !== "active"
            ? "STUDENT_ACTIVATED"
            : resolvedBatchId !== undefined && resolvedBatchId !== before.batchId
              ? "STUDENT_BATCH_CHANGED"
              : (rest.accessStartDate &&
                    +rest.accessStartDate !== +before.accessStartDate) ||
                  (rest.accessEndDate &&
                    +rest.accessEndDate !== +before.accessEndDate)
                ? "STUDENT_ACCESS_DATES_CHANGED"
                : "STUDENT_UPDATED";
      await createAuditLog({
        actorId: admin.id,
        actorEmail: admin.email,
        actorType: "admin",
        action,
        entityType: "Student",
        entityId: studentId,
        oldValue: before,
        newValue: after,
      });
      revalidatePath("/admin/students");
      revalidatePath(`/admin/students/${studentId}`);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate email or studentCode");
      return bad("update failed");
    }
  });
}

/**
 * Replaces the student's direct course/package enrollment set with the submitted set.
 * Computes the diff vs current rows and inserts/deletes only what changed, auditing each delta.
 */
export async function setStudentEnrollments(input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    const parsed = studentEnrollmentsSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { studentId, courseIds, packageIds } = parsed.data;

    const [currentCourses, currentPackages] = await Promise.all([
      prisma.studentCourse.findMany({ where: { studentId }, select: { courseId: true } }),
      prisma.studentPackage.findMany({ where: { studentId }, select: { packageId: true } }),
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
          ? [prisma.studentCourse.createMany({
              data: addCourses.map((courseId) => ({ studentId, courseId })),
            })]
          : []),
        ...(removeCourses.length
          ? [prisma.studentCourse.deleteMany({
              where: { studentId, courseId: { in: removeCourses } },
            })]
          : []),
        ...(addPackages.length
          ? [prisma.studentPackage.createMany({
              data: addPackages.map((packageId) => ({ studentId, packageId })),
            })]
          : []),
        ...(removePackages.length
          ? [prisma.studentPackage.deleteMany({
              where: { studentId, packageId: { in: removePackages } },
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
        action: "STUDENT_COURSE_ASSIGNED", entityType: "Student", entityId: studentId,
        newValue: { courseId },
      });
    }
    for (const courseId of removeCourses) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_COURSE_REMOVED", entityType: "Student", entityId: studentId,
        oldValue: { courseId },
      });
    }
    for (const packageId of addPackages) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_PACKAGE_ASSIGNED", entityType: "Student", entityId: studentId,
        newValue: { packageId },
      });
    }
    for (const packageId of removePackages) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_PACKAGE_REMOVED", entityType: "Student", entityId: studentId,
        oldValue: { packageId },
      });
    }
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true };
  });
}

/**
 * Form-action wrapper for the student-add page. Designed to be used with
 * React 19's `useActionState`:
 *   - signature `(prevState, formData) => nextState`
 *   - returns a serializable result object (never throws on validation /
 *     duplicate errors) so the client can render the error inline.
 */
export type StudentFormState = {
  ok: boolean;
  error?: string;
  /** Monotonic counter that increments on each successful create. The form
   *  uses it as a `key` to reset itself after a successful submission. */
  submittedAt?: number;
};

export async function createStudentFormAction(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const r = await createStudent({
    studentCode: formData.get("studentCode"),
    name: formData.get("name"),
    email: formData.get("email"),
    batchCode: formData.get("batchCode"),
    accessStartDate: formData.get("accessStartDate"),
    accessEndDate: formData.get("accessEndDate"),
    courseIds: formData.getAll("courseIds"),
    packageIds: formData.getAll("packageIds"),
  });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/students");
  return { ok: true, submittedAt: Date.now() };
}

export async function deleteStudent(studentId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success) return bad("invalid id");
    const before = await prisma.student.findUnique({ where: { id: studentId } });
    if (!before) return bad("not found");
    await prisma.student.delete({ where: { id: studentId } });
    await createAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      actorType: "admin",
      action: "STUDENT_DELETED",
      entityType: "Student",
      entityId: studentId,
      oldValue: before,
    });
    revalidatePath("/admin/students");
    return { ok: true };
  });
}
