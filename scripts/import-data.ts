/* Imports scripts/data-dump.json (exported from the dev SQLite DB) into the
 * Postgres database configured by DATABASE_URL. Inserts in FK-dependency order
 * and skips duplicates so it is safe to re-run. */
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db";

const DATE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "assignedAt",
  "deniedAt",
  "accessStartDate",
  "accessEndDate",
  "emailVerified",
  "expires",
  "durationFetchedAt",
]);

function reviveDates<T extends Record<string, unknown>>(row: T): T {
  for (const k of Object.keys(row)) {
    if (DATE_KEYS.has(k) && typeof row[k] === "string") {
      (row as Record<string, unknown>)[k] = new Date(row[k] as string);
    }
  }
  return row;
}

async function main() {
  const dump = JSON.parse(readFileSync("scripts/data-dump.json", "utf8")) as Record<
    string,
    Record<string, unknown>[]
  >;

  // [jsonKey, prisma delegate] in FK-dependency order.
  const order: [string, { createMany: (a: any) => Promise<{ count: number }> }][] = [
    ["user", prisma.user],
    ["account", prisma.account],
    ["session", prisma.session],
    ["verificationToken", prisma.verificationToken],
    ["admin", prisma.admin],
    ["batch", prisma.batch],
    ["package", prisma.package],
    ["course", prisma.course],
    ["student", prisma.student],
    ["module", prisma.module],
    ["video", prisma.video],
    ["note", prisma.note],
    ["packageCourse", prisma.packageCourse],
    ["studentPackage", prisma.studentPackage],
    ["studentCourse", prisma.studentCourse],
    ["batchPackage", prisma.batchPackage],
    ["batchCourse", prisma.batchCourse],
    ["studentCourseDenial", prisma.studentCourseDenial],
    ["videoProgress", prisma.videoProgress],
    ["auditLog", prisma.auditLog],
  ];

  const results: Record<string, string> = {};
  for (const [key, delegate] of order) {
    const rows = (dump[key] ?? []).map((r) => reviveDates({ ...r }));
    if (rows.length === 0) {
      results[key] = "0 (none)";
      continue;
    }
    const res = await delegate.createMany({ data: rows, skipDuplicates: true });
    results[key] = `${res.count}/${rows.length}`;
  }

  console.log("Imported (inserted/total):");
  console.table(results);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
