/** Read-only: confirm the Drive import landed. npx tsx scripts/verify-import.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const prisma = new PrismaClient();
(async () => {
  const [students, ssStudents, enrollments] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { studentCode: { startsWith: "SS" } } }),
    prisma.studentCourse.count(),
  ]);
  console.log(`Total students:        ${students}`);
  console.log(`Imported (SS-codes):   ${ssStudents}`);
  console.log(`Total enrollments:     ${enrollments}`);
  const top = await prisma.course.findMany({
    select: { name: true, _count: { select: { studentCourses: true } } },
    orderBy: { studentCourses: { _count: "desc" } },
    take: 8,
  });
  console.log("\nTop courses by direct enrollment:");
  top.forEach((c) => console.log(`  ${String(c._count.studentCourses).padStart(4)}  ${c.name}`));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
