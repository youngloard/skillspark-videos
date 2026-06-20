import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Layers3,
  Play,
  PlayCircle,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudent, requireCourseAccess, AuthError } from "@/lib/authorization";
import StudentTopbar from "@/components/StudentTopbar";
import CollapsibleModule from "@/components/CollapsibleModule";

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=denied");
    throw e;
  }
  const { courseId } = await params;
  try {
    await requireCourseAccess(student.id, courseId);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        orderBy: { moduleOrder: "asc" },
        include: {
          videos: {
            where: { status: "active" },
            orderBy: { videoOrder: "asc" },
            select: { id: true, title: true, duration: true },
          },
        },
      },
      videos: {
        where: { status: "active", courseId },
        orderBy: { videoOrder: "asc" },
        select: { id: true, title: true, duration: true },
      },
    },
  });
  if (!course || course.status !== "active") notFound();

  // Collect all video IDs in this course (flat or modular)
  const allVideoIds: string[] =
    course.layout === "flat"
      ? course.videos.map((v) => v.id)
      : course.modules.flatMap((m) => m.videos.map((v) => v.id));

  const progressRows = allVideoIds.length
    ? await prisma.videoProgress.findMany({
        where: { studentId: student.id, videoId: { in: allVideoIds } },
        select: { videoId: true, lastTimestamp: true, completed: true },
      })
    : [];
  const progressMap = new Map(progressRows.map((p) => [p.videoId, p]));

  const totalVideos = allVideoIds.length;
  const totalSeconds =
    course.layout === "flat"
      ? course.videos.reduce((s, v) => s + (v.duration ?? 0), 0)
      : course.modules.reduce(
          (sum, m) => sum + m.videos.reduce((s, v) => s + (v.duration ?? 0), 0),
          0,
        );
  const completedCount = progressRows.filter((p) => p.completed).length;
  const completionPct = totalVideos > 0 ? Math.round((completedCount / totalVideos) * 100) : 0;

  // First unfinished video, in playback order — used for "Continue here" pill.
  const orderedVideos: { id: string; duration: number | null }[] =
    course.layout === "flat"
      ? course.videos
      : course.modules.flatMap((m) => m.videos);
  const continueId = orderedVideos.find((v) => !progressMap.get(v.id)?.completed)?.id ?? null;

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
                {course.layout === "flat" ? (
                  <PlayCircle size={13} aria-hidden="true" />
                ) : (
                  <Layers3 size={13} aria-hidden="true" />
                )}
                {course.layout === "flat" ? "Course" : `${course.modules.length} modules`}
              </span>
            </div>
            <h1>{course.name}</h1>
            {course.description ? <p>{course.description}</p> : null}
          </div>
          <div className="sx-pagehero-side">
            <div className="sx-progress">
              <span className="sx-progress-tag">Course progress</span>
              <div className="sx-progress-facts">
                <span className="sx-fact">
                  <PlayCircle size={14} aria-hidden="true" />
                  {totalVideos} lesson{totalVideos === 1 ? "" : "s"}
                </span>
                {formatDuration(totalSeconds) ? (
                  <span className="sx-fact">
                    <Clock size={14} aria-hidden="true" />
                    {formatDuration(totalSeconds)}
                  </span>
                ) : null}
              </div>
              {totalVideos > 0 && (
                <div className="sx-meter">
                  <div className="sx-meter-label">
                    <strong>{completionPct}%</strong> complete
                    <span className="sx-meter-count">
                      {completedCount}/{totalVideos} lessons
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
              )}
            </div>
          </div>
        </section>

        {course.layout === "flat" ? (
          course.videos.length === 0 ? (
            <section className="sx-row">
              <p className="sx-empty-note">No videos yet.</p>
            </section>
          ) : (
            <section className="sx-row">
              <header className="sx-rowhead">
                <div>
                  <span className="sx-eyebrow">Lessons</span>
                  <h2>All lessons</h2>
                </div>
                <span className="sx-count">{course.videos.length}</span>
              </header>
              <ol className="sx-lessons">
                {course.videos.map((video, index) => (
                  <LessonRow
                    key={video.id}
                    video={video}
                    index={index}
                    progress={progressMap.get(video.id) ?? null}
                    isContinue={video.id === continueId}
                  />
                ))}
              </ol>
            </section>
          )
        ) : (
          course.modules.map((module, moduleIndex) => {
            const moduleCompleted =
              module.videos.length > 0 &&
              module.videos.every((v) => progressMap.get(v.id)?.completed);
            // Default-open the module that holds the "Continue here" lesson;
            // if nothing is in progress, default-open the first module. Every
            // other module starts collapsed so the page lands tight and the
            // student's eye goes straight to where they left off.
            const containsContinue = continueId
              ? module.videos.some((v) => v.id === continueId)
              : moduleIndex === 0;
            return (
              <CollapsibleModule
                key={module.id}
                index={moduleIndex}
                title={module.title}
                description={module.description}
                lessonCount={module.videos.length}
                completed={moduleCompleted}
                defaultOpen={containsContinue && !moduleCompleted}
              >
                {module.videos.length === 0 ? (
                  <p className="sx-empty-note">No videos in this module.</p>
                ) : (
                  <ol className="sx-lessons">
                    {module.videos.map((video, index) => (
                      <LessonRow
                        key={video.id}
                        video={video}
                        index={index}
                        progress={progressMap.get(video.id) ?? null}
                        isContinue={video.id === continueId}
                      />
                    ))}
                  </ol>
                )}
              </CollapsibleModule>
            );
          })
        )}
      </main>
    </div>
  );
}

