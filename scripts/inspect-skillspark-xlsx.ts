/**
 * One-off: read the user's skillspark_courses_packages.xlsx and dump its
 * structure (sheets + first 30 rows of each) so we can confirm the schema
 * before we wipe the live tables.
 */
import * as XLSX from "xlsx";
import * as path from "node:path";

const FILE =
  process.argv[2] ??
  "C:/Users/anand/Downloads/skillspark_courses_packages.xlsx";

function main() {
  const abs = path.resolve(FILE);
  console.log("Reading:", abs);
  const wb = XLSX.readFile(abs);
  console.log("Sheet names:", wb.SheetNames);
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    console.log(`\n=== Sheet: ${name} (${rows.length} rows) ===`);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      console.log(i, JSON.stringify(rows[i]));
    }
    if (rows.length > 30) console.log(`... ${rows.length - 30} more rows`);
  }
}

main();
