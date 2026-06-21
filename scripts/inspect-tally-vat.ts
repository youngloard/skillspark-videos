/** Read-only: inspect the duplicate Tally VAT courses. npx tsx scripts/inspect-tally-vat.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const prisma = new PrismaClient();
(async () => {
  const courses = await prisma.course.findMany({
    where: { name: { in: ["Tally Vat", "Tally VAT", "Tally vat", "TALLY VAT"] } },
    include: {
      _count: {
        select: {
          modules: true,
          videos: true,
          studentCourses: true,
          batchCourses: true,
          packageCourses: true,
          studentDenials: true,
        },
      },
      modules: { include: { _count: { select: { videos: true } } } },
    },
  });

  for (const c of courses) {
    const moduleVideos = c.modules.reduce((s, mm) => s + mm._count.videos, 0);
    const totalVideos = c._count.videos + moduleVideos;
    console.log(`\nCourse "${c.name}"  id=${c.id}`);
    console.log(`  status=${c.status} layout=${c.layout} createdAt=${c.createdAt.toISOString().slice(0, 10)}`);
    console.log(`  modules=${c._count.modules}  flatVideos=${c._count.videos}  moduleVideos=${moduleVideos}  TOTAL VIDEOS=${totalVideos}`);
    console.log(`  studentCourses=${c._count.studentCourses}  batchCourses=${c._count.batchCourses}  packageCourses=${c._count.packageCourses}  denials=${c._count.studentDenials}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
