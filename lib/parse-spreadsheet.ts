/**
 * Server-side parser for files attached to the admin AI chat.
 *
 * Supported:
 *   - text/csv, text/tab-separated-values, text/plain → parsed in-process.
 *   - Excel (.xlsx, .xls) via the `xlsx` package (loaded with dynamic import
 *     so the bundle stays cold for chats that never use Excel).
 *
 * Output is a single string optimized for stuffing into the user's chat turn:
 * a header line with the filename/size + a fenced block containing the rows
 * as a TSV-style table. The model reads it as tabular data without any extra
 * tool calls.
 */
import "server-only";

export type ParsedFile = {
  filename: string;
  mimeType: string;
  size: number;
  /** Plain-text rendering safe to embed in a chat prompt. */
  asPromptText: string;
  /** Number of rows extracted (excludes blank lines). */
  rowCount: number;
  /** True when we truncated because the file exceeded MAX_ROWS. */
  truncated: boolean;
};

export type ParseError = {
  filename: string;
  reason: string;
};

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB per file
const MAX_ROWS = 1000;
const MAX_CELL_LEN = 400;

function isCsvLike(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return true;
  return (
    mimeType === "text/csv" ||
    mimeType === "text/tab-separated-values" ||
    mimeType === "text/plain"
  );
}

function isExcelLike(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) return true;
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  );
}

function splitRow(line: string): string[] {
  // Same heuristic as lib/bulk.ts — tab wins, otherwise comma.
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  return line.split(",").map((c) => c.trim());
}

function clampCell(s: unknown): string {
  const str = s == null ? "" : String(s);
  return str.length > MAX_CELL_LEN ? str.slice(0, MAX_CELL_LEN) + "…" : str;
}

function rowsToPromptBlock(filename: string, size: number, rows: string[][], truncated: boolean) {
  const lines = rows.map((r) => r.map(clampCell).join("\t"));
  const truncNote = truncated
    ? `\n(truncated to ${MAX_ROWS} rows; original had more)`
    : "";
  return [
    `--- attached file: ${filename} (${size} bytes, ${rows.length} rows)${truncNote} ---`,
    "```",
    ...lines,
    "```",
  ].join("\n");
}

async function parseCsv(file: File): Promise<ParsedFile | ParseError> {
  if (file.size > MAX_BYTES) {
    return { filename: file.name, reason: `file exceeds ${MAX_BYTES} bytes` };
  }
  const text = await file.text();
  const rawLines = text.split(/\r?\n/);
  const allRows: string[][] = [];
  for (const raw of rawLines) {
    const line = raw.replace(/^﻿/, ""); // strip BOM on first line
    if (!line.trim()) continue;
    allRows.push(splitRow(line));
  }
  const truncated = allRows.length > MAX_ROWS;
  const rows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;
  return {
    filename: file.name,
    mimeType: file.type || "text/csv",
    size: file.size,
    rowCount: rows.length,
    truncated,
    asPromptText: rowsToPromptBlock(file.name, file.size, rows, truncated),
  };
}

async function parseExcel(file: File): Promise<ParsedFile | ParseError> {
  if (file.size > MAX_BYTES) {
    return { filename: file.name, reason: `file exceeds ${MAX_BYTES} bytes` };
  }
  // Dynamic import keeps `xlsx` out of the hot path for text-only chats. The
  // module is typed loosely (any) so the project still compiles if the dep
  // isn't installed yet — the dynamic import will just fail at runtime and
  // we surface a friendly error.
  let xlsxLib: any = null;
  try {
    xlsxLib = await import(/* webpackIgnore: true */ "xlsx" as string);
  } catch {
    return {
      filename: file.name,
      reason: "Excel parser not installed. Run `npm install xlsx` and restart.",
    };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  let workbook: any;
  try {
    workbook = xlsxLib.read(buf, { type: "buffer" });
  } catch (e: any) {
    return { filename: file.name, reason: `unreadable Excel file (${String(e?.message ?? e).slice(0, 120)})` };
  }
  const sheetName: string | undefined = workbook.SheetNames?.[0];
  if (!sheetName) return { filename: file.name, reason: "no sheets in workbook" };
  const sheet = workbook.Sheets[sheetName];
  const raw: unknown[][] = xlsxLib.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false, // dates/numbers come back as formatted strings
  });
  const allRows: string[][] = raw.map((r: unknown[]) =>
    Array.isArray(r) ? r.map((c) => clampCell(c)) : [],
  );
  const truncated = allRows.length > MAX_ROWS;
  const rows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;
  return {
    filename: file.name,
    mimeType:
      file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: file.size,
    rowCount: rows.length,
    truncated,
    asPromptText:
      `[sheet: ${sheetName}]\n` + rowsToPromptBlock(file.name, file.size, rows, truncated),
  };
}

/**
 * Parse a single attachment. Returns either ParsedFile (success) or
 * ParseError (skipped reason — caller surfaces to admin / assistant).
 */
export async function parseAttachment(file: File): Promise<ParsedFile | ParseError> {
  if (!file || !file.name) return { filename: "(unknown)", reason: "empty attachment" };
  if (isExcelLike(file.name, file.type)) return parseExcel(file);
  if (isCsvLike(file.name, file.type)) return parseCsv(file);
  return {
    filename: file.name,
    reason: `unsupported file type (${file.type || "unknown"}); use CSV, TSV, TXT, or XLSX`,
  };
}

export function isParseError(p: ParsedFile | ParseError): p is ParseError {
  return (p as ParseError).reason !== undefined;
}
