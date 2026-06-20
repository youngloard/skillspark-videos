import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updateVideo, refreshVideoDuration } from "@/actions/videos";
import { createNoteFromForm } from "@/actions/notes";
import { buildDriveViewUrl } from "@/lib/drive";
import ActionForm from "@/components/ActionForm";
import ActionButton from "@/components/ActionButton";
import NoteTable from "@/components/NoteTable";

export default async function VideoEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const v = await prisma.video.findUnique({
    where: { id },
    include: {
      module: { include: { course: true } },
      course: true,
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!v) notFound();

  // Resolve breadcrumb parent. Flat-layout videos point at course directly.
  const parentCourse = v.course ?? v.module?.course;

  const noteRows = v.notes.map((n) => {
    if (n.sourceType === "drive" && n.driveFileId) {
      return { id: n.id, title: n.title, kind: "drive", href: buildDriveViewUrl(n.driveFileId), hrefLabel: "view", downloadEnabled: n.downloadEnabled };
    }
    if (n.sourceType === "url" && n.externalUrl) {
      return { id: n.id, title: n.title, kind: "url", href: n.externalUrl, hrefLabel: "link", downloadEnabled: n.downloadEnabled };
    }
    if (n.sourceType === "upload" && n.uploadPath) {
      return { id: n.id, title: n.title, kind: "upload", href: n.uploadPath, hrefLabel: n.originalFileName ?? "file", downloadEnabled: n.downloadEnabled };
    }
    return { id: n.id, title: n.title, kind: "—", href: null, hrefLabel: "", downloadEnabled: n.downloadEnabled };
  });

  return (
    <div className="wide-canvas">
      <h1>Video: {v.title}</h1>
      <p style={{ color: "var(--muted)", fontWeight: "600", marginBottom: "24px" }}>
        {parentCourse ? (
          <Link href={`/admin/courses/${parentCourse.id}`}>{parentCourse.name}</Link>
        ) : (
          "(orphan)"
        )}
        {v.module ? (
          <>
            {" "}›{" "}
            <Link href={`/admin/modules/${v.moduleId}`}>{v.module.title}</Link>
          </>
        ) : null}
      </p>

      <div id="edit" className="add-student-panel">
        <div className="form-card-header">
          <span>Video Profile Properties</span>
        </div>
        <ActionForm
          className="form-card-body form-vertical"
          successMessage="Video properties saved."
          action={async (fd: FormData) => {
            "use server";
            return updateVideo(id, {
              title: fd.get("title"),
              description: fd.get("description") || "",
              driveFileId: fd.get("driveFileId"),
              status: fd.get("status"),
            });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Video Title
                <input name="title" defaultValue={v.title} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Description
                <input name="description" defaultValue={v.description ?? ""} />
              </label>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Google Drive Link / ID
                <input
                  name="driveFileId"
                  defaultValue={buildDriveViewUrl(v.driveFileId)}
                  required
                />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Status
                <select name="status" defaultValue={v.status}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Save properties</button>
          </div>
        </ActionForm>
      </div>

      <div className="add-student-panel" style={{ marginTop: "24px" }}>
        <div className="form-card-header">
          <span>Refresh Duration</span>
        </div>
        <div className="form-card-body form-vertical">
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            Current Duration: <strong>{v.duration ? `${v.duration}s` : "unknown"}</strong>
            {v.durationFetchedAt
              ? ` (fetched ${v.durationFetchedAt.toISOString().slice(0, 16).replace("T", " ")})`
              : ""}
          </p>
          <div className="form-actions">
            <ActionButton
              action={async () => {
                "use server";
                return refreshVideoDuration(id);
              }}
              successMessage="Duration refreshed from Drive."
            >
              Refresh duration from Drive
            </ActionButton>
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: "36px" }}>Notes ({v.notes.length})</h2>
      <NoteTable notes={noteRows} />

      <div className="add-student-panel" style={{ marginTop: "24px", marginBottom: "48px" }}>
        <div className="form-card-header">
          <span>Add Note</span>
        </div>
        <ActionForm
          className="form-card-body form-vertical"
          successMessage="Note added."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            fd.set("videoId", id);
            return createNoteFromForm(fd);
          }}
        >
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            Choose a source type below, then fill in only the corresponding inputs.
          </p>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Note Title
                <input name="title" placeholder="e.g. Course Handout" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Source Type
                <select name="sourceType" defaultValue="drive">
                  <option value="drive">Drive link</option>
                  <option value="url">External URL (PDF/Doc/etc.)</option>
                  <option value="upload">Upload a file</option>
                </select>
              </label>
            </div>
            <div className="form-field-group" style={{ justifyContent: "center" }}>
              <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px", cursor: "pointer", height: "100%" }}>
                <input type="checkbox" name="downloadEnabled" defaultChecked />
                <span>Allow Student Download</span>
              </label>
            </div>
          </div>

          <fieldset className="picker-fieldset" style={{ marginTop: "12px" }}>
            <legend>Google Drive Link Input</legend>
            <div className="form-field-group">
              <input name="driveInput" placeholder="https://drive.google.com/file/d/.../view  (or ID)" />
            </div>
          </fieldset>

          <fieldset className="picker-fieldset" style={{ marginTop: "12px" }}>
            <legend>External URL Input</legend>
            <div className="form-field-group">
              <input name="externalUrl" placeholder="https://example.com/notes.pdf" />
            </div>
          </fieldset>

          <fieldset className="picker-fieldset" style={{ marginTop: "12px" }}>
            <legend>File Upload Input</legend>
            <div className="form-field-group">
              <input
                type="file"
                name="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt"
              />
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "8px" }}>Max 25 MB limit. Accepts PDF, Office, image, and text files only.</p>
          </fieldset>

          <div className="form-actions">
            <button type="submit">Add note</button>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
