import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BookOpen, CalendarDays, CheckCircle2, PackageOpen } from "lucide-react";
import { prisma } from "@/lib/db";
import {
  requireStudent,
  requirePackageAccess,
  AuthError,
} from "@/lib/authorization";
import StudentTopbar from "@/components/StudentTopbar";

function monogram(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function tileTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const n = Math.abs(h) % 5;
  return ["violet", "cyan", "rose", "blue", "amber"][n]!;
}

export default async function StudentPackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=denied");
    throw e;
  }
  const { packageId } = await params;

  try {
    await requirePackageAccess(student.id, packageId);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }

  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: {
      packageCourses: {
        where: { course: { status: "active" } },
        include: { course: true },
        orderBy: { course: { name: "asc" } },
      },
    },
  });
  if (!pkg || pkg.status !== "active") notFound();

  // Batched denial lookup — one query for the whole package instead of the
  // previous per-course `await isCourseDenied(...)` loop (N+1).
  const courseIds = pkg.packageCourses.map((pc) => pc.courseId);
  const denials = courseIds.length
    ? await prisma.studentCourseDenial.findMany({
        where: { studentId: student.id, courseId: { in: courseIds } },
        select: { courseId: true },
      })
    : [];
  const deniedSet = new Set(denials.map((d) => d.courseId));
  const visibleCourses = pkg.packageCourses.filter((pc) => !deniedSet.has(pc.courseId));

  // Package-wide progress: total active lessons and how many this student has
  // completed across every visible course (flat OR modular videos).
  const visibleCourseIds = visibleCourses.map((pc) => pc.courseId);
  const videoScope = {
    status: "active" as const,
    OR: [
      { courseId: { in: visibleCourseIds } },
      { module: { courseId: { in: visibleCourseIds } } },
    ],
  };
  const [totalLessons, completedLessons] = visibleCourseIds.length
    ? await Promise.all([
        prisma.video.count({ where: videoScope }),
        prisma.videoProgress.count({
          where: { studentId: student.id, completed: true, video: videoScope },
        }),
      ])
    : [0, 0];
  const completionPct =
    totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const accessStart = student.accessStartDate.toISOString().slice(0, 10);
  const accessUntil = student.accessEndDate.toISOString().slice(0, 10);

  return (
    <div className="sx-shell">
      <StudentTopbar accessUntil={accessUntil} />

      <main className="sx-page" id="main-content">
        <section className="sx-pagehero">
          <div className="sx-pagehero-main">
            <div className="sx-pagehero-top">
              <Link className="sx-back" href="/dashboard">
                <ArrowLeft size={14} aria-hidden="true" />
                Dashboard
              </Link>
              <span className="sx-eyebrow">
                <PackageOpen size={13} aria-hidden="true" />
                Package
              </span>
            </div>
            <h1>{pkg.name}</h1>
            {pkg.description ? <p>{pkg.description}</p> : null}
          </div>
          <div className="sx-pagehero-side">
            <div className="sx-progress">
              <span className="sx-progress-tag">Package overview</span>
              <div className="sx-progress-facts">
                <span className="sx-fact">
                  <BookOpen size={14} aria-hidden="true" />
                  {visibleCourses.length} course{visibleCourses.length === 1 ? "" : "s"}
                </span>
                {totalLessons > 0 ? (
                  <span className="sx-fact">
                    <CheckCircle2 size={14} aria-hidden="true" />
                    {completedLessons}/{totalLessons} done
                  </span>
                ) : null}
              </div>
              {totalLessons > 0 ? (
                <div className="sx-meter">
                  <div className="sx-meter-label">
                    <strong>{completionPct}%</strong> complete
                    <span className="sx-meter-count">
                      {completedLessons}/{totalLessons} lessons
                    </span>
                  </div>
                  <div
                    className="sx-bar"
                    role="progressbar"
                    aria-valuenow={completionPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${completionPct}%` }} />
                  </div>
                </div>
              ) : null}
              <div className="sx-access-note">
                <CalendarDays size={14} aria-hidden="true" />
                <span>
                  Access {accessStart} → <strong>{accessUntil}</strong>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="sx-row" aria-labelledby="pkg-courses">
          <header className="sx-rowhead">
            <div>
              <span className="sx-eyebrow">In this package</span>
              <h2 id="pkg-courses">All courses</h2>
            </div>
            <span className="sx-count">{visibleCourses.length}</span>
          </header>
          {visibleCourses.length === 0 ? (
            <p className="sx-empty-note">
              No courses are available in this package right now.
            </p>
          ) : (
            <div className="sx-grid">
              {visibleCourses.map((pc) => {
                const courseImage = (pc.course as { imageUrl?: string | null }).imageUrl ?? null;
                return (
                  <Link
                    key={pc.id}
                    href={`/courses/${pc.courseId}`}
                    className="sx-tile"
                    data-tone={tileTone(pc.course.name)}
                  >
                    <div className="sx-tile-cover">
                      {courseImage ? (
                        <img
                          src={courseImage}
                          alt=""
                          className="sx-tile-image"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="sx-tile-monogram">{monogram(pc.course.name)}</span>
                      )}
                      <span className="sx-tile-badge">
                        <BookOpen size={10} aria-hidden="true" />
                        Course
                      </span>
                    </div>
                    <div className="sx-tile-body">
                      <span className="sx-tile-title">{pc.course.name}</span>
                      {pc.course.description ? (
                        <p>{pc.course.description}</p>
                      ) : (
                        <span className="sx-tile-meta">Ready to watch</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
