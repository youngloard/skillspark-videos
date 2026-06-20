"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog, type AuditAction } from "@/lib/audit-log";
import {
  parseBulkStudents,
  parseBulkBatches,
  parseBulkCourses,
  parseIdentifierList,
} from "@/lib/bulk";
import { bulkActionSchema, dateSchema } from "@/lib/validations";
import { z } from "zod";
import { bad, withAdminD, type RD } from "./_shared";
import { CATALOG_TAGS } from "@/lib/catalog-cache";

// Bulk actions always return a payload, so use RD (required data) locally.
type R<T> = RD<T>;

const MAX_TEXT_LEN = 200_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const bulkAddArgs = z.object({
  text: z.string().min(1).max(MAX_TEXT_LEN),
  defaultStartDate: dateSchema,
  defaultEndDate: dateSchema,
});

/**
 * Accepts FormData. The same form supports three orthogonal ways to express enrollments:
 *
 *   1. Paste/CSV columns: studentCode,name,email[,batchCode[,courseNames[,packageNames]]]
 *      — courseNames/packageNames are `+`-separated by name (e.g. "Excel+SQL")
 *   2. Apply-to-all selectors: applyBatchId, applyCourseIds[], applyPackageIds[]
 *      — added on top of every row's enrollments
 *
 * Resolution: row's `batchCode` wins for batch; for courses/packages we union the
 * row's parsed names with the form-wide apply-to-all list.
 */
