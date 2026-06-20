/**
 * Destructive: wipes students, batches, courses, packages (and everything that
 * cascades from them — modules, videos, notes, progress, enrollment mappings,
 * denials) then re-seeds courses + packages from the user's Excel file.
 *
 * Run with:
 *   npx tsx scripts/reset-and-seed-from-xlsx.ts
 *   npx tsx scripts/reset-and-seed-from-xlsx.ts <path/to/file.xlsx>
 *
 * Admins, audit logs, and NextAuth/session tables are preserved.
 */
import * as XLSX from "xlsx";
import * as path from "node:path";
import { prisma } from "../lib/db";

const DEFAULT_FILE = "C:/Users/anand/Downloads/skillspark_courses_packages.xlsx";
const FILE = process.argv[2] ?? DEFAULT_FILE;

/** Map loose / short labels in the package's "Included" column to actual
 *  course names. Updated for the broader catalog (SAP, GST, HR, etc.).
 *  Resolution order: exact → this table → "course-name startsWith short".
 *  Any item that still doesn't match is REPORTED but NOT a hard fail — the
 *  script continues so the catalog gets seeded; clean up via the admin UI. */
const SHORT_TO_FULL: Record<string, string> = {
  // Data-analytics catalog (kept from the earlier file).
  "advanced excel": "Advanced Excel",
  excel: "Advanced Excel",
  "ai prompt engineering": "Prompt Engineering",
  "prompt engineering": "Prompt Engineering",
  "ai tools": "Prompt Engineering",
  "power bi": "Power BI",
  python: "Python",
  sql: "SQL",
  analytics: "Data Analytics",
  "data analytics": "Data Analytics",
  "coding-focused analytics": "Data Analytics",
  dashboarding: "Professional Dashboard Creation",
  "dashboard reporting": "Professional Dashboard Creation",
  "dashboard creation": "Professional Dashboard Creation",
  "professional dashboard creation": "Professional Dashboard Creation",
  // Accounting catalog.
  gst: "GST Practitioner",
  "gst practitioner": "GST Practitioner",
  "gst return filing": "GST Return Filing",
  tally: "Tally Prime",
  "tally prime": "Tally Prime",
  "uae vat": "GCC VAT",
  "gcc vat": "GCC VAT",
  "zoho gst": "Zoho GST",
  "zoho vat": "Zoho VAT",
  sage50: "Sage50",
  sap: "SAP S/4HANA (FICO)",
  "sap s/4hana (fico)": "SAP S/4HANA (FICO)",
  "sap fico": "SAP S/4HANA (FICO)",
  "sap mm": "SAP MM / SAP Sourcing and Procurement",
  "sap mm / sap sourcing and procurement": "SAP MM / SAP Sourcing and Procurement",
  "basic accounting": "Basic Accounting",
  "indian accounting": "Basic Accounting",
  "gulf accounting": "Gulf Accounting",
  // Office / admin.
  "ms office 365": "Microsoft Office 365",
  "microsoft office 365": "Microsoft Office 365",
  "admin skills": "Office Administration",
  "office administration": "Office Administration",
  "data entry operator and office automation": "Data Entry Operator and Office Automation",
  // HR.
  "diploma in hr management": "Diploma in HR Management",
  "power bi hr analytics": "Power BI",
};

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveCourseName(short: string, fullNames: Set<string>): string | null {
  const n = normalize(short);
  // Direct match against full names (case-insensitive).
  for (const fn of fullNames) if (normalize(fn) === n) return fn;
  // Lookup short→full mapping.
  if (SHORT_TO_FULL[n]) return SHORT_TO_FULL[n]!;
  // Best-effort: full name starts with the short name.
  for (const fn of fullNames) if (normalize(fn).startsWith(n)) return fn;
  return null;
}

type Pkg = { name: string; includes: string[] };

function readXlsx(filePath: string): { courses: string[]; packages: Pkg[] } {
  const wb = XLSX.readFile(path.resolve(filePath));
  const coursesSheet = wb.Sheets[wb.SheetNames.find((s) => /course/i.test(s) && !/package/i.test(s))!];
  const pkgSheet = wb.Sheets[wb.SheetNames.find((s) => /package/i.test(s))!];
  if (!coursesSheet || !pkgSheet) throw new Error("expected 'Individual Courses' + 'Course Packages' sheets");

  const courseRows = XLSX.utils.sheet_to_json<unknown[]>(coursesSheet, {
    header: 1, blankrows: false, defval: "", raw: false,
  });
  const courses: string[] = [];
  for (let i = 1; i < courseRows.length; i++) {
    const row = courseRows[i] as string[];
    const name = String(row[1] ?? "").trim();
    if (name) courses.push(name);
  }

  const pkgRows = XLSX.utils.sheet_to_json<unknown[]>(pkgSheet, {
    header: 1, blankrows: false, defval: "", raw: false,
  });
  const packages: Pkg[] = [];
  for (let i = 1; i < pkgRows.length; i++) {
    const row = pkgRows[i] as string[];
    const name = String(row[1] ?? "").trim();
    const includesRaw = String(row[2] ?? "").trim();
    if (!name) continue;
    const includes = includesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    packages.push({ name, includes });
  }
  return { courses, packages };
}

