/**
 * Import students + course enrollments from the Google Drive "videos" folder.
 *
 * Model: under the shared `videos` folder, each subfolder is a course. Every
 * person granted **view (reader) access** to a course folder is a student of
 * that course. Staff/admins hold writer/owner roles and are ignored. A student
 * who appears in several folders is one student enrolled in several courses.
 *
 * SAFETY: dry-run by default — it prints exactly what it WOULD do and writes
 * nothing. Re-run with `--commit` to apply. Idempotent: existing students and
 * existing enrollments are skipped, so committing twice is safe.
 *
 *   npx tsx scripts/import-from-drive.ts                 # dry run (read-only)
 *   npx tsx scripts/import-from-drive.ts --start=2026-06-21 --end=2027-06-21
 *   npx tsx scripts/import-from-drive.ts --commit --start=... --end=...
 *   npx tsx scripts/import-from-drive.ts --create-courses --commit  # also create missing courses
 *
 * Flags:
 *   --commit            actually write to the DB (default: dry run)
 *   --start=YYYY-MM-DD  access start date for NEW students (default: today)
 *   --end=YYYY-MM-DD    access end date for NEW students   (default: today + 1 year)
 *   --create-courses    create a Course row for any folder with no DB match
 *   --code-prefix=SS    studentCode prefix for generated codes (default: SS)
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// ---------- env ----------
function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// ---------- args ----------
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const CREATE_COURSES = args.includes("--create-courses");
const flag = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const CODE_PREFIX = flag("code-prefix") || "SS";

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad date: ${s}`);
  return d;
}
const today = new Date();
const ACCESS_START = parseDate(flag("start"), new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
const ACCESS_END = parseDate(
  flag("end"),
  new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate())),
);
if (ACCESS_END < ACCESS_START) throw new Error("--end is before --start");

// ---------- drive ----------
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function getToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing");
  const sa = JSON.parse(raw);
  const privateKey = String(sa.private_key).replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const jwt = `${header}.${claims}.${base64url(signer.sign(privateKey))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type DriveFile = { id: string; name: string };
async function driveList(token: string, q: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("fields", "nextPageToken,files(id,name)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("corpora", "allDrives");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`files.list ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

type Permission = { type: string; role: string; emailAddress?: string; displayName?: string };
async function listUserPermissions(token: string, fileId: string): Promise<Permission[]> {
  const out: Permission[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`);
    url.searchParams.set("fields", "nextPageToken,permissions(type,role,emailAddress,displayName)");
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("supportsAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`permissions.list ${res.status} on ${fileId}: ${await res.text()}`);
    const json = (await res.json()) as { permissions?: Permission[]; nextPageToken?: string };
    out.push(...(json.permissions ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out.filter((p) => p.type === "user" && p.emailAddress);
}

const FOLDER = "application/vnd.google-apps.folder";

// Normalize a name for matching folder→course (case/space-insensitive).
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Some Drive folder names don't equal their DB course name 1:1. Map the folder
// to the canonical EXISTING course so we enroll into it instead of creating a
// duplicate (CLAUDE rule 4: one Course row per real course). Keys are normalized
// folder names; values are the exact existing Course.name.
const COURSE_ALIASES: Record<string, string> = {
  "sap mm": "SAP MM / SAP Sourcing and Procurement",
  "sap s/4hana fico": "SAP S/4HANA (FICO)",
  "data visualization and reporting using power bi": "Power BI",
};

function deriveName(email: string, displayName?: string): string {
  const dn = displayName?.trim();
  // displayName is often just the email prefix; only trust it if it looks like
  // a real name (has a space) or differs from the local part.
  const local = email.split("@")[0];
  if (dn && dn.toLowerCase() !== local.toLowerCase()) return dn;
  // Fallback: titlecase the local part, splitting on . _ -
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || email;
}

async function main() {
  console.log(`\n=== Drive → LMS student import ${COMMIT ? "(COMMIT)" : "(DRY RUN — no writes)"} ===`);
  console.log(`Access window for NEW students: ${ACCESS_START.toISOString().slice(0, 10)} → ${ACCESS_END.toISOString().slice(0, 10)}`);

  const token = await getToken();
  const videosFolders = await driveList(token, `name = 'videos' and mimeType = '${FOLDER}' and trashed = false`);
  if (videosFolders.length === 0) throw new Error('No "videos" folder visible to the service account.');
  const videosFolder = videosFolders[0];
  console.log(`\nvideos folder: "${videosFolder.name}" (${videosFolder.id})`);

  const courseFolders = await driveList(token, `'${videosFolder.id}' in parents and mimeType = '${FOLDER}' and trashed = false`);
  console.log(`Course folders: ${courseFolders.length}`);

  // First pass: collect every folder's user permissions, and build a global
  // STAFF set = anyone who is a writer/owner on ANY folder. Staff sometimes also
  // hold view-only access on other folders, so this global rule keeps them out
  // of the student list no matter where they appear.
  const folderPerms = new Map<string, Permission[]>();
  const staffEmails = new Map<string, string>(); // email → role seen
  for (const f of courseFolders) {
    const perms = await listUserPermissions(token, f.id);
    folderPerms.set(f.id, perms);
    for (const p of perms) {
      if (p.role === "writer" || p.role === "owner" || p.role === "organizer" || p.role === "fileOrganizer") {
        staffEmails.set(p.emailAddress!.trim().toLowerCase(), p.role);
      }
    }
  }

  // email → { name, courseFolderNames: Set }
  type Acc = { email: string; name: string; folders: Set<string> };
  const byEmail = new Map<string, Acc>();
  const perFolderCounts: { folder: string; readers: number }[] = [];
  const excludedStaff = new Set<string>();

  for (const f of courseFolders) {
    const perms = folderPerms.get(f.id) ?? [];
    let readerCount = 0;
    for (const p of perms) {
      if (p.role !== "reader" && p.role !== "commenter") continue;
      const email = p.emailAddress!.trim().toLowerCase();
      if (staffEmails.has(email)) {
        excludedStaff.add(email);
        continue; // staff with view access elsewhere — not a student
      }
      readerCount++;
      let acc = byEmail.get(email);
      if (!acc) {
        acc = { email, name: deriveName(email, p.displayName), folders: new Set() };
        byEmail.set(email, acc);
      }
      acc.folders.add(f.name);
    }
    perFolderCounts.push({ folder: f.name, readers: readerCount });
  }

  console.log("\nStudents (view-only, staff excluded) per course folder:");
  perFolderCounts.forEach((c) => console.log(`  ${String(c.readers).padStart(3)}  ${c.folder}`));
  console.log(`\nUnique student emails across all folders: ${byEmail.size}`);
  console.log(`Staff accounts excluded (writer/owner somewhere): ${staffEmails.size}`);
  if (excludedStaff.size) {
    console.log("  Excluded staff who also had view access on some folders:");
    [...excludedStaff].forEach((e) => console.log(`    - ${e}`));
  }

  // ---------- DB matching (read-only) ----------
  const prisma = new PrismaClient();
  try {
    const courses = await prisma.course.findMany({ select: { id: true, name: true, status: true } });
    const courseByNorm = new Map(courses.map((c) => [norm(c.name), c]));
    console.log(`\nDB courses (${courses.length}): ${courses.map((c) => c.name).join(" | ")}`);

    // Match folder → course
    const folderToCourse = new Map<string, { id: string; name: string } | null>();
    const unmatchedFolders: string[] = [];
    for (const f of courseFolders) {
      const aliasTarget = COURSE_ALIASES[norm(f.name)];
      const match =
        courseByNorm.get(norm(f.name)) ??
        (aliasTarget ? courseByNorm.get(norm(aliasTarget)) : undefined) ??
        null;
      folderToCourse.set(f.name, match);
      if (!match) unmatchedFolders.push(f.name);
    }

    console.log("\nFolder → Course match:");
    for (const f of courseFolders) {
      const c = folderToCourse.get(f.name);
      console.log(`  ${c ? "✓" : "✗"} ${f.name}${c ? "" : "   (no DB course)"}`);
    }

    // Existing students by email
    const emails = [...byEmail.keys()];
    const existingStudents = emails.length
      ? await prisma.student.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true, studentCode: true },
        })
      : [];
    const existingByEmail = new Map(existingStudents.map((s) => [s.email.toLowerCase(), s]));

    // Existing enrollments for existing students (to skip duplicates)
    const existingIds = existingStudents.map((s) => s.id);
    const existingEnroll = existingIds.length
      ? await prisma.studentCourse.findMany({
          where: { studentId: { in: existingIds } },
          select: { studentId: true, courseId: true },
        })
      : [];
    const enrollSet = new Set(existingEnroll.map((e) => `${e.studentId}:${e.courseId}`));

    // Build the plan
    let newStudentCount = 0;
    let newEnrollForNew = 0;
    let newEnrollForExisting = 0;
    let studentsWithNoMatchedCourse = 0;
    const planNew: { email: string; name: string; courses: string[] }[] = [];
    const planExisting: { email: string; addCourses: string[] }[] = [];

    for (const acc of byEmail.values()) {
      const matchedCourses = [...acc.folders]
        .map((fn) => folderToCourse.get(fn))
        .filter((c): c is { id: string; name: string } => !!c);
      const existing = existingByEmail.get(acc.email);
      if (!existing) {
        newStudentCount++;
        newEnrollForNew += matchedCourses.length;
        if (matchedCourses.length === 0) studentsWithNoMatchedCourse++;
        planNew.push({ email: acc.email, name: acc.name, courses: matchedCourses.map((c) => c.name) });
      } else {
        const toAdd = matchedCourses.filter((c) => !enrollSet.has(`${existing.id}:${c.id}`));
        if (toAdd.length) {
          newEnrollForExisting += toAdd.length;
          planExisting.push({ email: acc.email, addCourses: toAdd.map((c) => c.name) });
        }
      }
    }

    console.log("\n================= PLAN =================");
    console.log(`New students to create:        ${newStudentCount}`);
    console.log(`  └ course enrollments:        ${newEnrollForNew}`);
    console.log(`Existing students to update:   ${planExisting.length}`);
    console.log(`  └ new enrollments to add:    ${newEnrollForExisting}`);
    console.log(`Already existing students:     ${existingStudents.length}`);
    if (unmatchedFolders.length)
      console.log(`Unmatched course folders:      ${unmatchedFolders.length}  → ${unmatchedFolders.join(", ")}${CREATE_COURSES ? "  (will be created)" : "  (pass --create-courses to create)"}`);
    if (studentsWithNoMatchedCourse)
      console.log(`New students with 0 matched courses (still created): ${studentsWithNoMatchedCourse}`);

    if (planNew.length) {
      console.log("\nSample of NEW students (first 15):");
      planNew.slice(0, 15).forEach((p) =>
        console.log(`  ${p.email.padEnd(34)} ${p.name.padEnd(22)} → ${p.courses.join(", ") || "(no matched course)"}`),
      );
    }
    if (planExisting.length) {
      console.log("\nExisting students gaining enrollments (first 15):");
      planExisting.slice(0, 15).forEach((p) => console.log(`  ${p.email.padEnd(34)} += ${p.addCourses.join(", ")}`));
    }

    if (!COMMIT) {
      console.log("\nDRY RUN complete. Nothing was written. Re-run with --commit to apply.\n");
      return;
    }

    // =========================================================
    // COMMIT
    // =========================================================
    console.log("\nCommitting…");

    // Optionally create missing courses first, then re-resolve.
    if (CREATE_COURSES && unmatchedFolders.length) {
      for (const fn of unmatchedFolders) {
        const c = await prisma.course.create({ data: { name: fn, status: "active" } });
        courseByNorm.set(norm(fn), { id: c.id, name: c.name, status: c.status });
        folderToCourse.set(fn, { id: c.id, name: c.name });
        await prisma.auditLog.create({
          data: { actorType: "system", actorEmail: process.env.SEED_ADMIN_EMAIL ?? null,
            action: "COURSE_CREATED", entityType: "Course", entityId: c.id,
            newValue: JSON.stringify({ name: fn, source: "drive-import" }) },
        });
      }
      console.log(`  Created ${unmatchedFolders.length} course(s).`);
    }

    // Reserve unique studentCodes.
    const allCodes = new Set((await prisma.student.findMany({ select: { studentCode: true } })).map((s) => s.studentCode));
    let counter = 1;
    const nextCode = (): string => {
      let code: string;
      do {
        code = `${CODE_PREFIX}${String(counter).padStart(4, "0")}`;
        counter++;
      } while (allCodes.has(code));
      allCodes.add(code);
      return code;
    };

    let created = 0;
    let enrolledNew = 0;
    let enrolledExisting = 0;
    const createdDetail: { email: string; courses: string[] }[] = [];

    for (const acc of byEmail.values()) {
      const matchedCourses = [...acc.folders]
        .map((fn) => folderToCourse.get(fn))
        .filter((c): c is { id: string; name: string } => !!c);
      const existing = existingByEmail.get(acc.email);

      if (!existing) {
        try {
          const code = nextCode();
          await prisma.$transaction(async (tx) => {
            const s = await tx.student.create({
              data: {
                studentCode: code,
                name: acc.name,
                email: acc.email,
                status: "active",
                accessStartDate: ACCESS_START,
                accessEndDate: ACCESS_END,
              },
            });
            if (matchedCourses.length) {
              await tx.studentCourse.createMany({
                data: matchedCourses.map((c) => ({ studentId: s.id, courseId: c.id })),
                skipDuplicates: true,
              });
            }
            await tx.auditLog.create({
              data: { actorType: "system", actorEmail: process.env.SEED_ADMIN_EMAIL ?? null,
                action: "STUDENT_CREATED", entityType: "Student", entityId: s.id,
                newValue: JSON.stringify({ studentCode: code, email: acc.email, name: acc.name,
                  courses: matchedCourses.map((c) => c.name), source: "drive-import" }) },
            });
          });
          created++;
          enrolledNew += matchedCourses.length;
          createdDetail.push({ email: acc.email, courses: matchedCourses.map((c) => c.name) });
        } catch (e: any) {
          if (e?.code === "P2002") console.warn(`  skip (already exists, race): ${acc.email}`);
          else console.error(`  FAILED ${acc.email}: ${e?.message ?? e}`);
        }
      } else {
        const toAdd = matchedCourses.filter((c) => !enrollSet.has(`${existing.id}:${c.id}`));
        if (toAdd.length) {
          const r = await prisma.studentCourse.createMany({
            data: toAdd.map((c) => ({ studentId: existing.id, courseId: c.id })),
            skipDuplicates: true,
          });
          enrolledExisting += r.count;
        }
      }
    }

    // Summary audit logs (mirrors the bulk-import convention).
    await prisma.auditLog.create({
      data: { actorType: "system", actorEmail: process.env.SEED_ADMIN_EMAIL ?? null,
        action: "BULK_STUDENTS_CREATED", entityType: "Student",
        newValue: JSON.stringify({ created, source: "drive-import",
          accessStart: ACCESS_START.toISOString().slice(0, 10), accessEnd: ACCESS_END.toISOString().slice(0, 10) }) },
    });
    await prisma.auditLog.create({
      data: { actorType: "system", actorEmail: process.env.SEED_ADMIN_EMAIL ?? null,
        action: "BULK_ENROLLMENT_CREATED", entityType: "Course",
        newValue: JSON.stringify({ enrolledNew, enrolledExisting, source: "drive-import" }) },
    });

    console.log("\n================ COMMITTED ================");
    console.log(`Students created:            ${created}`);
    console.log(`Enrollments (new students):  ${enrolledNew}`);
    console.log(`Enrollments (existing):      ${enrolledExisting}`);
    console.log("Done.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nIMPORT FAILED:", e?.message ?? e);
  process.exit(1);
});