export async function bulkAddStudentsFromForm(
  formData: FormData,
): Promise<R<{ created: number; skipped: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {

  let text = String(formData.get("text") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "file exceeds 5 MB" };
    const fileText = await file.text();
    text = text ? `${text}\n${fileText}` : fileText;
  }
  if (!text.trim()) return { ok: false, error: "no input provided" };

  const parsed = bulkAddArgs.safeParse({
    text,
    defaultStartDate: formData.get("defaultStartDate"),
    defaultEndDate: formData.get("defaultEndDate"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsed.data.defaultEndDate < parsed.data.defaultStartDate)
    return { ok: false, error: "endDate before startDate" };

  // Apply-to-all selectors.
  const applyBatchId = String(formData.get("applyBatchId") ?? "") || null;
  const applyCourseIds = formData.getAll("applyCourseIds").map(String).filter(Boolean);
  const applyPackageIds = formData.getAll("applyPackageIds").map(String).filter(Boolean);

  const { rows: rawRows, errors } = parseBulkStudents(parsed.data.text);
  const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
  let skipped = 0;

  // 1. Dedupe within the input itself by studentCode and email (first wins).
  const seenCodes = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: typeof rawRows = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (seenCodes.has(row.studentCode) || seenEmails.has(row.email)) {
      skipped++;
      continue;
    }
    seenCodes.add(row.studentCode);
    seenEmails.add(row.email);
    rows.push(row);
  }

  // 2. Pre-check DB for existing studentCode or email; skip those silently.
  const existing = rows.length
    ? await prisma.student.findMany({
        where: {
          OR: [
            { studentCode: { in: rows.map((r) => r.studentCode) } },
            { email: { in: rows.map((r) => r.email) } },
          ],
        },
        select: { studentCode: true, email: true },
      })
    : [];
  const existingCodes = new Set(existing.map((s) => s.studentCode));
  const existingEmails = new Set(existing.map((s) => s.email));

  // 3. Resolve referenced batch/course/package names in batch.
  const batchCodes = [...new Set(rows.map((r) => r.batchCode).filter((b): b is string => !!b))];
  const courseNames = [...new Set(rows.flatMap((r) => r.courseNames))];
  const packageNames = [...new Set(rows.flatMap((r) => r.packageNames))];
  const [batchesByCode, coursesByName, packagesByName] = await Promise.all([
    batchCodes.length
      ? prisma.batch.findMany({ where: { batchCode: { in: batchCodes } } })
        .then((bs) => new Map(bs.map((b) => [b.batchCode, b.id])))
      : Promise.resolve(new Map<string, string>()),
    courseNames.length
      ? prisma.course.findMany({ where: { name: { in: courseNames } } })
        .then((cs) => new Map(cs.map((c) => [c.name, c.id])))
      : Promise.resolve(new Map<string, string>()),
    packageNames.length
      ? prisma.package.findMany({ where: { name: { in: packageNames } } })
        .then((ps) => new Map(ps.map((p) => [p.name, p.id])))
      : Promise.resolve(new Map<string, string>()),
  ]);

  // 3b. Auto-create any batchCodes referenced by rows that don't exist yet.
  // Keeps bulk-upload from blocking on "unknown batchCode" — admins can add a
  // batch implicitly by mentioning it on a student row. Batches created this
  // way have batchName=batchCode and no course/package mappings; admin can
  // edit later.
  const missingBatchCodes = batchCodes.filter((code) => !batchesByCode.has(code));
  const autoCreatedBatches: { id: string; batchCode: string }[] = [];
  for (const code of missingBatchCodes) {
    // Defensive: batchCode must satisfy schema regex (parser already validates).
    if (!/^[A-Za-z0-9 _-]+$/.test(code)) continue;
    try {
      const b = await prisma.batch.create({
        data: {
          batchCode: code,
          batchName: code,
          description: "Auto-created from bulk student upload",
        },
      });
      batchesByCode.set(code, b.id);
      autoCreatedBatches.push({ id: b.id, batchCode: code });
    } catch (e: any) {
      // Race: someone else created the same batchCode. Re-read it.
      if (e?.code === "P2002") {
        const existing = await prisma.batch.findUnique({
          where: { batchCode: code },
          select: { id: true },
        });
        if (existing) batchesByCode.set(code, existing.id);
      }
      // Other failures fall through: rows referencing this code will fail with
      // "unknown batchCode" below, which is the correct behavior.
    }
  }
  // Audit each auto-create so the trail records which batches were materialized
  // implicitly vs. created via the explicit batch form.
  for (const b of autoCreatedBatches) {
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BATCH_CREATED", entityType: "Batch", entityId: b.id,
      newValue: { batchCode: b.batchCode, batchName: b.batchCode, source: "bulk-students-auto" },
    });
  }

  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Skip silently if already in DB.
    if (existingCodes.has(row.studentCode) || existingEmails.has(row.email)) {
      skipped++;
      continue;
    }

    // Resolve batch.
    let batchId: string | null = null;
    if (row.batchCode) {
      const id = batchesByCode.get(row.batchCode);
      if (!id) {
        failed.push({ line: i + 1, reason: `unknown batchCode ${row.batchCode}` });
        continue;
      }
      batchId = id;
    } else if (applyBatchId) {
      batchId = applyBatchId;
    }

    // Resolve courses (row + apply-to-all).
    const rowCourseIds: string[] = [];
    let courseResolveError: string | null = null;
    for (const n of row.courseNames) {
      const id = coursesByName.get(n);
      if (!id) { courseResolveError = `unknown course "${n}"`; break; }
      rowCourseIds.push(id);
    }
    if (courseResolveError) {
      failed.push({ line: i + 1, reason: courseResolveError });
      continue;
    }
    const courseIds = [...new Set([...rowCourseIds, ...applyCourseIds])];

    // Resolve packages (row + apply-to-all).
    const rowPackageIds: string[] = [];
    let packageResolveError: string | null = null;
    for (const n of row.packageNames) {
      const id = packagesByName.get(n);
      if (!id) { packageResolveError = `unknown package "${n}"`; break; }
      rowPackageIds.push(id);
    }
    if (packageResolveError) {
      failed.push({ line: i + 1, reason: packageResolveError });
      continue;
    }
    const packageIds = [...new Set([...rowPackageIds, ...applyPackageIds])];

    try {
      await prisma.$transaction(async (tx) => {
        const s = await tx.student.create({
          data: {
            studentCode: row.studentCode,
            name: row.name,
            email: row.email,
            batchId,
            accessStartDate: parsed.data.defaultStartDate,
            accessEndDate: parsed.data.defaultEndDate,
          },
        });
        if (courseIds.length) {
          await tx.studentCourse.createMany({
            data: courseIds.map((courseId) => ({ studentId: s.id, courseId })),
          });
        }
        if (packageIds.length) {
          await tx.studentPackage.createMany({
            data: packageIds.map((packageId) => ({ studentId: s.id, packageId })),
          });
        }
      });
      created++;
    } catch (e: any) {
      if (e?.code === "P2002") {
        // Race: someone else inserted between our pre-check and create. Treat as duplicate.
        skipped++;
      } else if (e?.code === "P2003") {
        failed.push({ line: i + 1, reason: "invalid course/package/batch reference" });
      } else {
        failed.push({ line: i + 1, reason: "create failed" });
      }
    }
  }
  await createAuditLog({
    actorId: admin.id, actorEmail: admin.email, actorType: "admin",
    action: "BULK_STUDENTS_CREATED", entityType: "Student",
    newValue: {
      created,
      skipped,
      failedCount: failed.length,
      applyBatchId,
      applyCourseIdsCount: applyCourseIds.length,
      applyPackageIdsCount: applyPackageIds.length,
      autoCreatedBatches: autoCreatedBatches.map((b) => b.batchCode),
    },
  });
  revalidatePath("/admin/students");
  if (autoCreatedBatches.length) {
    revalidatePath("/admin/batches");
    revalidateTag(CATALOG_TAGS.batches);
  }
  return { ok: true, data: { created, skipped, failed } };
  });
}

