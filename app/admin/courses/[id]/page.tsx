import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updateCourse, deleteCourse } from "@/actions/courses";
import { createModule } from "@/actions/modules";
import { createVideo } from "@/actions/videos";
import ActionForm from "@/components/ActionForm";
import ActionButton from "@/components/ActionButton";
import ModuleTable from "@/components/ModuleTable";
import VideoTable from "@/components/VideoTable";

export default async function CourseEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      modules: {
        orderBy: { moduleOrder: "asc" },
        include: { _count: { select: { videos: true } } },
      },
      videos: {
        where: { courseId: id }, // direct videos only (flat layout)
        orderBy: { videoOrder: "asc" },
        include: { _count: { select: { notes: true } } },
      },
      _count: { select: { modules: true, videos: true } },
    },
  });
  if (!course) notFound();
  const hasContent = course._count.modules > 0 || course._count.videos > 0;

  return (
    <div className="wide-canvas">
      <h1>Course: {course.name}</h1>
      <p style={{ color: "var(--muted)", fontWeight: "600", marginBottom: "20px" }}>
        Layout: <strong style={{ textTransform: "uppercase", color: "var(--gk-dark)" }}>{course.layout}</strong>
      </p>

      <div id="edit" className="add-student-panel">
        <div className="form-card-header">
          <span>Course Profile</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Course profile saved."
          action={async (fd: FormData) => {
            "use server";
            return updateCourse(id, {
              name: fd.get("name"),
              description: fd.get("description") || "",
              status: fd.get("status"),
              layout: fd.get("layout"),
            });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Course Name
                <input name="name" defaultValue={course.name} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Short Description
                <input name="description" defaultValue={course.description ?? ""} />
              </label>
            </div>
          </div>
          <div className="form-grid" style={{ marginTop: "12px" }}>
            <div className="form-field-group">
              <label>
                Status
                <select name="status" defaultValue={course.status}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Navigation Layout
                <select name="layout" defaultValue={course.layout} disabled={hasContent}>
                  <option value="module">module-based</option>
                  <option value="flat">flat (no modules)</option>
                </select>
              </label>
            </div>
          </div>
          {hasContent && (
            <p style={{ marginTop: "12px", color: "var(--muted)", fontSize: "0.85rem", fontWeight: "600" }}>
              * Layout is locked because this course currently has content (delete modules/videos to change layout).
            </p>
          )}
          <div className="form-actions">
            <button type="submit">Save profile</button>
          </div>
        </ActionForm>
      </div>

      {course.layout === "module" ? (
        <div style={{ marginTop: "32px" }}>
          <h2>Modules</h2>
          <ModuleTable
            modules={course.modules.map((m) => ({
              id: m.id,
              title: m.title,
              videoCount: m._count.videos,
            }))}
          />
          <div className="add-student-panel" style={{ marginTop: "24px" }}>
            <div className="form-card-header">
              <span>Add Module</span>
            </div>
            <ActionForm
              className="form-card-body"
              successMessage="Module added."
              resetOnSuccess
              action={async (fd: FormData) => {
                "use server";
                return createModule({
                  courseId: id,
                  title: fd.get("title"),
                  description: fd.get("description") || "",
                  moduleOrder: course.modules.length,
                });
              }}
            >
              <div className="form-grid">
                <div className="form-field-group">
                  <label>
                    Module Title
                    <input name="title" placeholder="e.g. Introduction to React" required />
                  </label>
                </div>
                <div className="form-field-group">
                  <label>
                    Description
                    <input name="description" placeholder="Optional brief overview..." />
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <button type="submit">Add module</button>
              </div>
            </ActionForm>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "32px" }}>
          <h2>Videos</h2>
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            This is a flat-layout course — videos sit directly on the course layout without module groups.
          </p>
          <VideoTable
            videos={course.videos.map((v) => ({
              id: v.id,
              title: v.title,
              status: v.status,
              duration: v.duration,
              notesCount: v._count.notes,
            }))}
          />
          <div className="add-student-panel" style={{ marginTop: "24px" }}>
            <div className="form-card-header">
              <span>Add Video</span>
            </div>
            <ActionForm
              className="form-card-body"
              successMessage="Video added."
              resetOnSuccess
              action={async (fd: FormData) => {
                "use server";
                return createVideo({
                  courseId: id,
                  title: fd.get("title"),
                  description: fd.get("description") || "",
                  driveFileId: fd.get("driveFileId"),
                  videoOrder: course.videos.length,
                  status: fd.get("status") || "active",
                });
              }}
            >
              <div className="form-grid">
                <div className="form-field-group">
                  <label>
                    Video Title
                    <input name="title" placeholder="e.g. Getting Started" required />
                  </label>
                </div>
                <div className="form-field-group">
                  <label>
                    Description
                    <input name="description" placeholder="Optional video overview..." />
                  </label>
                </div>
              </div>
              <div className="form-grid" style={{ marginTop: "12px" }}>
                <div className="form-field-group">
                  <label>
                    Google Drive Link or File ID
                    <input
                      name="driveFileId"
                      placeholder="https://drive.google.com/file/d/.../view  (or ID)"
                      required
                    />
                  </label>
                </div>
                <div className="form-field-group">
                  <label>
                    Status
                    <select name="status" defaultValue="active">
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <button type="submit">Add video</button>
              </div>
            </ActionForm>
          </div>
        </div>
      )}

      <div className="danger-zone-box">
        <h2>Danger zone</h2>
        <p style={{ color: "#7f1d1d", fontWeight: "600", marginBottom: "16px" }}>
          Deleting this course will remove all its modules, notes, and references. Students enrolled in batches or packages containing this course will lose access.
        </p>
        <ActionButton
          action={async () => {
            "use server";
            return deleteCourse(id);
          }}
          successMessage={`Deleted “${course.name}”.`}
          confirm={`Delete “${course.name}”? This cannot be undone.`}
          redirectTo="/admin/courses"
        >
          Delete course
        </ActionButton>
      </div>
    </div>
  );
}