function formatDuration(s: number) {
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

type Progress = { videoId: string; lastTimestamp: number; completed: boolean };

function LessonRow({
  video,
  index,
  progress,
  isContinue,
}: {
  video: { id: string; title: string; duration: number | null };
  index: number;
  progress: Progress | null;
  isContinue: boolean;
}) {
  const completed = progress?.completed === true;
  const ratio =
    completed
      ? 1
      : progress && video.duration && video.duration > 0
        ? Math.min(1, progress.lastTimestamp / video.duration)
        : 0;
  const showContinue = isContinue && !completed;
  const inProgress = !completed && ratio > 0.02;

  return (
    <li>
      <Link
        href={`/videos/${video.id}`}
        className="sx-lesson"
        data-completed={completed ? "true" : undefined}
        data-continue={showContinue ? "true" : undefined}
      >
        <span className="sx-lesson-disc" aria-hidden="true">
          <ProgressRing progress={ratio} completed={completed} />
          <span className="sx-lesson-play">
            {completed ? (
              <Check size={14} strokeWidth={2.8} />
            ) : (
              <Play size={12} strokeWidth={2.4} fill="currentColor" />
            )}
          </span>
        </span>
        <span className="sx-lesson-num">{String(index + 1).padStart(2, "0")}</span>
        <span className="sx-lesson-titles">
          <span className="sx-lesson-title">{video.title}</span>
          {showContinue ? (
            <span className="sx-pill sx-pill--continue">Continue here</span>
          ) : completed ? (
            <span className="sx-pill sx-pill--done">Completed</span>
          ) : inProgress ? (
            <span className="sx-pill sx-pill--progress">
              {Math.round(ratio * 100)}% watched
            </span>
          ) : null}
        </span>
        <span className="sx-lesson-dur">
          <Clock size={12} aria-hidden="true" />
          {formatDuration(video.duration ?? 0) ?? "—"}
        </span>
        <ChevronRight size={16} aria-hidden="true" className="sx-lesson-arrow" />
      </Link>
    </li>
  );
}

function ProgressRing({ progress, completed }: { progress: number; completed: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <svg
      className="sx-ring"
      viewBox="0 0 40 40"
      width={40}
      height={40}
      aria-hidden="true"
    >
      <circle
        className="sx-ring-track"
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="2"
      />
      <circle
        className="sx-ring-arc"
        data-complete={completed ? "true" : undefined}
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}
