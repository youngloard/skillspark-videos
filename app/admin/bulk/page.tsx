import { Info } from "lucide-react";
import { requireAdmin } from "@/lib/authorization";
import {
  bulkAddStudentsFromForm,
  bulkAddBatchesFromForm,
  bulkAddCoursesFromForm,
  bulkEnrollStudentsFromForm,
} from "@/actions/bulk";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import Dropdown from "@/components/Dropdown";
import {
  getActiveBatches,
  getActiveCourses,
  getActivePackages,
} from "@/lib/catalog-cache";

export default async function BulkPage() {
  await requireAdmin();
  const [batches, courses, packages] = await Promise.all([
    getActiveBatches(),
    getActiveCourses(),
    getActivePackages(),
  ]);

  const batchOptions = [
    { value: "", label: "— none —" },
    ...batches.map((b) => ({ value: b.id, label: b.batchCode, hint: b.batchName })),
  ];
  const courseSingleOptions = [
    { value: "", label: "—" },
    ...courses.map((c) => ({ value: c.id, label: c.name })),
  ];
  const packageSingleOptions = [
    { value: "", label: "—" },
    ...packages.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className="wide-canvas">
      <h1>Bulk operations</h1>
      <p style={{ color: "var(--muted)", fontWeight: "600", marginBottom: "24px" }}>
        Existing records matched in the database by their unique key are automatically skipped. Re-uploading the same file is safe and will only append new records.
      </p>

      {/* Bulk Add Students Card */}
      <div className="add-student-panel">
        <div className="form-card-header">
          <span>Bulk Add Students</span>
        </div>
        <div className="form-card-body">
          <ColumnSpec
            required={["studentCode", "name", "email"]}
            optional={["batchCode", "courseNames", "packageNames"]}
            notes={[
              "Multiple courses or packages? Separate names with a + (e.g. Excel+SQL).",
              "Existing students (matched by email or studentCode) are silently skipped.",
              "If a row references a batchCode that doesn't exist yet, it's auto-created (batchName = batchCode, no courses/packages attached). Edit later from the Batches page.",
            ]}
            example="S001,Alice,alice@example.com,ONLB101,Excel+SQL,ADFFA"
          />
          <form
            action={async (fd: FormData) => {
              "use server";
              const r = await bulkAddStudentsFromForm(fd);
              if (!r.ok) throw new Error(r.error);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  CSV / TXT File
                  <input type="file" name="file" accept=".csv,.txt" />
                </label>
              </div>
            </div>

            <div className="form-field-group" style={{ marginTop: "16px", marginBottom: "20px" }}>
              <label>
                Or Paste CSV Text (one student record per line)
                <textarea
                  name="text"
                  rows={8}
                  placeholder={
                    "# studentCode,name,email,batchCode,courseNames,packageNames\n" +
                    "S001,Alice,alice@example.com,ONLB101,Excel+SQL,ADFFA\n" +
                    "S002,Bob,bob@example.com,,Excel,\n"
                  }
                />
              </label>
            </div>

            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  Default Access Start Date
                  <input name="defaultStartDate" type="date" required />
                </label>
              </div>
              <div className="form-field-group">
                <label>
                  Default Access End Date
                  <input name="defaultEndDate" type="date" required />
                </label>
              </div>
            </div>

            <h3 style={{ marginTop: "28px", marginBottom: "12px" }}>Apply parameters to every row (optional)</h3>
            <div className="form-grid">
              <div className="form-field-group">
                <Dropdown
                  name="applyBatchId"
                  label="Batch Assignment"
                  options={batchOptions}
                  placeholder="— none —"
                  minWidth={240}
                />
              </div>
            </div>

            <div className="pickers-grid" style={{ marginTop: "20px" }}>
              <MultiCheckPicker
                name="applyCourseIds"
                legend="Courses to assign to every uploaded student"
                items={courses.map((c) => ({ id: c.id, label: c.name }))}
                placeholder="Search courses…"
              />
              <MultiCheckPicker
                name="applyPackageIds"
                legend="Packages to assign to every uploaded student"
                items={packages.map((p) => ({ id: p.id, label: p.name }))}
                placeholder="Search packages…"
              />
            </div>

            <div className="form-actions">
              <button type="submit">Create students</button>
            </div>
          </form>
        </div>
      </div>

      {/* Bulk Add Batches Card */}
      <div className="add-student-panel" style={{ marginTop: "32px" }}>
        <div className="form-card-header">
          <span>Bulk Add Batches</span>
        </div>
        <div className="form-card-body">
          <ColumnSpec
            required={["batchCode", "batchName"]}
            optional={["description", "courseNames", "packageNames"]}
            notes={[
              "Multiple courses or packages? Separate names with a + (e.g. Excel+SQL).",
              "Existing batches (matched by batchCode) are silently skipped.",
            ]}
            example="ONLB201,Online Batch 201,Spring intake,Excel+SQL,Data Analytics"
          />
          <form
            action={async (fd: FormData) => {
              "use server";
              const r = await bulkAddBatchesFromForm(fd);
              if (!r.ok) throw new Error(r.error);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  CSV / TXT File
                  <input type="file" name="file" accept=".csv,.txt" />
                </label>
              </div>
            </div>

            <div className="form-field-group" style={{ marginTop: "16px", marginBottom: "20px" }}>
              <label>
                Or Paste CSV Text (one batch record per line)
                <textarea
                  name="text"
                  rows={6}
                  placeholder={
                    "# batchCode,batchName,description,courseNames,packageNames\n" +
                    "ONLB201,Online Batch 201,Spring intake,Excel+SQL,Data Analytics\n" +
                    "ONLB202,Online Batch 202,,,ADFFA\n"
                  }
                />
              </label>
            </div>

            <h3 style={{ marginTop: "28px", marginBottom: "12px" }}>Apply parameters to every batch (optional)</h3>
            <div className="pickers-grid">
              <MultiCheckPicker
                name="applyCourseIds"
                legend="Courses to assign to every uploaded batch"
                items={courses.map((c) => ({ id: c.id, label: c.name }))}
                placeholder="Search courses…"
              />
              <MultiCheckPicker
                name="applyPackageIds"
                legend="Packages to assign to every uploaded batch"
                items={packages.map((p) => ({ id: p.id, label: p.name }))}
                placeholder="Search packages…"
              />
            </div>

            <div className="form-actions">
              <button type="submit">Create batches</button>
            </div>
          </form>
        </div>
      </div>

      {/* Bulk Add Courses Card */}
      <div className="add-student-panel" style={{ marginTop: "32px" }}>
        <div className="form-card-header">
          <span>Bulk Add Courses</span>
        </div>
        <div className="form-card-body">
          <ColumnSpec
            required={["name"]}
            optional={["description", "status"]}
            notes={[
              "status is either active (default) or inactive.",
              "Existing courses (matched by name) are silently skipped.",
            ]}
            example="Tally,Tally accounting basics,active"
          />
          <form
            action={async (fd: FormData) => {
              "use server";
              const r = await bulkAddCoursesFromForm(fd);
              if (!r.ok) throw new Error(r.error);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  CSV / TXT File
                  <input type="file" name="file" accept=".csv,.txt" />
                </label>
              </div>
            </div>

            <div className="form-field-group" style={{ marginTop: "16px", marginBottom: "20px" }}>
              <label>
                Or Paste CSV Text (one course record per line)
                <textarea
                  name="text"
                  rows={6}
                  placeholder={
                    "# name,description,status\n" +
                    "Tally,Tally accounting basics,active\n" +
                    "Java,Intro to Java,active\n"
                  }
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="submit">Create courses</button>
            </div>
          </form>
        </div>
      </div>

      {/* Bulk Enroll Existing Students Card */}
      <div className="add-student-panel" style={{ marginTop: "32px", marginBottom: "48px" }}>
        <div className="form-card-header">
          <span>Bulk Enroll Existing Students</span>
        </div>
        <div className="form-card-body">
          <ColumnSpec
            required={["studentCode or email"]}
            optional={[]}
            notes={[
              "Each row is ONE identifier — either a student code OR an email.",
              "Separate identifiers with a new line OR a comma.",
              "Pick exactly one course OR one package to enroll them in — not both.",
              "Unknown identifiers are reported back; the rest are enrolled.",
            ]}
            example={
              "S001, S002, S003\nalice@example.com, bob@example.com"
            }
          />
          <form
            action={async (fd: FormData) => {
              "use server";
              const r = await bulkEnrollStudentsFromForm(fd);
              if (!r.ok) throw new Error(r.error);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  CSV / TXT File
                  <input type="file" name="file" accept=".csv,.txt" />
                </label>
              </div>
            </div>

            <div className="form-field-group" style={{ marginTop: "16px", marginBottom: "20px" }}>
              <label>
                Student Identifiers (one per line or separated by comma)
                <textarea
                  name="identifiers"
                  rows={8}
                  placeholder={
                    "S001, S002, S003\nalice@example.com, bob@example.com"
                  }
                />
              </label>
            </div>

            <h3 style={{ marginTop: "24px", marginBottom: "12px" }}>Choose Single Assignment</h3>
            <div className="form-grid">
              <div className="form-field-group">
                <Dropdown
                  name="courseId"
                  label="Course to Enroll"
                  options={courseSingleOptions}
                  placeholder="—"
                  minWidth={240}
                />
              </div>
              <div className="form-field-group">
                <Dropdown
                  name="packageId"
                  label="or Package to Enroll"
                  options={packageSingleOptions}
                  placeholder="—"
                  minWidth={240}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit">Enroll students</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ColumnSpec({
  required,
  optional,
  notes,
  example,
}: {
  required: string[];
  optional: string[];
  notes?: string[];
  example?: string;
}) {
  return (
    <section className="column-spec" aria-label="File format" style={{ marginBottom: "24px" }}>
      <div className="column-spec-grid">
        <div>
          <span className="column-spec-label">Required Fields</span>
          <div className="column-spec-tags">
            {required.map((c) => (
              <code key={c} data-tone="required">
                {c}
              </code>
            ))}
          </div>
        </div>
        {optional.length > 0 && (
          <div>
            <span className="column-spec-label">Optional Fields</span>
            <div className="column-spec-tags">
              {optional.map((c) => (
                <code key={c} data-tone="optional">
                  {c}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
      {notes && notes.length > 0 ? (
        <ul className="column-spec-notes" style={{ marginTop: "12px" }}>
          {notes.map((n, i) => (
            <li key={i}>
              <Info size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {example ? (
        <div className="column-spec-example" style={{ marginTop: "16px" }}>
          <span className="column-spec-label">CSV Line Example</span>
          <pre>
            <code>{example}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}
