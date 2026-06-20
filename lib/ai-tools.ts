/**
 * AI-callable admin tools.
 *
 * Each entry has (a) a Gemini function declaration the model sees, and (b) an
 * `execute` handler that mutates via Prisma + writes an audit log. Handlers
 * are invoked from `actions/ai-chat.ts` AFTER `withAdmin` has verified the
 * session, so they trust the supplied `admin` object and do not re-check auth.
 *
 * Audit marker: every mutating handler tags `newValue.via = "ai-assistant"`
 * so the trail can distinguish AI-driven changes from manual ones.
 *
 * Name-vs-ID resolution: tools accept human-friendly references (batchCode,
 * course name, student email/code) and resolve to IDs server-side. This keeps
 * the model's prompt short — it doesn't have to memorize cuids.
 */

import "server-only";
import type { Admin } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { revalidatePath, revalidateTag } from "next/cache";
import { CATALOG_TAGS } from "@/lib/catalog-cache";
import { z } from "zod";
import type { GeminiToolDeclaration } from "@/lib/gemini";

// ---------- shared helpers ----------

const VIA = "ai-assistant" as const;

function dateOrDefault(input: unknown, fallback: Date): Date {
  if (!input) return fallback;
  const d = input instanceof Date ? input : new Date(String(input));
  return isNaN(d.getTime()) ? fallback : d;
}

function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

function ok<T>(data: T) {
  return { ok: true as const, data };
}
function err(message: string) {
  return { ok: false as const, error: message };
}

/** Resolve a student by id OR studentCode OR email (case-insensitive). */
async function resolveStudent(ref: string) {
  const r = ref.trim();
  if (!r) return null;
  const lower = r.toLowerCase();
  return prisma.student.findFirst({
    where: {
      OR: [
        { id: r },
        { studentCode: r },
        { email: lower },
      ],
    },
  });
}

/** Resolve a batch by id OR batchCode. */
async function resolveBatch(ref: string) {
  const r = ref.trim();
  if (!r) return null;
  return prisma.batch.findFirst({
    where: { OR: [{ id: r }, { batchCode: r }] },
  });
}

/** Resolve a course by id OR exact name. */
async function resolveCourse(ref: string) {
  const r = ref.trim();
  if (!r) return null;
  return prisma.course.findFirst({
    where: { OR: [{ id: r }, { name: r }] },
  });
}

/** Resolve a package by id OR exact name. */
async function resolvePackage(ref: string) {
  const r = ref.trim();
  if (!r) return null;
  return prisma.package.findFirst({
    where: { OR: [{ id: r }, { name: r }] },
  });
}

/** Find existing courses by name OR auto-fail with the missing list. */
async function resolveCourseNames(names: string[]) {
  if (!names.length) return { ids: [] as string[], missing: [] as string[] };
  const found = await prisma.course.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  const map = new Map(found.map((c) => [c.name, c.id]));
  const ids: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const id = map.get(n);
    if (id) ids.push(id);
    else missing.push(n);
  }
  return { ids, missing };
}

async function resolvePackageNames(names: string[]) {
  if (!names.length) return { ids: [] as string[], missing: [] as string[] };
  const found = await prisma.package.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  const map = new Map(found.map((p) => [p.name, p.id]));
  const ids: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const id = map.get(n);
    if (id) ids.push(id);
    else missing.push(n);
  }
  return { ids, missing };
}