const bulkEnrollArgs = z.object({
  identifiers: z.string().min(1).max(MAX_TEXT_LEN),
  courseId: z.string().optional(),
  packageId: z.string().optional(),
}).refine((a) => !!a.courseId !== !!a.packageId, {
  message: "provide exactly one of courseId or packageId",
});

export async function bulkEnrollStudentsFromForm(
  formData: FormData,
): Promise<R<{ assigned: number; skipped: { ident: string; reason: string }[] }>> {
  return withAdminD(async (admin) => {

  let identifiers = String(formData.get("identifiers") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "file exceeds 5 MB" };
    const t = await file.text();
    identifiers = identifiers ? `${identifiers}\n${t}` : t;
  }
  const parsed = bulkEnrollArgs.safeParse({
    identifiers,
    courseId: formData.get("courseId") || undefined,
    packageId: formData.get("packageId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const idents = parseIdentifierList(parsed.data.identifiers);
  if (idents.length === 0) return { ok: false, error: "no identifiers provided" };

  const matches = await prisma.student.findMany({
    where: {
      OR: [
        { studentCode: { in: idents } },
        { email: { in: idents.map((i) => i.toLowerCase()) } },
      ],
    },
    select: { id: true, studentCode: true, email: true },
  });
  const byKey = new Map<string, string>();
  for (const s of matches) {
    byKey.set(s.studentCode, s.id);
    byKey.set(s.email.toLowerCase(), s.id);
  }

  const skipped: { ident: string; reason: string }[] = [];
  const studentIds: string[] = [];
  for (const ident of idents) {
    const id = byKey.get(ident) ?? byKey.get(ident.toLowerCase());
    if (!id) skipped.push({ ident, reason: "no match" });
    else if (!studentIds.includes(id)) studentIds.push(id);
  }
  if (studentIds.length === 0) return { ok: true, data: { assigned: 0, skipped } };

  let assigned = 0;
  if (parsed.data.courseId) {
    for (const sid of studentIds) {
      try {
        await prisma.studentCourse.create({
          data: { studentId: sid, courseId: parsed.data.courseId },
        });
        assigned++;
      } catch (e: any) {
        if (e?.code === "P2002") skipped.push({ ident: sid, reason: "already enrolled" });
        else if (e?.code === "P2003") skipped.push({ ident: sid, reason: "course not found" });
        else skipped.push({ ident: sid, reason: "create failed" });
      }
    }
  } else if (parsed.data.packageId) {
    for (const sid of studentIds) {
      try {
        await prisma.studentPackage.create({
          data: { studentId: sid, packageId: parsed.data.packageId },
        });
        assigned++;
      } catch (e: any) {
        if (e?.code === "P2002") skipped.push({ ident: sid, reason: "already enrolled" });
        else if (e?.code === "P2003") skipped.push({ ident: sid, reason: "package not found" });
        else skipped.push({ ident: sid, reason: "create failed" });
      }
    }
  }

  await createAuditLog({
    actorId: admin.id, actorEmail: admin.email, actorType: "admin",
    action: "BULK_ENROLLMENT_CREATED",
    entityType: parsed.data.courseId ? "Course" : "Package",
    entityId: parsed.data.courseId ?? parsed.data.packageId ?? null,
    newValue: { assigned, skippedCount: skipped.length },
  });
  revalidatePath("/admin/enrollments");
  return { ok: true, data: { assigned, skipped } };
  });
}

// ---------- Bulk add batches ----------

const bulkBatchesArgs = z.object({
  text: z.string().min(1).max(MAX_TEXT_LEN),
});

/**
 * Accepts FormData with `text` (paste) and/or `file` (CSV/.txt). Same dedup story
 * as students: dedupe within input by batchCode, then pre-check DB and skip
 * existing batchCodes. Resolves courseNames/packageNames per row + apply-to-all
 * pickers, inserts batch + assignments in one transaction.
 */
export async function bulkAddBatchesFromForm(
  formData: FormData,
): Promise<R<{ created: number; skipped: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {

  let text = String(formData.get("text") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "file exceeds 5 MB" };
    const t = await file.text();
    text = text ? `${text}\n${t}` : t;
  }
  if (!text.trim()) return { ok: false, error: "no input provided" };

  const parsed = bulkBatchesArgs.safeParse({ text });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const applyCourseIds = formData.getAll("applyCourseIds").map(String).filter(Boolean);
  const applyPackageIds = formData.getAll("applyPackageIds").map(String).filter(Boolean);

  const { rows: rawRows, errors } = parseBulkBatches(parsed.data.text);
  const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
  let skipped = 0;

  // 1. Within-input dedup by batchCode (first wins).
  const seen = new Set<string>();
  const rows: typeof rawRows = [];
  for (const r of rawRows) {
    if (seen.has(r.batchCode)) { skipped++; continue; }
    seen.add(r.batchCode);
    rows.push(r);
  }

  // 2. Pre-check DB.
  const existing = rows.length
    ? await prisma.batch.findMany({
        where: { batchCode: { in: rows.map((r) => r.batchCode) } },
        select: { batchCode: true },
      })
    : [];
  const existingCodes = new Set(existing.map((b) => b.batchCode));

  // 3. Resolve referenced course/package names.
  const courseNames = [...new Set(rows.flatMap((r) => r.courseNames))];
  const packageNames = [...new Set(rows.flatMap((r) => r.packageNames))];
  const [coursesByName, packagesByName] = await Promise.all([
    courseNames.length
      ? prisma.course.findMany({ where: { name: { in: courseNames } } })
        .then((cs) => new Map(cs.map((c) => [c.name, c.id])))
      : Promise.resolve(new Map<string, string>()),
    packageNames.length
      ? prisma.package.findMany({ where: { name: { in: packageNames } } })
        .then((ps) => new Map(ps.map((p) => [p.name, p.id])))
      : Promise.resolve(new Map<string, string>()),
  ]);

  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (existingCodes.has(row.batchCode)) { skipped++; continue; }

    // Resolve names → IDs.
    const rowCourseIds: string[] = [];
    let resolveErr: string | null = null;
    for (const n of row.courseNames) {
      const id = coursesByName.get(n);
      if (!id) { resolveErr = `unknown course "${n}"`; break; }
      rowCourseIds.push(id);
    }
    if (resolveErr) { failed.push({ line: i + 1, reason: resolveErr }); continue; }

    const rowPackageIds: string[] = [];
    for (const n of row.packageNames) {
      const id = packagesByName.get(n);
      if (!id) { resolveErr = `unknown package "${n}"`; break; }
      rowPackageIds.push(id);
    }
    if (resolveErr) { failed.push({ line: i + 1, reason: resolveErr }); continue; }

    const courseIds = [...new Set([...rowCourseIds, ...applyCourseIds])];
    const packageIds = [...new Set([...rowPackageIds, ...applyPackageIds])];

    try {
      await prisma.$transaction(async (tx) => {
        const b = await tx.batch.create({
          data: {
            batchCode: row.batchCode,
            batchName: row.batchName,
            description: row.description ?? null,
          },
        });
        if (courseIds.length) {
          await tx.batchCourse.createMany({
            data: courseIds.map((courseId) => ({ batchId: b.id, courseId })),
          });
        }
        if (packageIds.length) {
          await tx.batchPackage.createMany({
            data: packageIds.map((packageId) => ({ batchId: b.id, packageId })),
          });
        }
      });
      created++;
    } catch (e: any) {
      if (e?.code === "P2002") skipped++;
      else if (e?.code === "P2003") failed.push({ line: i + 1, reason: "invalid course/package reference" });
      else failed.push({ line: i + 1, reason: "create failed" });
    }
  }

  await createAuditLog({
    actorId: admin.id, actorEmail: admin.email, actorType: "admin",
    action: "BULK_BATCHES_CREATED", entityType: "Batch",
    newValue: {
      created,
      skipped,
      failedCount: failed.length,
      applyCourseIdsCount: applyCourseIds.length,
      applyPackageIdsCount: applyPackageIds.length,
    },
  });
  revalidatePath("/admin/batches");
  if (created > 0) revalidateTag(CATALOG_TAGS.batches);
  return { ok: true, data: { created, skipped, failed } };
  });
}

