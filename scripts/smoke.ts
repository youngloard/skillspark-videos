/**
 * End-to-end smoke test against demo data. Exercises:
 *   - Catalog reads (courses, packages, batches)
 *   - Per-student dashboard composition (the merge of direct/batch grants)
 *   - canAccessCourse for a few representative paths
 *   - Audit log integrity (presence of recent rows)
 *
 * Run with: npx tsx scripts/smoke.ts
 */

import { PrismaClient } from "@prisma/client";
import {
  getDashboard,
  canAccessCourse,
  getAccessibleCourses,
  getStudentsWithCourseAccess,
} from "../lib/course-access";

const prisma = new PrismaClient();

let failed = 0;
let passed = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}${detail ? `\n   ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("\n— smoke test —\n");

  // 1. Catalog
  const [courses, packages, batches, students, videos] = await Promise.all([
    prisma.course.findMany({ where: { status: "active" } }),
    prisma.package.findMany({ where: { status: "active" } }),
    prisma.batch.findMany(),
    prisma.student.findMany(),
    prisma.video.findMany({ where: { status: "active" } }),
  ]);
  assert("courses present", courses.length >= 5, `${courses.length} courses`);
  assert("packages present", packages.length >= 2, `${packages.length} packages`);
  assert("batches present", batches.length >= 2, `${batches.length} batches`);
  assert("students present", students.length >= 5, `${students.length} students`);
  assert("videos present", videos.length >= 2, `${videos.length} videos`);

  const courseByName = new Map(courses.map((c) => [c.name, c.id]));
  const studentByEmail = new Map(students.map((s) => [s.email, s]));

  // 2. Per-student dashboards
  const adira = studentByEmail.get("adira@example.com");
  if (adira) {
    const d = await getDashboard(adira.id);
    const hasAdffa = d.packages.some((p) => p.name === "ADFFA");
    assert("Adira sees ADFFA package", hasAdffa);

    // Compute the expected accessible count: ADFFA's active courses minus
    // any course-level denials Adira has. This proves the deny→count math
    // is consistent regardless of test fixture drift.
    const adffa = await prisma.package.findUnique({
      where: { name: "ADFFA" },
      include: {
        packageCourses: {
          where: { course: { status: "active" } },
          select: { courseId: true },
        },
      },
    });
    const denials = await prisma.studentCourseDenial.findMany({
      where: { studentId: adira.id },
      select: { courseId: true },
    });
    const denied = new Set(denials.map((d) => d.courseId));
    const expected = adffa?.packageCourses.filter((pc) => !denied.has(pc.courseId)).length ?? 0;
    const got = d.packages.find((p) => p.name === "ADFFA")?.accessibleCourseCount;
    assert(
      `Adira's ADFFA accessible-count matches (active-courses − denials) = ${expected}`,
      got === expected,
      `got ${got}`,
    );
  } else {
    console.warn("Adira not found — skipping");
  }

  const eli = studentByEmail.get("eli@example.com");
  if (eli) {
    const d = await getDashboard(eli.id);
    // Eli has direct Excel only
    assert("Eli sees Excel as individual course", d.individualCourses.some((c) => c.name === "Excel"));
    assert("Eli has no packages", d.packages.length === 0);
  }

  const pavi = studentByEmail.get("pavi@example.com");
  if (pavi) {
    const d = await getDashboard(pavi.id);
    const names = d.individualCourses.map((c) => c.name).sort();
    assert("Pavi sees Python and SQL only", JSON.stringify(names) === JSON.stringify(["Python", "SQL"]));
  }

  const bina = studentByEmail.get("bina@example.com");
  if (bina) {
    const d = await getDashboard(bina.id);
    // Bina is in ONLB101, which has Data Analytics package
    const hasDA = d.packages.some((p) => p.name === "Data Analytics");
    assert("Bina sees Data Analytics package via batch", hasDA);
  }

  const cy = studentByEmail.get("cy@example.com");
  if (cy) {
    const d = await getDashboard(cy.id);
    // Cy is in ONLB102 which has nothing assigned
    assert("Cy has no packages or courses", d.packages.length === 0 && d.individualCourses.length === 0);
  }

  // 3. canAccessCourse — direct & cross-grant scenarios
  if (eli && courseByName.get("Excel")) {
    const can = await canAccessCourse(eli.id, courseByName.get("Excel")!);
    assert("Eli can access Excel", can);
  }
  if (eli && courseByName.get("SQL")) {
    const can = await canAccessCourse(eli.id, courseByName.get("SQL")!);
    assert("Eli cannot access SQL (no grant)", !can);
  }
  if (bina && courseByName.get("Excel")) {
    const can = await canAccessCourse(bina.id, courseByName.get("Excel")!);
    assert("Bina can access Excel via batch→package", can);
  }

  // 4. Reverse lookup
  if (courseByName.get("Excel")) {
    const ids = await getStudentsWithCourseAccess(courseByName.get("Excel")!);
    assert(
      "Excel reverse-lookup returns Eli, Adira, Bina (≥3)",
      ids.length >= 3,
      `got ${ids.length}`,
    );
  }

  // 5. Audit logs
  const auditCount = await prisma.auditLog.count();
  assert("audit table has rows (login + admin events)", auditCount > 0, `${auditCount} rows`);
  const recent = await prisma.auditLog.findMany({
    take: 3,
    orderBy: { createdAt: "desc" },
    select: { action: true, actorEmail: true, entityType: true },
  });
  if (recent.length) {
    console.log("   recent audit:", recent.map((r) => r.action).join(", "));
  }

  // 6. getAccessibleCourses sanity — list size matches dashboard's package count
  if (adira) {
    const d = await getDashboard(adira.id);
    const expected = d.packages.reduce((s, p) => s + p.accessibleCourseCount, 0);
    const list = await getAccessibleCourses(adira.id);
    assert(
      `Adira's accessible-course list matches dashboard sum = ${expected}`,
      list.length === expected,
      `got ${list.length}`,
    );
  }

  console.log(`\n— ${passed} passed, ${failed} failed —\n`);
  process.exit(failed ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