async function main() {
  console.log("== reset-and-seed-from-xlsx ==");
  console.log("Excel:", FILE);

  const { courses: courseNames, packages } = readXlsx(FILE);
  console.log(`Found ${courseNames.length} courses, ${packages.length} packages`);

  // Resolve every package's short-name list to full names. Best-effort:
  // unresolved items are logged but do NOT abort the seed — the package is
  // still created with whatever did resolve, and the admin can fix the rest
  // via the UI or AI assistant.
  const fullSet = new Set(courseNames);
  const resolvedPackages = packages.map((p) => {
    const resolved: string[] = [];
    const missing: string[] = [];
    for (const short of p.includes) {
      const full = resolveCourseName(short, fullSet);
      if (full && !resolved.includes(full)) resolved.push(full);
      else if (!full) missing.push(short);
    }
    return { name: p.name, courses: resolved, missing };
  });
  console.log("\nPackage mapping plan:");
  for (const p of resolvedPackages) {
    console.log(`  • "${p.name}"  →  ${p.courses.length} courses${p.missing.length ? ` (unmapped: ${p.missing.join(", ")})` : ""}`);
  }

  // Wipe + reseed in one transaction so we don't end up half-deleted.
  console.log("\nWiping existing rows (in cascade-safe order)…");
  await prisma.$transaction(async (tx) => {
    // Cascade rules cover most of this, but explicit deletes give us a clear
    // ordered audit trail and avoid surprises if a cascade rule is changed
    // later in the schema.
    await tx.videoProgress.deleteMany();
    await tx.studentCourseDenial.deleteMany();
    await tx.studentCourse.deleteMany();
    await tx.studentPackage.deleteMany();
    await tx.batchCourse.deleteMany();
    await tx.batchPackage.deleteMany();
    await tx.packageCourse.deleteMany();
    await tx.note.deleteMany();
    await tx.video.deleteMany();
    await tx.module.deleteMany();
    await tx.student.deleteMany();
    await tx.batch.deleteMany();
    await tx.course.deleteMany();
    await tx.package.deleteMany();

    console.log("Inserting courses…");
    for (const name of courseNames) {
      await tx.course.create({
        data: { name, status: "active", layout: "module" },
      });
    }

    console.log("Inserting packages with course mappings…");
    for (const p of resolvedPackages) {
      const pkg = await tx.package.create({
        data: { name: p.name, status: "active" },
      });
      const courseRows = await tx.course.findMany({
        where: { name: { in: p.courses } },
        select: { id: true, name: true },
      });
      const idByName = new Map(courseRows.map((c) => [c.name, c.id]));
      await tx.packageCourse.createMany({
        data: p.courses
          .map((cn) => idByName.get(cn)!)
          .filter(Boolean)
          .map((courseId) => ({ packageId: pkg.id, courseId })),
      });
    }

    // Audit trail (system actor) so the admin's audit log shows the wipe
    // and lists any package includes that couldn't be resolved to a course.
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "BULK_COURSES_CREATED",
        entityType: "Course",
        newValue: JSON.stringify({
          source: "reset-and-seed-from-xlsx",
          file: FILE,
          coursesCreated: courseNames.length,
          packagesCreated: resolvedPackages.length,
          unmappedByPackage: Object.fromEntries(
            resolvedPackages
              .filter((p) => p.missing.length)
              .map((p) => [p.name, p.missing]),
          ),
          note: "Wiped students/batches/courses/packages + all cascade deps before reseed.",
        }),
      },
    });
  });

  console.log("\nDone. Final counts:");
  const [c, p, b, s, pc] = await Promise.all([
    prisma.course.count(),
    prisma.package.count(),
    prisma.batch.count(),
    prisma.student.count(),
    prisma.packageCourse.count(),
  ]);
  console.table({ courses: c, packages: p, batches: b, students: s, packageCourses: pc });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