/** Generate a unique studentCode like S00042 by counting existing rows. */
async function generateStudentCode(): Promise<string> {
  // Loop until we hit one that doesn't collide. We only ever expect 1 round.
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.student.count();
    const candidate = `S${String(count + 1 + attempt).padStart(5, "0")}`;
    const clash = await prisma.student.findUnique({
      where: { studentCode: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `S${Date.now().toString().slice(-7)}`;
}

/** Find batch by code, create one on the fly if missing. */
async function findOrCreateBatchByCode(
  admin: Admin,
  batchCode: string,
): Promise<{ id: string; created: boolean } | null> {
  const code = batchCode.trim();
  if (!code) return null;
  if (!/^[A-Za-z0-9 _-]+$/.test(code)) return null;
  const existing = await prisma.batch.findUnique({ where: { batchCode: code } });
  if (existing) return { id: existing.id, created: false };
  try {
    const created = await prisma.batch.create({
      data: {
        batchCode: code,
        batchName: code,
        description: "Auto-created by AI assistant",
      },
    });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BATCH_CREATED", entityType: "Batch", entityId: created.id,
      newValue: { batchCode: code, batchName: code, via: VIA, source: "ai-auto" },
    });
    revalidateTag(CATALOG_TAGS.batches);
    revalidatePath("/admin/batches");
    return { id: created.id, created: true };
  } catch {
    // Race: another writer created it. Re-read.
    const again = await prisma.batch.findUnique({ where: { batchCode: code } });
    return again ? { id: again.id, created: false } : null;
  }
}

// ---------- arg validators ----------
// Kept lenient: Gemini sometimes emits strings for booleans/numbers; coerce
// to keep tool calls reliable.

const refStr = z.string().trim().min(1).max(255);
const optStr = z.string().trim().max(2000).optional();

const dateLike = z
  .union([z.string(), z.date()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v instanceof Date ? v : new Date(String(v))))
  .refine((d) => d === undefined || !isNaN(d.getTime()), { message: "invalid date" });

const stringArray = z
  .array(z.string().trim().min(1))
  .optional()
  .default([])
  .transform((arr) => [...new Set(arr)]);

// ---------- tool handlers ----------

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

type Handler = (admin: Admin, raw: unknown) => Promise<ToolResult>;

/**
 * The full tool registry.
 *
 * Adding a tool: append `{ name, description, parameters, execute }`. The
 * registry is exported as-is to be split into Gemini declarations + handler
 * map by the chat action.
 */
export const ADMIN_TOOLS: Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: Handler;
}> = [
  // ---------- READ ----------
  {
    name: "list_students",
    description:
      "List students matching a search query (matches against name, email, or studentCode). Returns up to `limit` results. Optionally filter by batchCode or status.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial match against name/email/studentCode" },
        batchCode: { type: "string" },
        status: { type: "string", enum: ["active", "blocked"] },
        limit: { type: "number", description: "Max rows (default 20, max 100)" },
      },
    },
    async execute(_admin, raw) {
      const parsed = z
        .object({
          query: optStr,
          batchCode: optStr,
          status: z.enum(["active", "blocked"]).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        })
        .safeParse(raw ?? {});
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const { query, batchCode, status, limit } = parsed.data;
      const batch = batchCode ? await prisma.batch.findUnique({ where: { batchCode } }) : null;
      if (batchCode && !batch) return err(`unknown batchCode ${batchCode}`);
      const students = await prisma.student.findMany({
        where: {
          ...(query
            ? {
                OR: [
                  { name: { contains: query } },
                  { email: { contains: query.toLowerCase() } },
                  { studentCode: { contains: query } },
                ],
              }
            : {}),
          ...(batch ? { batchId: batch.id } : {}),
          ...(status ? { status } : {}),
        },
        select: {
          id: true,
          studentCode: true,
          name: true,
          email: true,
          status: true,
          batch: { select: { batchCode: true, batchName: true } },
          accessEndDate: true,
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      });
      return ok({ count: students.length, students });
    },
  },
  {
    name: "get_student",
    description:
      "Fetch full detail for a single student by id, studentCode, or email — includes direct course/package enrollments and denials.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string", description: "id / studentCode / email" } },
      required: ["ref"],
    },
    async execute(_admin, raw) {
      const parsed = z.object({ ref: refStr }).safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const s = await resolveStudent(parsed.data.ref);
      if (!s) return err("student not found");
      const [courses, packages, denials] = await Promise.all([
        prisma.studentCourse.findMany({
          where: { studentId: s.id },
          select: { course: { select: { id: true, name: true } } },
        }),
        prisma.studentPackage.findMany({
          where: { studentId: s.id },
          select: { package: { select: { id: true, name: true } } },
        }),
        prisma.studentCourseDenial.findMany({
          where: { studentId: s.id },
          select: { course: { select: { id: true, name: true } }, reason: true },
        }),
      ]);
      return ok({
        ...s,
        directCourses: courses.map((c) => c.course),
        directPackages: packages.map((p) => p.package),
        deniedCourses: denials.map((d) => ({ ...d.course, reason: d.reason })),
      });
    },
  },
  {
    name: "list_batches",
    description: "List batches. Optionally filter by partial query on batchCode or batchName.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
    async execute(_admin, raw) {
      const parsed = z
        .object({ query: optStr, limit: z.coerce.number().int().min(1).max(200).optional().default(50) })
        .safeParse(raw ?? {});
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const { query, limit } = parsed.data;
      const batches = await prisma.batch.findMany({
        where: query
          ? { OR: [{ batchCode: { contains: query } }, { batchName: { contains: query } }] }
          : undefined,
        select: { id: true, batchCode: true, batchName: true, description: true },
        take: limit,
        orderBy: { batchCode: "asc" },
      });
      return ok({ count: batches.length, batches });
    },
  },
  {
    name: "list_courses",
    description: "List courses. Optionally filter by query/status.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
        limit: { type: "number" },
      },
    },
    async execute(_admin, raw) {
      const parsed = z
        .object({
          query: optStr,
          status: z.enum(["active", "inactive"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        })
        .safeParse(raw ?? {});
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const { query, status, limit } = parsed.data;
      const courses = await prisma.course.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(query ? { name: { contains: query } } : {}),
        },
        select: { id: true, name: true, status: true, layout: true, description: true },
        take: limit,
        orderBy: { name: "asc" },
      });
      return ok({ count: courses.length, courses });
    },
  },
  {
    name: "find_batch_in_text",
    description:
      "Given an arbitrary string (e.g. a raw, separator-less line like 'reshmionlb24' or 'onlb24reshmi'), returns any existing batchCodes that appear as a substring of the text (case-insensitive). Use this BEFORE create_student whenever the admin pastes a value that might contain both a name and a batchCode mashed together. Empty result means no known batch matched — ask the admin where the batch code is, or whether a new one should be created.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Raw line to scan." },
      },
      required: ["text"],
    },
    async execute(_admin, raw) {
      const parsed = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const txtLower = parsed.data.text.toLowerCase();
      const batches = await prisma.batch.findMany({
        select: { id: true, batchCode: true, batchName: true },
      });
      // Substring match in either direction.
      const matches = batches
        .filter((b) => txtLower.includes(b.batchCode.toLowerCase()))
        .map((b) => {
          const idx = txtLower.indexOf(b.batchCode.toLowerCase());
          const remainder = (
            parsed.data.text.slice(0, idx) + parsed.data.text.slice(idx + b.batchCode.length)
          ).trim();
          return {
            batchCode: b.batchCode,
            batchName: b.batchName,
            position: idx === 0 ? "prefix" : idx + b.batchCode.length === parsed.data.text.length ? "suffix" : "middle",
            remainderAfterStrippingBatchCode: remainder,
          };
        })
        // Prefer longest/most-specific match when several batches share prefixes.
        .sort((a, b) => b.batchCode.length - a.batchCode.length);
      return ok({ inputText: parsed.data.text, matches });
    },
  },
  {
    name: "list_packages",
    description: "List packages. Optionally filter by query/status.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
        limit: { type: "number" },
      },
    },
    async execute(_admin, raw) {
      const parsed = z
        .object({
          query: optStr,
          status: z.enum(["active", "inactive"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        })
        .safeParse(raw ?? {});
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const { query, status, limit } = parsed.data;
      const packages = await prisma.package.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(query ? { name: { contains: query } } : {}),
        },
        select: { id: true, name: true, status: true, description: true },
        take: limit,
        orderBy: { name: "asc" },
      });
      return ok({ count: packages.length, packages });
    },
  },
  {
    name: "get_db_summary",
    description: "Quick counts: students, batches, courses, packages, modules, videos.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const [students, batches, courses, packages, modules, videos] = await Promise.all([
        prisma.student.count(),
        prisma.batch.count(),
        prisma.course.count(),
        prisma.package.count(),
        prisma.module.count(),
        prisma.video.count(),
      ]);
      return ok({ students, batches, courses, packages, modules, videos });
    },
  },

  // ---------- STUDENT WRITES ----------
  {
    name: "create_student",
    description:
      "Create a new student. Required: name, email. Optional: studentCode (auto-generated if omitted), batchCode (batch is auto-created if not found), accessStartDate (defaults to today), accessEndDate (defaults to +365 days), courseNames[], packageNames[].",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        studentCode: { type: "string", description: "Optional; auto-generated if omitted" },
        batchCode: { type: "string" },
        accessStartDate: { type: "string", description: "YYYY-MM-DD; defaults to today" },
        accessEndDate: { type: "string", description: "YYYY-MM-DD; defaults to +365d" },
        courseNames: { type: "array", items: { type: "string" } },
        packageNames: { type: "array", items: { type: "string" } },
      },
      required: ["name", "email"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(200),
          email: z.string().trim().toLowerCase().email().max(255),
          studentCode: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]+$/)
            .max(64)
            .optional(),
          batchCode: optStr,
          accessStartDate: dateLike,
          accessEndDate: dateLike,
          courseNames: stringArray,
          packageNames: stringArray,
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const d = parsed.data;

      const today = new Date();
      const startDate = dateOrDefault(d.accessStartDate, today);
      const endDate = dateOrDefault(d.accessEndDate, addDays(today, 365));
      if (endDate < startDate) return err("accessEndDate must be on/after accessStartDate");

      const studentCode = d.studentCode || (await generateStudentCode());

      let batchId: string | null = null;
      if (d.batchCode) {
        const b = await findOrCreateBatchByCode(admin, d.batchCode);
        if (!b) return err(`invalid batchCode "${d.batchCode}"`);
        batchId = b.id;
      }

      const { ids: courseIds, missing: missingCourses } = await resolveCourseNames(d.courseNames);
      if (missingCourses.length) return err(`unknown courses: ${missingCourses.join(", ")}`);
      const { ids: packageIds, missing: missingPackages } = await resolvePackageNames(d.packageNames);
      if (missingPackages.length) return err(`unknown packages: ${missingPackages.join(", ")}`);

      try {
        const student = await prisma.$transaction(async (tx) => {
          const s = await tx.student.create({
            data: {
              studentCode,
              name: d.name,
              email: d.email,
              batchId,
              accessStartDate: startDate,
              accessEndDate: endDate,
            },
          });
          if (courseIds.length)
            await tx.studentCourse.createMany({
              data: courseIds.map((courseId) => ({ studentId: s.id, courseId })),
            });
          if (packageIds.length)
            await tx.studentPackage.createMany({
              data: packageIds.map((packageId) => ({ studentId: s.id, packageId })),
            });
          return s;
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "STUDENT_CREATED", entityType: "Student", entityId: student.id,
          newValue: { ...student, courseIds, packageIds, via: VIA },
        });
        for (const courseId of courseIds) {
          await createAuditLog({
            actorId: admin.id, actorEmail: admin.email, actorType: "admin",
            action: "STUDENT_COURSE_ASSIGNED", entityType: "Student", entityId: student.id,
            newValue: { courseId, via: VIA },
          });
        }
        for (const packageId of packageIds) {
          await createAuditLog({
            actorId: admin.id, actorEmail: admin.email, actorType: "admin",
            action: "STUDENT_PACKAGE_ASSIGNED", entityType: "Student", entityId: student.id,
            newValue: { packageId, via: VIA },
          });
        }
        revalidatePath("/admin/students");
        return ok({ id: student.id, studentCode: student.studentCode });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate email or studentCode");
        if (e?.code === "P2003") return err("invalid reference (batch/course/package)");
        return err("create failed");
      }
    },
  },
  {
    name: "update_student",
    description:
      "Update a student's fields. Identify by id/studentCode/email via `ref`. Pass only the fields to change.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        studentCode: { type: "string" },
        batchCode: { type: "string", description: "Set to empty string to unassign batch" },
        status: { type: "string", enum: ["active", "blocked"] },
        accessStartDate: { type: "string" },
        accessEndDate: { type: "string" },
      },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          ref: refStr,
          name: z.string().trim().min(1).max(200).optional(),
          email: z.string().trim().toLowerCase().email().max(255).optional(),
          studentCode: z.string().trim().regex(/^[A-Za-z0-9_-]+$/).max(64).optional(),
          batchCode: z.string().trim().max(64).optional(),
          status: z.enum(["active", "blocked"]).optional(),
          accessStartDate: dateLike,
          accessEndDate: dateLike,
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const { ref, batchCode, ...rest } = parsed.data;
      const before = await resolveStudent(ref);
      if (!before) return err("student not found");

      let batchId: string | null | undefined = undefined;
      if (batchCode !== undefined) {
        if (batchCode === "") batchId = null;
        else {
          const b = await findOrCreateBatchByCode(admin, batchCode);
          if (!b) return err(`invalid batchCode "${batchCode}"`);
          batchId = b.id;
        }
      }
      try {
        const after = await prisma.student.update({
          where: { id: before.id },
          data: {
            ...(rest.name !== undefined && { name: rest.name }),
            ...(rest.email !== undefined && { email: rest.email }),
            ...(rest.studentCode !== undefined && { studentCode: rest.studentCode }),
            ...(rest.status !== undefined && { status: rest.status }),
            ...(rest.accessStartDate !== undefined && { accessStartDate: rest.accessStartDate }),
            ...(rest.accessEndDate !== undefined && { accessEndDate: rest.accessEndDate }),
            ...(batchId !== undefined && { batchId }),
          },
        });
        const action =
          rest.status === "blocked" && before.status !== "blocked"
            ? "STUDENT_BLOCKED"
            : rest.status === "active" && before.status !== "active"
              ? "STUDENT_ACTIVATED"
              : batchId !== undefined && batchId !== before.batchId
                ? "STUDENT_BATCH_CHANGED"
                : "STUDENT_UPDATED";
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action, entityType: "Student", entityId: before.id,
          oldValue: before, newValue: { ...after, via: VIA },
        });
        revalidatePath("/admin/students");
        revalidatePath(`/admin/students/${before.id}`);
        return ok({ id: before.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate email or studentCode");
        return err("update failed");
      }
    },
  },
  {
    name: "delete_student",
    description: "Permanently delete a student (and cascade enrollments/progress).",
    parameters: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z.object({ ref: refStr }).safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolveStudent(parsed.data.ref);
      if (!before) return err("student not found");
      await prisma.student.delete({ where: { id: before.id } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_DELETED", entityType: "Student", entityId: before.id,
        oldValue: before, newValue: { via: VIA },
      });
      revalidatePath("/admin/students");
      return ok({ id: before.id });
    },
  },

  // ---------- ENROLLMENT (student × course/package) ----------
  {
    name: "enroll_student_course",
    description: "Grant a student direct access to a course.",
    parameters: {
      type: "object",
      properties: { studentRef: { type: "string" }, courseName: { type: "string" } },
      required: ["studentRef", "courseName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({ studentRef: refStr, courseName: refStr })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const [s, c] = await Promise.all([
        resolveStudent(parsed.data.studentRef),
        resolveCourse(parsed.data.courseName),
      ]);
      if (!s) return err("student not found");
      if (!c) return err("course not found");
      try {
        await prisma.studentCourse.create({ data: { studentId: s.id, courseId: c.id } });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "STUDENT_COURSE_ASSIGNED", entityType: "Student", entityId: s.id,
          newValue: { courseId: c.id, via: VIA },
        });
        revalidatePath(`/admin/students/${s.id}`);
        return ok({ studentId: s.id, courseId: c.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("already enrolled");
        return err("enrollment failed");
      }
    },
  },
  {
    name: "enroll_student_package",
    description: "Grant a student direct access to a package.",
    parameters: {
      type: "object",
      properties: { studentRef: { type: "string" }, packageName: { type: "string" } },
      required: ["studentRef", "packageName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({ studentRef: refStr, packageName: refStr })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const [s, p] = await Promise.all([
        resolveStudent(parsed.data.studentRef),
        resolvePackage(parsed.data.packageName),
      ]);
      if (!s) return err("student not found");
      if (!p) return err("package not found");
      try {
        await prisma.studentPackage.create({ data: { studentId: s.id, packageId: p.id } });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "STUDENT_PACKAGE_ASSIGNED", entityType: "Student", entityId: s.id,
          newValue: { packageId: p.id, via: VIA },
        });
        revalidatePath(`/admin/students/${s.id}`);
        return ok({ studentId: s.id, packageId: p.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("already enrolled");
        return err("enrollment failed");
      }
    },
  },
  {
    name: "unenroll_student_course",
    description: "Remove a student's direct course enrollment (does not affect batch/package grants).",
    parameters: {
      type: "object",
      properties: { studentRef: { type: "string" }, courseName: { type: "string" } },
      required: ["studentRef", "courseName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({ studentRef: refStr, courseName: refStr })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const [s, c] = await Promise.all([
        resolveStudent(parsed.data.studentRef),
        resolveCourse(parsed.data.courseName),
      ]);
      if (!s) return err("student not found");
      if (!c) return err("course not found");
      const r = await prisma.studentCourse.deleteMany({
        where: { studentId: s.id, courseId: c.id },
      });
      if (r.count === 0) return err("no direct enrollment to remove");
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_COURSE_REMOVED", entityType: "Student", entityId: s.id,
        oldValue: { courseId: c.id }, newValue: { via: VIA },
      });
      revalidatePath(`/admin/students/${s.id}`);
      return ok({ removed: r.count });
    },
  },
  {
    name: "unenroll_student_package",
    description: "Remove a student's direct package enrollment.",
    parameters: {
      type: "object",
      properties: { studentRef: { type: "string" }, packageName: { type: "string" } },
      required: ["studentRef", "packageName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({ studentRef: refStr, packageName: refStr })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const [s, p] = await Promise.all([
        resolveStudent(parsed.data.studentRef),
        resolvePackage(parsed.data.packageName),
      ]);
      if (!s) return err("student not found");
      if (!p) return err("package not found");
      const r = await prisma.studentPackage.deleteMany({
        where: { studentId: s.id, packageId: p.id },
      });
      if (r.count === 0) return err("no direct enrollment to remove");
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_PACKAGE_REMOVED", entityType: "Student", entityId: s.id,
        oldValue: { packageId: p.id }, newValue: { via: VIA },
      });
      revalidatePath(`/admin/students/${s.id}`);
      return ok({ removed: r.count });
    },
  },
  {
    name: "deny_student_course",
    description:
      "Add a per-student course denial: this student loses access to this course regardless of any package/batch grant.",
    parameters: {
      type: "object",
      properties: {
        studentRef: { type: "string" },
        courseName: { type: "string" },
        reason: { type: "string" },
      },
      required: ["studentRef", "courseName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({ studentRef: refStr, courseName: refStr, reason: optStr })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const [s, c] = await Promise.all([
        resolveStudent(parsed.data.studentRef),
        resolveCourse(parsed.data.courseName),
      ]);
      if (!s) return err("student not found");
      if (!c) return err("course not found");
      await prisma.studentCourseDenial.upsert({
        where: { studentId_courseId: { studentId: s.id, courseId: c.id } },
        create: { studentId: s.id, courseId: c.id, reason: parsed.data.reason ?? null },
        update: { reason: parsed.data.reason ?? null },
      });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_COURSE_DENIED", entityType: "Student", entityId: s.id,
        newValue: { courseId: c.id, reason: parsed.data.reason ?? null, via: VIA },
      });
      revalidatePath(`/admin/students/${s.id}`);
      return ok({ studentId: s.id, courseId: c.id });
    },
  },
  {
    name: "undeny_student_course",
    description: "Remove a course denial (restores access if any grant path applies).",
    parameters: {
      type: "object",
      properties: { studentRef: { type: "string" }, courseName: { type: "string" } },
      required: ["studentRef", "courseName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({ studentRef: refStr, courseName: refStr })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const [s, c] = await Promise.all([
        resolveStudent(parsed.data.studentRef),
        resolveCourse(parsed.data.courseName),
      ]);
      if (!s) return err("student not found");
      if (!c) return err("course not found");
      const r = await prisma.studentCourseDenial.deleteMany({
        where: { studentId: s.id, courseId: c.id },
      });
      if (r.count === 0) return err("no denial to remove");
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_COURSE_DENIAL_REMOVED", entityType: "Student", entityId: s.id,
        oldValue: { courseId: c.id }, newValue: { via: VIA },
      });
      revalidatePath(`/admin/students/${s.id}`);
      return ok({ removed: r.count });
    },
  },

  // ---------- BATCH ----------
  {
    name: "create_batch",
    description: "Create a new batch. Optionally attach courses/packages by name.",
    parameters: {
      type: "object",
      properties: {
        batchCode: { type: "string" },
        batchName: { type: "string" },
        description: { type: "string" },
        courseNames: { type: "array", items: { type: "string" } },
        packageNames: { type: "array", items: { type: "string" } },
      },
      required: ["batchCode", "batchName"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          batchCode: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .regex(/^[A-Za-z0-9 _-]+$/),
          batchName: z.string().trim().min(1).max(200),
          description: optStr,
          courseNames: stringArray,
          packageNames: stringArray,
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const d = parsed.data;
      const { ids: courseIds, missing: mc } = await resolveCourseNames(d.courseNames);
      if (mc.length) return err(`unknown courses: ${mc.join(", ")}`);
      const { ids: packageIds, missing: mp } = await resolvePackageNames(d.packageNames);
      if (mp.length) return err(`unknown packages: ${mp.join(", ")}`);
      try {
        const batch = await prisma.$transaction(async (tx) => {
          const b = await tx.batch.create({
            data: {
              batchCode: d.batchCode,
              batchName: d.batchName,
              description: d.description || null,
            },
          });
          if (courseIds.length)
            await tx.batchCourse.createMany({
              data: courseIds.map((courseId) => ({ batchId: b.id, courseId })),
            });
          if (packageIds.length)
            await tx.batchPackage.createMany({
              data: packageIds.map((packageId) => ({ batchId: b.id, packageId })),
            });
          return b;
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "BATCH_CREATED", entityType: "Batch", entityId: batch.id,
          newValue: { ...batch, courseIds, packageIds, via: VIA },
        });
        revalidateTag(CATALOG_TAGS.batches);
        revalidatePath("/admin/batches");
        return ok({ id: batch.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate batchCode");
        return err("create failed");
      }
    },
  },
  {
    name: "update_batch",
    description: "Update batch fields by id or batchCode.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string" },
        batchCode: { type: "string" },
        batchName: { type: "string" },
        description: { type: "string" },
      },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          ref: refStr,
          batchCode: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9 _-]+$/).optional(),
          batchName: z.string().trim().min(1).max(200).optional(),
          description: optStr,
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolveBatch(parsed.data.ref);
      if (!before) return err("batch not found");
      try {
        const after = await prisma.batch.update({
          where: { id: before.id },
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
          action: "BATCH_UPDATED", entityType: "Batch", entityId: before.id,
          oldValue: before, newValue: { ...after, via: VIA },
        });
        revalidateTag(CATALOG_TAGS.batches);
        revalidatePath("/admin/batches");
        return ok({ id: before.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate batchCode");
        return err("update failed");
      }
    },
  },
  {
    name: "delete_batch",
    description: "Delete a batch. Students in this batch lose their batch-grant access.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z.object({ ref: refStr }).safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolveBatch(parsed.data.ref);
      if (!before) return err("batch not found");
      await prisma.batch.delete({ where: { id: before.id } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_DELETED", entityType: "Batch", entityId: before.id,
        oldValue: before, newValue: { via: VIA },
      });
      revalidateTag(CATALOG_TAGS.batches);
      revalidatePath("/admin/batches");
      return ok({ id: before.id });
    },
  },

  // ---------- COURSE ----------
  {
    name: "create_course",
    description: "Create a course. `layout` is 'module' (default) or 'flat'.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
        layout: { type: "string", enum: ["module", "flat"] },
      },
      required: ["name"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(200),
          description: optStr,
          status: z.enum(["active", "inactive"]).optional().default("active"),
          layout: z.enum(["module", "flat"]).optional().default("module"),
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const d = parsed.data;
      try {
        const c = await prisma.course.create({
          data: {
            name: d.name,
            description: d.description || null,
            status: d.status,
            layout: d.layout,
          },
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "COURSE_CREATED", entityType: "Course", entityId: c.id,
          newValue: { ...c, via: VIA },
        });
        revalidateTag(CATALOG_TAGS.courses);
        revalidatePath("/admin/courses");
        return ok({ id: c.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate course name");
        return err("create failed");
      }
    },
  },
  {
    name: "update_course",
    description: "Update course fields by id or name.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
        layout: { type: "string", enum: ["module", "flat"] },
      },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          ref: refStr,
          name: z.string().trim().min(1).max(200).optional(),
          description: optStr,
          status: z.enum(["active", "inactive"]).optional(),
          layout: z.enum(["module", "flat"]).optional(),
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolveCourse(parsed.data.ref);
      if (!before) return err("course not found");
      try {
        const after = await prisma.course.update({
          where: { id: before.id },
          data: {
            ...(parsed.data.name !== undefined && { name: parsed.data.name }),
            ...(parsed.data.description !== undefined && {
              description: parsed.data.description || null,
            }),
            ...(parsed.data.status !== undefined && { status: parsed.data.status }),
            ...(parsed.data.layout !== undefined && { layout: parsed.data.layout }),
          },
        });
        const action =
          parsed.data.status === "inactive" && before.status !== "inactive"
            ? "COURSE_INACTIVATED"
            : parsed.data.status === "active" && before.status !== "active"
              ? "COURSE_ACTIVATED"
              : "COURSE_UPDATED";
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action, entityType: "Course", entityId: before.id,
          oldValue: before, newValue: { ...after, via: VIA },
        });
        revalidateTag(CATALOG_TAGS.courses);
        revalidatePath("/admin/courses");
        return ok({ id: before.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate course name");
        return err("update failed");
      }
    },
  },
  {
    name: "delete_course",
    description: "Permanently delete a course (cascades modules/videos/notes/enrollments).",
    parameters: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z.object({ ref: refStr }).safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolveCourse(parsed.data.ref);
      if (!before) return err("course not found");
      await prisma.course.delete({ where: { id: before.id } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "COURSE_DELETED", entityType: "Course", entityId: before.id,
        oldValue: before, newValue: { via: VIA },
      });
      revalidateTag(CATALOG_TAGS.courses);
      revalidatePath("/admin/courses");
      return ok({ id: before.id });
    },
  },

  // ---------- PACKAGE ----------
  {
    name: "create_package",
    description: "Create a package. Optionally attach courses by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
        courseNames: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(200),
          description: optStr,
          status: z.enum(["active", "inactive"]).optional().default("active"),
          courseNames: stringArray,
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const d = parsed.data;
      const { ids: courseIds, missing } = await resolveCourseNames(d.courseNames);
      if (missing.length) return err(`unknown courses: ${missing.join(", ")}`);
      try {
        const p = await prisma.$transaction(async (tx) => {
          const created = await tx.package.create({
            data: {
              name: d.name,
              description: d.description || null,
              status: d.status,
            },
          });
          if (courseIds.length)
            await tx.packageCourse.createMany({
              data: courseIds.map((courseId) => ({ packageId: created.id, courseId })),
            });
          return created;
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "PACKAGE_CREATED", entityType: "Package", entityId: p.id,
          newValue: { ...p, courseIds, via: VIA },
        });
        revalidateTag(CATALOG_TAGS.packages);
        revalidatePath("/admin/packages");
        return ok({ id: p.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate package name");
        return err("create failed");
      }
    },
  },
  {
    name: "update_package",
    description: "Update package fields by id or name.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
      },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z
        .object({
          ref: refStr,
          name: z.string().trim().min(1).max(200).optional(),
          description: optStr,
          status: z.enum(["active", "inactive"]).optional(),
        })
        .safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolvePackage(parsed.data.ref);
      if (!before) return err("package not found");
      try {
        const after = await prisma.package.update({
          where: { id: before.id },
          data: {
            ...(parsed.data.name !== undefined && { name: parsed.data.name }),
            ...(parsed.data.description !== undefined && {
              description: parsed.data.description || null,
            }),
            ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          },
        });
        const action =
          parsed.data.status === "inactive" && before.status !== "inactive"
            ? "PACKAGE_INACTIVATED"
            : parsed.data.status === "active" && before.status !== "active"
              ? "PACKAGE_ACTIVATED"
              : "PACKAGE_UPDATED";
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action, entityType: "Package", entityId: before.id,
          oldValue: before, newValue: { ...after, via: VIA },
        });
        revalidateTag(CATALOG_TAGS.packages);
        revalidatePath("/admin/packages");
        return ok({ id: before.id });
      } catch (e: any) {
        if (e?.code === "P2002") return err("duplicate package name");
        return err("update failed");
      }
    },
  },
  {
    name: "delete_package",
    description: "Permanently delete a package (cascades package-course and enrollment links).",
    parameters: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
    async execute(admin, raw) {
      const parsed = z.object({ ref: refStr }).safeParse(raw);
      if (!parsed.success) return err(parsed.error.issues[0].message);
      const before = await resolvePackage(parsed.data.ref);
      if (!before) return err("package not found");
      await prisma.package.delete({ where: { id: before.id } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "PACKAGE_DELETED", entityType: "Package", entityId: before.id,
        oldValue: before, newValue: { via: VIA },
      });
      revalidateTag(CATALOG_TAGS.packages);
      revalidatePath("/admin/packages");
      return ok({ id: before.id });
    },
  },
];

export function getAdminToolDeclarations(): GeminiToolDeclaration[] {
  return ADMIN_TOOLS.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export function getAdminToolHandler(name: string): Handler | null {
  return ADMIN_TOOLS.find((t) => t.name === name)?.execute ?? null;
}
