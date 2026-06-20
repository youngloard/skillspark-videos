import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updateModule } from "@/actions/modules";
import { createVideo } from "@/actions/videos";
import ActionForm from "@/components/ActionForm";
import VideoTable from "@/components/VideoTable";

export default async function ModuleEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const mod = await prisma.module.findUnique({
    where: { id },
    include: {
      course: true,
      videos: {
        orderBy: { videoOrder: "asc" },
        include: { _count: { select: { notes: true } } },
      },
    },
  });
  if (!mod) notFound();

  return (
    <div className="wide-canvas">
      <h1>Module: {mod.title}</h1>
      <p style={{ color: "var(--muted)", fontWeight: "600", marginBottom: "24px" }}>
        Course: <Link href={`/admin/courses/${mod.courseId}`}>{mod.course.name}</Link>
      </p>

      <div id="edit" className="add-student-panel">
        <div className="form-card-header">
          <span>Module Profile</span>
        </div>
        <ActionForm
          className="form-card-body form-vertical"
          successMessage="Module profile saved."
          action={async (fd: FormData) => {
            "use server";
            return updateModule(id, {
              title: fd.get("title"),
              description: fd.get("description") || "",
            });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Module Title
                <input name="title" defaultValue={mod.title} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Description
                <input name="description" defaultValue={mod.description ?? ""} />
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Save profile</button>
          </div>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: "36px" }}>Videos in this Module ({mod.videos.length})</h2>
      <VideoTable
        emptyLabel="No videos in this module yet."
        videos={mod.videos.map((v) => ({
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
          className="form-card-body form-vertical"
          successMessage="Video added."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return createVideo({
              moduleId: id,
              title: fd.get("title"),
              description: fd.get("description") || "",
              driveFileId: fd.get("driveFileId"),
              videoOrder: mod.videos.length,
              status: fd.get("status") || "active",
            });
          }}
        >
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            Paste any shared Google Drive file link. The bare file ID is extracted automatically and duration is auto-fetched.
          </p>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Video Title
                <input name="title" placeholder="e.g. Setting up Environment" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Description
                <input name="description" placeholder="Optional brief overview..." />
              </label>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Google Drive Link / ID
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
  );
}