// ---------- Bulk add courses ----------

const bulkCoursesArgs = z.object({
  text: z.string().min(1).max(MAX_TEXT_LEN),
});

/**
 * Accepts FormData with `text` and/or `file`. Dedupe within input by name,
 * pre-check DB and skip existing names. Inserts only new courses.
 */
export async function bulkAddCoursesFromForm(
  formData: FormData,
): Promise<R<{ created: number; skipped: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {

  let text = String(formData.get("text") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "file exceeds 5 MB" };
    const t = await file.text();
    text = text ? `${text}\n${t}` : t;
  }
  if (!text.trim()) return { ok: false, error: "no input provided" };

  const parsed = bulkCoursesArgs.safeParse({ text });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { rows: rawRows, errors } = parseBulkCourses(parsed.data.text);
  const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
  let skipped = 0;

  const seen = new Set<string>();
  const rows: typeof rawRows = [];
  for (const r of rawRows) {
    if (seen.has(r.name)) { skipped++; continue; }
    seen.add(r.name);
    rows.push(r);
  }

  const existing = rows.length
    ? await prisma.course.findMany({
        where: { name: { in: rows.map((r) => r.name) } },
        select: { name: true },
      })
    : [];
  const existingNames = new Set(existing.map((c) => c.name));

  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (existingNames.has(row.name)) { skipped++; continue; }
    try {
      await prisma.course.create({
        data: {
          name: row.name,
          description: row.description ?? null,
          status: row.status ?? "active",
        },
      });
      created++;
    } catch (e: any) {
      if (e?.code === "P2002") skipped++;
      else failed.push({ line: i + 1, reason: "create failed" });
    }
  }

  await createAuditLog({
    actorId: admin.id, actorEmail: admin.email, actorType: "admin",
    action: "BULK_COURSES_CREATED", entityType: "Course",
    newValue: { created, skipped, failedCount: failed.length },
  });
  revalidatePath("/admin/courses");
  if (created > 0) revalidateTag(CATALOG_TAGS.courses);
  return { ok: true, data: { created, skipped, failed } };
  });
}

