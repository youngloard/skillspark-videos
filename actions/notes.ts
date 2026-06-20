"use server";

import path from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { noteSchema, idSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

const UPLOAD_DIR_REL = "public/uploads/notes";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Map<string, string>([
  ["application/pdf", ".pdf"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.ms-powerpoint", ".ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["text/plain", ".txt"],
]);

async function saveUpload(
  file: File,
): Promise<
  | { uploadPath: string; mimeType: string; originalFileName: string }
  | { error: string }
> {
  if (file.size === 0) return { error: "empty file" };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "file exceeds 25 MB" };
  const ext = ALLOWED_MIME.get(file.type);
  if (!ext) return { error: `unsupported MIME type: ${file.type}` };
  const id = randomBytes(16).toString("hex");
  const fileName = `${id}${ext}`;
  const dir = path.join(process.cwd(), UPLOAD_DIR_REL);
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(fullPath, buf);
  return {
    uploadPath: `/uploads/notes/${fileName}`,
    mimeType: file.type,
    originalFileName: file.name,
  };
}

/**
 * Accepts FormData. The form's `sourceType` selector picks which other fields apply.
 * - drive: `driveInput` (any Drive URL or bare ID)
 * - url:   `externalUrl` (https URL)
 * - upload: `file` (File via multipart upload)
 */
export async function createNoteFromForm(formData: FormData): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const sourceType = String(formData.get("sourceType") ?? "");
    const videoId = String(formData.get("videoId") ?? "");
    const title = String(formData.get("title") ?? "");
    const downloadEnabled = formData.get("downloadEnabled") === "on";

    if (!videoId) return bad("videoId required");
    if (!title) return bad("title required");

    if (sourceType === "drive") {
      const driveInput = String(formData.get("driveInput") ?? "");
      const parsed = noteSchema.safeParse({
        sourceType: "drive",
        videoId, title, downloadEnabled, driveInput,
      });
      if (!parsed.success) return bad(parsed.error.issues[0].message);
      const data = parsed.data;
      if (data.sourceType !== "drive") return bad("invalid source");
      try {
        const n = await prisma.note.create({
          data: {
            videoId,
            title,
            sourceType: "drive",
            driveFileId: data.driveInput,
            downloadEnabled,
          },
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "NOTE_CREATED", entityType: "Note", entityId: n.id, newValue: n,
        });
        revalidatePath(`/admin/videos/${videoId}`);
        return { ok: true, data: { id: n.id } };
      } catch (e: any) {
        if (e?.code === "P2003") return bad("video not found");
        return bad("create failed");
      }
    }

    if (sourceType === "url") {
      const externalUrl = String(formData.get("externalUrl") ?? "");
      const parsed = noteSchema.safeParse({
        sourceType: "url",
        videoId, title, downloadEnabled, externalUrl,
      });
      if (!parsed.success) return bad(parsed.error.issues[0].message);
      const data = parsed.data;
      if (data.sourceType !== "url") return bad("invalid source");
      try {
        const n = await prisma.note.create({
          data: {
            videoId,
            title,
            sourceType: "url",
            externalUrl: data.externalUrl,
            downloadEnabled,
          },
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "NOTE_CREATED", entityType: "Note", entityId: n.id, newValue: n,
        });
        revalidatePath(`/admin/videos/${videoId}`);
        return { ok: true, data: { id: n.id } };
      } catch (e: any) {
        if (e?.code === "P2003") return bad("video not found");
        return bad("create failed");
      }
    }

    if (sourceType === "upload") {
      const file = formData.get("file");
      if (!(file instanceof File)) return bad("file required");
      const saved = await saveUpload(file);
      if ("error" in saved) return bad(saved.error);
      try {
        const n = await prisma.note.create({
          data: {
            videoId,
            title,
            sourceType: "upload",
            uploadPath: saved.uploadPath,
            mimeType: saved.mimeType,
            originalFileName: saved.originalFileName,
            downloadEnabled,
          },
        });
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "NOTE_CREATED", entityType: "Note", entityId: n.id,
          newValue: { ...n, uploadPath: saved.uploadPath, originalFileName: saved.originalFileName },
        });
        revalidatePath(`/admin/videos/${videoId}`);
        return { ok: true, data: { id: n.id } };
      } catch (e: any) {
        // Try to clean up the orphan upload.
        await unlink(path.join(process.cwd(), "public", saved.uploadPath)).catch(() => {});
        if (e?.code === "P2003") return bad("video not found");
        return bad("create failed");
      }
    }

    return bad("invalid sourceType");
  });
}

export async function setNoteDownload(noteId: string, downloadEnabled: boolean): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(noteId).success) return bad("invalid id");
    const before = await prisma.note.findUnique({ where: { id: noteId } });
    if (!before) return bad("not found");
    if (before.downloadEnabled === downloadEnabled) return { ok: true };
    const after = await prisma.note.update({
      where: { id: noteId },
      data: { downloadEnabled },
    });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: downloadEnabled ? "NOTE_DOWNLOAD_ENABLED" : "NOTE_DOWNLOAD_DISABLED",
      entityType: "Note", entityId: noteId,
      oldValue: { downloadEnabled: before.downloadEnabled },
      newValue: { downloadEnabled: after.downloadEnabled },
    });
    revalidatePath(`/admin/videos/${after.videoId}`);
    return { ok: true };
  });
}

export async function updateNoteTitle(noteId: string, title: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(noteId).success) return bad("invalid id");
    const t = title.trim();
    if (!t || t.length > 200) return bad("invalid title");
    const before = await prisma.note.findUnique({ where: { id: noteId } });
    if (!before) return bad("not found");
    const after = await prisma.note.update({ where: { id: noteId }, data: { title: t } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "NOTE_UPDATED", entityType: "Note", entityId: noteId,
      oldValue: { title: before.title }, newValue: { title: after.title },
    });
    revalidatePath(`/admin/videos/${after.videoId}`);
    return { ok: true };
  });
}

export async function deleteNote(noteId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(noteId).success) return bad("invalid id");
    const before = await prisma.note.findUnique({ where: { id: noteId } });
    if (!before) return bad("not found");
    await prisma.note.delete({ where: { id: noteId } });
    // Best-effort cleanup of uploaded blob.
    if (before.sourceType === "upload" && before.uploadPath) {
      await unlink(path.join(process.cwd(), "public", before.uploadPath)).catch(() => {});
    }
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "NOTE_DELETED", entityType: "Note", entityId: noteId, oldValue: before,
    });
    revalidatePath(`/admin/videos/${before.videoId}`);
    return { ok: true };
  });
}
