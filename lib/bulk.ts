/**
 * Parses pasted bulk input. V1 uses textareas — comma- or tab-separated rows.
 * Lines starting with '#' or empty lines are skipped.
 */

export type BulkStudentRow = {
  studentCode: string;
  name: string;
  email: string;
  batchCode?: string;
  /** Course names parsed from the courseNames column, split on `+`. */
  courseNames: string[];
  /** Package names parsed from the packageNames column, split on `+`. */
  packageNames: string[];
};

export type ParseResult<T> = {
  rows: T[];
  errors: { line: number; raw: string; reason: string }[];
};

function splitRow(line: string): string[] {
  // tab-separated wins, otherwise comma.
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  return line.split(",").map((s) => s.trim());
}

function splitPlusList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split("+").map((x) => x.trim()).filter(Boolean);
}

/**
 * Accepts:
 *   studentCode,name,email[,batchCode[,courseNames[,packageNames]]]
 * Where courseNames and packageNames may be `+`-separated lists.
 * Lines starting with `#` are ignored. Empty trailing columns are fine.
 */
export function parseBulkStudents(text: string): ParseResult<BulkStudentRow> {
  const rows: BulkStudentRow[] = [];
  const errors: ParseResult<BulkStudentRow>["errors"] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    if (cells.length < 3) {
      errors.push({
        line: idx + 1,
        raw,
        reason: "expected studentCode,name,email[,batchCode[,courseNames[,packageNames]]]",
      });
      return;
    }
    const [studentCode, name, email, batchCode, courseNamesRaw, packageNamesRaw] = cells;
    if (!studentCode || !name || !email) {
      errors.push({ line: idx + 1, raw, reason: "missing required field" });
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push({ line: idx + 1, raw, reason: "invalid email" });
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(studentCode)) {
      errors.push({ line: idx + 1, raw, reason: "invalid studentCode" });
      return;
    }
    rows.push({
      studentCode,
      name,
      email: email.toLowerCase(),
      batchCode: batchCode || undefined,
      courseNames: splitPlusList(courseNamesRaw),
      packageNames: splitPlusList(packageNamesRaw),
    });
  });
  return { rows, errors };
}

/** Parse a list of identifiers (student codes or emails), one per line. */
export function parseIdentifierList(text: string): string[] {
  return text
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- Batches ----------

export type BulkBatchRow = {
  batchCode: string;
  batchName: string;
  description?: string;
  courseNames: string[];
  packageNames: string[];
};

/**
 * Accepts:
 *   batchCode,batchName[,description[,courseNames[,packageNames]]]
 * courseNames / packageNames are `+`-separated by name. Lines starting with `#` skipped.
 */
export function parseBulkBatches(text: string): ParseResult<BulkBatchRow> {
  const rows: BulkBatchRow[] = [];
  const errors: ParseResult<BulkBatchRow>["errors"] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    if (cells.length < 2) {
      errors.push({
        line: idx + 1,
        raw,
        reason: "expected batchCode,batchName[,description[,courseNames[,packageNames]]]",
      });
      return;
    }
    const [batchCode, batchName, description, courseNamesRaw, packageNamesRaw] = cells;
    if (!batchCode || !batchName) {
      errors.push({ line: idx + 1, raw, reason: "missing batchCode or batchName" });
      return;
    }
    if (!/^[A-Za-z0-9 _-]+$/.test(batchCode)) {
      errors.push({ line: idx + 1, raw, reason: "invalid batchCode" });
      return;
    }
    rows.push({
      batchCode,
      batchName,
      description: description || undefined,
      courseNames: splitPlusList(courseNamesRaw),
      packageNames: splitPlusList(packageNamesRaw),
    });
  });
  return { rows, errors };
}

// ---------- Courses ----------

export type BulkCourseRow = {
  name: string;
  description?: string;
  status?: "active" | "inactive";
};

/**
 * Accepts:
 *   name[,description[,status]]
 * `status` defaults to "active". Lines starting with `#` skipped.
 */
export function parseBulkCourses(text: string): ParseResult<BulkCourseRow> {
  const rows: BulkCourseRow[] = [];
  const errors: ParseResult<BulkCourseRow>["errors"] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    const [name, description, statusRaw] = cells;
    if (!name) {
      errors.push({ line: idx + 1, raw, reason: "missing name" });
      return;
    }
    let status: "active" | "inactive" | undefined;
    if (statusRaw) {
      if (statusRaw === "active" || statusRaw === "inactive") status = statusRaw;
      else {
        errors.push({ line: idx + 1, raw, reason: "status must be active or inactive" });
        return;
      }
    }
    rows.push({
      name,
      description: description || undefined,
      ...(status ? { status } : {}),
    });
  });
  return { rows, errors };
}