/**
 * Generic bulk action over a set of selected students. Used by /admin/search.
 * Each branch is one transaction-bounded operation per student; we report counts.
 */
export async function bulkAction(
  input: unknown,
): Promise<R<{ count: number; skipped: { studentId: string; reason: string }[] }>> {
  return withAdminD(async (admin) => {
  const parsed = bulkActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;
  const skipped: { studentId: string; reason: string }[] = [];
  let count = 0;
  let auditAction: AuditAction = "BULK_COURSE_REVOKED";

  if (data.action === "revoke_course") {
    const r = await prisma.studentCourse.deleteMany({
      where: { studentId: { in: data.studentIds }, courseId: data.courseId },
    });
    count = r.count;
    auditAction = "BULK_COURSE_REVOKED";
  } else if (data.action === "revoke_package") {
    const r = await prisma.studentPackage.deleteMany({
      where: { studentId: { in: data.studentIds }, packageId: data.packageId },
    });
    count = r.count;
    auditAction = "BULK_PACKAGE_REVOKED";
  } else if (data.action === "deny_course") {
    for (const sid of data.studentIds) {
      try {
        await prisma.studentCourseDenial.upsert({
          where: { studentId_courseId: { studentId: sid, courseId: data.courseId } },
          create: { studentId: sid, courseId: data.courseId, reason: data.reason ?? null },
          update: { reason: data.reason ?? null },
        });
        count++;
      } catch (e: any) {
        skipped.push({
          studentId: sid,
          reason: e?.code === "P2003" ? "missing student/course" : "deny failed",
        });
      }
    }
    auditAction = "BULK_COURSE_DENIED";
  } else if (data.action === "undeny_course") {
    const r = await prisma.studentCourseDenial.deleteMany({
      where: { studentId: { in: data.studentIds }, courseId: data.courseId },
    });
    count = r.count;
    auditAction = "BULK_COURSE_DENIAL_REMOVED";
  } else if (data.action === "block") {
    const r = await prisma.student.updateMany({
      where: { id: { in: data.studentIds } },
      data: { status: "blocked" },
    });
    count = r.count;
    auditAction = "BULK_STUDENTS_BLOCKED";
  } else if (data.action === "activate") {
    const r = await prisma.student.updateMany({
      where: { id: { in: data.studentIds } },
      data: { status: "active" },
    });
    count = r.count;
    auditAction = "BULK_STUDENTS_ACTIVATED";
  } else if (data.action === "set_end_date") {
    const r = await prisma.student.updateMany({
      where: { id: { in: data.studentIds } },
      data: { accessEndDate: data.endDate },
    });
    count = r.count;
    auditAction = "BULK_STUDENTS_END_DATE_CHANGED";
  }

  await createAuditLog({
    actorId: admin.id, actorEmail: admin.email, actorType: "admin",
    action: auditAction, entityType: "Student",
    newValue: { ...data, count, skippedCount: skipped.length },
  });
  revalidatePath("/admin/search");
  revalidatePath("/admin/students");
  return { ok: true, data: { count, skipped } };
  });
}

