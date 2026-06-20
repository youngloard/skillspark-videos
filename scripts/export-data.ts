/* Dumps every table from the dev SQLite DB to a single JSON file so it can be
 * re-imported into Postgres. Order-independent (import handles ordering). */
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/db";

async function main() {
  const dump = {
    user: await prisma.user.findMany(),
    account: await prisma.account.findMany(),
    session: await prisma.session.findMany(),
    verificationToken: await prisma.verificationToken.findMany(),
    admin: await prisma.admin.findMany(),
    batch: await prisma.batch.findMany(),
    package: await prisma.package.findMany(),
    course: await prisma.course.findMany(),
    student: await prisma.student.findMany(),
    module: await prisma.module.findMany(),
    video: await prisma.video.findMany(),
    note: await prisma.note.findMany(),
    packageCourse: await prisma.packageCourse.findMany(),
    studentPackage: await prisma.studentPackage.findMany(),
    studentCourse: await prisma.studentCourse.findMany(),
    batchPackage: await prisma.batchPackage.findMany(),
    batchCourse: await prisma.batchCourse.findMany(),
    studentCourseDenial: await prisma.studentCourseDenial.findMany(),
    videoProgress: await prisma.videoProgress.findMany(),
    auditLog: await prisma.auditLog.findMany(),
  };
  writeFileSync("scripts/data-dump.json", JSON.stringify(dump, null, 2));
  const counts = Object.fromEntries(
    Object.entries(dump).map(([k, v]) => [k, (v as unknown[]).length]),
  );
  console.log("Exported rows:");
  console.table(counts);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
