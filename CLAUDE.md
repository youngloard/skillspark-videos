# LMS V1 — Project Notes

A logic-first Learning Management System. **This is V1.** The mission is correctness, security, and architecture — not UI polish. Read `idea.md` for the full spec.

## Golden rules

1. **No styling work.** Plain HTML elements only — `<form>`, `<input>`, `<table>`, `<button>`, `<a>`. No Tailwind, no CSS frameworks, no animations, no icons. Browser default styling is the goal.
2. **Authorization is server-side, every time.** Never trust the client. Every server action and route handler that touches data calls a helper from `lib/authorization.ts` first.
3. **Object-level access.** A student visiting `/courses/5` must pass `canAccessCourse(studentId, 5)`. URL-guessing must return 403/404, not data.
4. **Don't duplicate courses.** One `Course` row per real course (e.g., one "Excel"). Access is granted via four paths: direct course, direct package, batch course, batch package. `getAccessibleCourses` deduplicates.
5. **Course denial is a hard block.** A `StudentCourseDenial` row hides one course from one student no matter how many grant paths exist. `canAccessCourse` checks the denial table first; admins use it to remove a single course from someone who got it via a package or batch without removing the package/batch itself.
6. **Audit important mutations.** Every admin write that matters (CRUD on students/batches/packages/courses/modules/videos/notes/enrollments/denials, plus auth denials) calls `createAuditLog`. See `idea.md` §18 for the full action list — and the new `STUDENT_COURSE_DENIED`, `BULK_*` actions in `lib/audit-log.ts`.
7. **Video security is honest.** Browser-playable video can always be screen-captured. Goal is access control + no overt download button — not DRM. Architecture stays pluggable so we can swap Drive for Vimeo/Mux/signed URLs later.
8. **Drive ID is canonical.** Admins paste any Drive URL shape; `lib/drive.ts > parseDriveFileId` extracts the bare ID and that's all the DB stores. Render code derives embed/download URLs via `buildDriveEmbedUrl` / `buildDriveDownloadUrl`. Never store full URLs.
9. **Video duration is auto-fetched.** `lib/drive.ts > fetchDriveVideoMetadata` calls the Drive API (`GOOGLE_DRIVE_API_KEY`) and patches `Video.duration`. Files must be shared "anyone with link". Fire-and-forget; never blocks save.

## Stack

- Next.js 15 (App Router) + TypeScript
- Prisma + SQLite (`file:./dev.db`)
- NextAuth v5 (Auth.js) with Google OAuth — Prisma adapter
- Zod for input validation
- Server Actions for mutations
- No UI library

## Layout

```
/app          — App Router pages (admin/, login/, dashboard/, courses/, videos/)
/lib          — auth, db, authorization, validations, course-access, video-provider, audit-log, drive (URL parser + Drive API)
/actions      — Server Actions, one file per entity (notes use FormData for uploads; bulk has CSV upload + bulkAction)
/components   — BasicForm, BasicTable (only what's actually shared)
/prisma       — schema.prisma + seed.ts
```

Business logic stays in `lib/`. Server Actions in `actions/` are thin: validate (Zod) → authorize (lib/authorization) → mutate (lib/db) → audit (lib/audit-log) → revalidate.

## Access model (the core invariant)

A student can access a course if **all** of the following hold:

- No `StudentCourseDenial` row exists for `(studentId, courseId)`. (denial wins, always)
- AND **any** of the following four grant paths is true:
  1. `student_courses` has `(studentId, courseId)` — direct course
  2. `student_packages` has `(studentId, packageId)` AND `package_courses` has `(packageId, courseId)` — direct package
  3. Student's `batchId` is in `batch_courses` for `courseId` — batch course
  4. Student's `batchId` is in `batch_packages` for some `packageId` AND that package contains `courseId` — batch package
- AND student is `active`, `accessStartDate <= now <= accessEndDate`, course is `active`. Module/video access inherits from course access (and the entity's own `active` status).

`getStudentsWithCourseAccess(courseId)` is the inverse and must include all four paths. Admin search relies on it.

## Auth flow

Google OAuth → callback receives email → resolve as `Admin` (active) **or** `Student` (active, not expired). If neither, deny and write `LOGIN_DENIED_UNREGISTERED_EMAIL` audit log. Session carries `{ role: "admin" | "student", id }`.

## Don't do

- Don't add UI libraries, icons, charts, theme systems, or layout polish.
- Don't put authorization checks in client components — server only.
- Don't expose `driveFileId` to students who can't access the video.
- Don't offer a download button for videos. Notes can be downloadable only if `note.downloadEnabled`.
- Don't mass-assign Prisma `data: req.body` — pick fields explicitly.
- Don't `cascade` delete on things with audit history; prefer status flags.

## Build order

Follow `idea.md` §22. Schema → auth → authz helpers → admin CRUD (batches → students → courses → packages → mappings → enrollment) → access functions → student dashboard → modules/videos/notes → progress → search/bulk → audit logs → tests.

## Setup

```bash
cp .env.example .env   # fill AUTH_GOOGLE_ID/SECRET, AUTH_SECRET
npm install
npm run db:push        # creates SQLite schema
npm run db:seed        # seeds admin + sample courses/students
npm run dev
```
