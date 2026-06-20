import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStudent, requireVideoAccess, AuthError } from "@/lib/authorization";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;

  let student;
  try {
    ({ student } = await requireStudent());
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    throw e;
  }
  try {
    await requireVideoAccess(student.id, videoId);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw e;
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true },
  });
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });

  const notes = await prisma.note.findMany({
    where: { videoId, downloadEnabled: true },
    orderBy: { createdAt: "asc" },
  });

  const usedNames = new Map<string, number>();
  const safeName = (raw: string) => {
    let base = raw.replace(/[\\/:*?"<>|]/g, "_").trim() || "note";
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    return count === 0 ? base : `${stem} (${count})${ext}`;
  };

  const archive = archiver("zip", { zlib: { level: 6 } });
  const externalLinks: string[] = [];

  for (const n of notes) {
    if (n.sourceType === "upload" && n.uploadPath) {
      const abs = path.join(process.cwd(), "public", n.uploadPath);
      const filename = safeName(n.originalFileName ?? `${n.title}${path.extname(n.uploadPath)}`);
      try {
        archive.file(abs, { name: filename });
      } catch {
        /* ignore unreadable file */
      }
    } else if (n.sourceType === "url" && n.externalUrl) {
      externalLinks.push(`${n.title}\n  ${n.externalUrl}\n`);
    } else if (n.sourceType === "drive" && n.driveFileId) {
      externalLinks.push(
        `${n.title}\n  https://drive.google.com/uc?id=${n.driveFileId}&export=download\n`,
      );
    }
  }

  if (externalLinks.length) {
    archive.append(
      `External resources for "${video.title}"\n` +
        `These notes live outside the system; open the link to view/download.\n\n` +
        externalLinks.join("\n"),
      { name: "EXTERNAL_LINKS.txt" },
    );
  }

  // Kick off the archive but don't await — we stream as it generates.
  archive.finalize().catch(() => {});

  // Convert the Node stream to a web ReadableStream Next.js can return.
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream;

  const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 64) || "notes";
  return new Response(webStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeTitle}-notes.zip"`,
      "cache-control": "no-store",
    },
  });
}
