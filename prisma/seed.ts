import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Root Admin";

function days(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log("[seed] starting");

  const admin = await prisma.admin.upsert({
    where: { email: ADMIN_EMAIL },
    create: { name: ADMIN_NAME, email: ADMIN_EMAIL },
    update: { name: ADMIN_NAME },
  });
  console.log("[seed] admin:", admin.email);

  // Batches
  const batchONLB101 = await prisma.batch.upsert({
    where: { batchCode: "ONLB101" },
    create: { batchCode: "ONLB101", batchName: "Online Batch 101" },
    update: {},
  });
  const batchONLB102 = await prisma.batch.upsert({
    where: { batchCode: "ONLB102" },
    create: { batchCode: "ONLB102", batchName: "Online Batch 102" },
    update: {},
  });

  // Courses
  const courseNames = [
    "Excel",
    "GST",
    "VAT",
    "Accounting",
    "SQL",
    "Python",
    "Power BI Desktop",
    "Power BI Service",
  ];
  const courses = new Map<string, string>();
  for (const name of courseNames) {
    const c = await prisma.course.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    courses.set(name, c.id);
  }

  // Packages
  const adffa = await prisma.package.upsert({
    where: { name: "ADFFA" },
    create: { name: "ADFFA", description: "Accounting/Finance fundamentals" },
    update: {},
  });
  const dataAnalytics = await prisma.package.upsert({
    where: { name: "Data Analytics" },
    create: { name: "Data Analytics" },
    update: {},
  });

  async function linkPackageCourse(packageId: string, courseId: string) {
    await prisma.packageCourse.upsert({
      where: { packageId_courseId: { packageId, courseId } },
      create: { packageId, courseId },
      update: {},
    });
  }

  for (const n of ["GST", "VAT", "Accounting", "Excel"]) {
    await linkPackageCourse(adffa.id, courses.get(n)!);
  }
  for (const n of ["Excel", "SQL", "Python", "Power BI Desktop", "Power BI Service"]) {
    await linkPackageCourse(dataAnalytics.id, courses.get(n)!);
  }

  // Batch assignment: ONLB 101 gets Data Analytics
  await prisma.batchPackage.upsert({
    where: { batchId_packageId: { batchId: batchONLB101.id, packageId: dataAnalytics.id } },
    create: { batchId: batchONLB101.id, packageId: dataAnalytics.id },
    update: {},
  });

  // Sample students
  const studentSpecs: Array<{
    studentCode: string;
    name: string;
    email: string;
    batchId?: string | null;
    direct?: { courseNames?: string[]; packageNames?: string[] };
  }> = [
    {
      studentCode: "S100",
      name: "Adira (ADFFA pkg)",
      email: "adira@example.com",
      direct: { packageNames: ["ADFFA"] },
    },
    {
      studentCode: "S101",
      name: "Eli (Excel only)",
      email: "eli@example.com",
      direct: { courseNames: ["Excel"] },
    },
    {
      studentCode: "S102",
      name: "Pavi (Python+SQL)",
      email: "pavi@example.com",
      direct: { courseNames: ["Python", "SQL"] },
    },
    {
      studentCode: "S103",
      name: "Bina (ONLB101 batch)",
      email: "bina@example.com",
      batchId: batchONLB101.id,
    },
    {
      studentCode: "S104",
      name: "Cy (ONLB102 no access)",
      email: "cy@example.com",
      batchId: batchONLB102.id,
    },
  ];

  for (const spec of studentSpecs) {
    const s = await prisma.student.upsert({
      where: { email: spec.email },
      create: {
        studentCode: spec.studentCode,
        name: spec.name,
        email: spec.email,
        batchId: spec.batchId ?? null,
        accessStartDate: days(-7),
        accessEndDate: days(365),
      },
      update: {
        name: spec.name,
        batchId: spec.batchId ?? null,
        accessStartDate: days(-7),
        accessEndDate: days(365),
      },
    });
    for (const cn of spec.direct?.courseNames ?? []) {
      const cid = courses.get(cn)!;
      await prisma.studentCourse.upsert({
        where: { studentId_courseId: { studentId: s.id, courseId: cid } },
        create: { studentId: s.id, courseId: cid },
        update: {},
      });
    }
    for (const pn of spec.direct?.packageNames ?? []) {
      const pkg = pn === "ADFFA" ? adffa : dataAnalytics;
      await prisma.studentPackage.upsert({
        where: { studentId_packageId: { studentId: s.id, packageId: pkg.id } },
        create: { studentId: s.id, packageId: pkg.id },
        update: {},
      });
    }
  }

  // Sample modules + videos for Excel
  const excelId = courses.get("Excel")!;
  const intro = await prisma.module.upsert({
    where: { id: "seed-mod-excel-intro" },
    create: {
      id: "seed-mod-excel-intro",
      courseId: excelId,
      title: "Excel — Intro",
      moduleOrder: 0,
    },
    update: { title: "Excel — Intro", moduleOrder: 0 },
  });
  const formulas = await prisma.module.upsert({
    where: { id: "seed-mod-excel-formulas" },
    create: {
      id: "seed-mod-excel-formulas",
      courseId: excelId,
      title: "Excel — Formulas",
      moduleOrder: 1,
    },
    update: { title: "Excel — Formulas", moduleOrder: 1 },
  });

  // Two sample videos with placeholder Drive file IDs.
  // duration is left null — auto-filled by Drive API on next save when the key is set.
  const v1 = await prisma.video.upsert({
    where: { id: "seed-vid-excel-1" },
    create: {
      id: "seed-vid-excel-1",
      moduleId: intro.id,
      title: "What is Excel?",
      videoOrder: 0,
      driveFileId: "1A2B3C4D5E6F7G8H9I0J",
    },
    update: {},
  });
  await prisma.video.upsert({
    where: { id: "seed-vid-excel-2" },
    create: {
      id: "seed-vid-excel-2",
      moduleId: formulas.id,
      title: "VLOOKUP basics",
      videoOrder: 0,
      driveFileId: "0K1L2M3N4O5P6Q7R8S9T",
    },
    update: {},
  });

  // Sample note — external URL form (download disabled by default).
  await prisma.note.upsert({
    where: { id: "seed-note-1" },
    create: {
      id: "seed-note-1",
      videoId: v1.id,
      title: "Intro slides (PDF)",
      sourceType: "url",
      externalUrl: "https://example.com/files/excel-intro.pdf",
      downloadEnabled: false,
    },
    update: {},
  });

  console.log("[seed] done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
