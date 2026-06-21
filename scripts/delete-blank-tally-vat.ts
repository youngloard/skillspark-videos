/**
 * Deletes the blank duplicate "Tally Vat" course (0 videos, 0 students). Guarded:
 * it re-checks the course is genuinely empty before deleting, so it can never
 * remove the real course that holds the videos + enrolled students.
 *   npx tsx scripts/delete-blank-tally-vat.ts          # dry run
 *   npx tsx scripts/delete-blank-tally-vat.ts --commit
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const COMMIT = process.argv.includes("--commit");
const BLANK_ID = "cmqm0un5p0037t06frinjz6em"; // "Tally Vat" — the empty duplicate

const prisma = new PrismaClient();
(async () => {
  const c = await prisma.course.findUnique({
    where: { id: BLANK_ID },
    include: {
      _count: { select: { modules: true, videos: true, studentCourses: true, batchCourses: true, packageCourses: true, studentDenials: true } },
      modules: { include: { _count: { select: { videos: true } } } },
    },
  });
  if (!c) { console.log("Already gone — nothing to delete."); await prisma.$disconnect(); return; }

  const moduleVideos = c.modules.reduce((s, mm) => s + mm._count.videos, 0);
  const totalVideos = c._count.videos + moduleVideos;
  const refs = c._count.studentCourses + c._count.batchCourses + c._count.packageCourses + c._count.studentDenials;
  console.log(`Target: "${c.name}" (${c.id})  videos=${totalVideos}  enrollments/links=${refs}`);

  // Safety guard: refuse to delete anything that has content or references.
  if (c.name !== "Tally Vat" || totalVideos > 0 || refs > 0) {
    console.error("REFUSING: course is not the empty 'Tally Vat' duplicate. Aborting.");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!COMMIT) {
    console.log("\nDRY RUN — safe to delete. Re-run with --commit to remove it.");
    await prisma.$disconnect();
    return;
  }

  await prisma.course.delete({ where: { id: BLANK_ID } });
  await prisma.auditLog.create({
    data: {
      actorType: "system", actorEmail: process.env.SEED_ADMIN_EMAIL ?? null,
      action: "COURSE_DELETED", entityType: "Course", entityId: BLANK_ID,
      oldValue: JSON.stringify({ id: c.id, name: c.name, status: c.status, reason: "blank duplicate of 'Tally VAT'", source: "cleanup-script" }),
    },
  });
  console.log("\nDeleted blank 'Tally Vat'. Audit log written.");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