/**
 * Resolves a paste of student codes/emails to studentIds. Used by the search
 * page's "paste IDs" form before calling bulkAction.
 */
export async function resolveStudentIdentifiers(
  text: string,
): Promise<R<{ studentIds: string[]; unknown: string[] }>> {
  return withAdminD(async () => {
  if (typeof text !== "string" || !text.trim()) return bad("no input");
  const idents = parseIdentifierList(text);
  if (idents.length === 0) return { ok: true, data: { studentIds: [], unknown: [] } };
  const matches = await prisma.student.findMany({
    where: {
      OR: [
        { studentCode: { in: idents } },
        { email: { in: idents.map((i) => i.toLowerCase()) } },
      ],
    },
    select: { id: true, studentCode: true, email: true },
  });
  const byKey = new Map<string, string>();
  for (const s of matches) {
    byKey.set(s.studentCode, s.id);
    byKey.set(s.email.toLowerCase(), s.id);
  }
  const seen = new Set<string>();
  const studentIds: string[] = [];
  const unknown: string[] = [];
  for (const ident of idents) {
    const id = byKey.get(ident) ?? byKey.get(ident.toLowerCase());
    if (!id) unknown.push(ident);
    else if (!seen.has(id)) {
      seen.add(id);
      studentIds.push(id);
    }
  }
  return { ok: true, data: { studentIds, unknown } };
  });
}
