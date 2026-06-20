/* Adds videos directly to a flat-layout course from a Drive subfolder.
 * Lists the folder, sorts files by the numeric sequence embedded in the
 * filename, cleans the title, and inserts Video rows (courseId set).
 *
 * Usage: tsx --env-file=.env scripts/add-course-videos.ts <courseId> <driveFolderId> [titlePrefixToStrip]
 */
import { prisma } from "../lib/db";
import { getDriveAccessToken } from "../lib/drive-auth";
import { createAuditLog } from "../lib/audit-log";

const API = "https://www.googleapis.com/drive/v3/files";

async function listFolder(folderId: string, token: string) {
  const files: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(API);
    url.searchParams.set("q", `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,videoMediaMetadata)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const json = await res.json();
    files.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}

/** Strip resolution tags "(720p)", dup markers "(1)", and ".mp4" runs. */
function stripNoise(name: string): string {
  return name
    .replace(/\.mp4/gi, "")
    .replace(/\(\d+p\)/gi, "")   // (720p), (1080p)
    .replace(/\(\d+\)/g, "");    // duplicate markers (1), (2)
}

/** Normalized identity for dedup: same logical video regardless of res/dup tag. */
function dedupKey(name: string): string {
  return stripNoise(name).replace(/[\s_]+/g, " ").trim().toLowerCase();
}

/** Numeric tuple from a (noise-stripped) filename, e.g. "..._10_10_3_..." -> [10,10,3]. */
function numKey(name: string): number[] {
  return (stripNoise(name).match(/\d+/g) ?? []).map(Number);
}

function cmpNumKey(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

function cleanTitle(name: string, prefix: string): string {
  let t = stripNoise(name);                          // drop ext + res/dup tags
  if (prefix && t.startsWith(prefix)) t = t.slice(prefix.length);
  t = t.replace(/^[\d_\s.\-]+/, "");                 // drop leading numbering
  t = t.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);     // capitalize first letter only
}

async function main() {
  const [courseId, folderId, prefix = ""] = process.argv.slice(2);
  if (!courseId || !folderId) throw new Error("usage: <courseId> <driveFolderId> [titlePrefixToStrip]");

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { _count: { select: { videos: true, modules: true } } },
  });
  if (!course) throw new Error(`course ${courseId} not found`);
  if (course._count.videos > 0)
    throw new Error(`course "${course.name}" already has ${course._count.videos} videos; aborting to avoid duplicates`);
  if (course._count.modules > 0)
    throw new Error(`course "${course.name}" has ${course._count.modules} modules; refusing to flip layout`);
  if (course.layout !== "flat") {
    await prisma.course.update({ where: { id: courseId }, data: { layout: "flat" } });
    console.log(`Flipped "${course.name}" from layout=${course.layout} to flat.`);
  }

  const token = await getDriveAccessToken();
  if (!token) throw new Error("no Drive token");

  const raw = await listFolder(folderId, token);
  // Dedup the "(720p) (1)" duplicate uploads, keeping the first seen.
  const seen = new Set<string>();
  const files = raw.filter((f) => {
    const k = dedupKey(f.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  files.sort((a, b) => cmpNumKey(numKey(a.name), numKey(b.name)));
  if (files.length < raw.length) console.log(`Deduped ${raw.length - files.length} duplicate file(s).`);

  const admin = await prisma.admin.findFirst({ where: { status: "active" } });

  console.log(`Adding ${files.length} videos to "${course.name}":`);
  let order = 0;
  for (const f of files) {
    const title = cleanTitle(f.name, prefix);
    const ms = f.videoMediaMetadata?.durationMillis;
    const duration = ms != null && Number.isFinite(Number(ms)) ? Math.round(Number(ms) / 1000) : null;
    const v = await prisma.video.create({
      data: {
        courseId,
        title,
        driveFileId: f.id,
        videoOrder: order,
        status: "active",
        duration,
        durationFetchedAt: duration != null ? new Date() : null,
      },
    });
    await createAuditLog({
      actorId: admin?.id, actorEmail: admin?.email, actorType: "admin",
      action: "VIDEO_CREATED", entityType: "Video", entityId: v.id, newValue: v,
    });
    console.log(`  ${String(order).padStart(2, "0")}  ${title}  (${duration ?? "?"}s)`);
    order++;
  }
  console.log(`Done. ${order} videos added.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
