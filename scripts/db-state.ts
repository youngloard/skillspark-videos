/* Reports current counts of the rows that the wipe will touch (directly or
 * via cascade). Run before the destructive script. */
import { prisma } from "../lib/db";

async function main() {
  const [
    courses,
    packages,
    batches,
    students,
    studentCourses,
    studentPackages,
    batchCourses,
    batchPackages,
    packageCourses,
    studentCourseDenials,
    modules,
    videos,
    notes,
    videoProgress,
  ] = await Promise.all([
    prisma.course.count(),
    prisma.package.count(),
    prisma.batch.count(),
    prisma.student.count(),
    prisma.studentCourse.count(),
    prisma.studentPackage.count(),
    prisma.batchCourse.count(),
    prisma.batchPackage.count(),
    prisma.packageCourse.count(),
    prisma.studentCourseDenial.count(),
    prisma.module.count(),
    prisma.video.count(),
    prisma.note.count(),
    prisma.videoProgress.count(),
  ]);
  console.log("Current row counts:");
  console.table({
    courses,
    packages,
    batches,
    students,
    studentCourses,
    studentPackages,
    batchCourses,
    batchPackages,
    packageCourses,
    studentCourseDenials,
    modules,
    videos,
    notes,
    videoProgress,
  });
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
