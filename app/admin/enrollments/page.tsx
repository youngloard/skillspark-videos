import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import {
  assignCourseToStudent,
  assignPackageToStudent,
  assignCourseToBatch,
  assignPackageToBatch,
} from "@/actions/enrollments";
import ActionForm from "@/components/ActionForm";

/**
 * Resolves an autocomplete `<input list>` value to an ID. We expect the value
 * to look like "Label [id]" (matching the option text below). If the user
 * types a partial we try to match by label exactly.
 */
function pickIdFrom(items: { id: string; label: string }[], value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\[([^\]]+)\]\s*$/);
  if (m) {
    const id = m[1];
    if (items.some((i) => i.id === id)) return id;
  }
  const exact = items.find((i) => i.label === trimmed);
  if (exact) return exact.id;
  // last resort: prefix match if unique
  const prefix = items.filter((i) =>
    i.label.toLowerCase().startsWith(trimmed.toLowerCase()),
  );
  if (prefix.length === 1) return prefix[0].id;
  return null;
}

export default async function EnrollmentsPage() {
  await requireAdmin();
  const [students, batches, courses, packages] = await Promise.all([
    prisma.student.findMany({ orderBy: { name: "asc" } }),
    prisma.batch.findMany({ orderBy: { batchCode: "asc" } }),
    prisma.course.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
    }),
    prisma.package.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
    }),
  ]);

  const studentItems = students.map((s) => ({
    id: s.id,
    label: `${s.studentCode} — ${s.name} <${s.email}>`,
  }));
  const batchItems = batches.map((b) => ({ id: b.id, label: `${b.batchCode} — ${b.batchName}` }));
  const courseItems = courses.map((c) => ({ id: c.id, label: c.name }));
  const packageItems = packages.map((p) => ({ id: p.id, label: p.name }));

  return (
    <div className="wide-canvas">
      <h1>Enrollments</h1>
      <p>Type to search; pick from the suggestions. Each form does one assignment.</p>

      {/* Shared datalists */}
      <datalist id="dl-students">
        {studentItems.map((s) => (
          <option key={s.id} value={`${s.label} [${s.id}]`} />
        ))}
      </datalist>
      <datalist id="dl-batches">
        {batchItems.map((b) => (
          <option key={b.id} value={`${b.label} [${b.id}]`} />
        ))}
      </datalist>
      <datalist id="dl-courses">
        {courseItems.map((c) => (
          <option key={c.id} value={`${c.label} [${c.id}]`} />
        ))}
      </datalist>
      <datalist id="dl-packages">
        {packageItems.map((p) => (
          <option key={p.id} value={`${p.label} [${p.id}]`} />
        ))}
      </datalist>

      <div className="form-card-grid">
        <div className="add-student-panel">
          <div className="form-card-header">
            <span>Assign Course to Student</span>
          </div>
          <ActionForm
            className="form-card-body"
            successMessage="Course assigned to student."
            resetOnSuccess
            action={async (fd: FormData) => {
              "use server";
              const sid = pickIdFrom(studentItems, String(fd.get("studentLabel") ?? ""));
              const cid = pickIdFrom(courseItems, String(fd.get("courseLabel") ?? ""));
              if (!sid || !cid) return { ok: false, error: "Pick both a student and a course." };
              return assignCourseToStudent(sid, cid);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  Select Student
                  <input list="dl-students" name="studentLabel" placeholder="Type student code or name..." required />
                </label>
              </div>
              <div className="form-field-group">
                <label>
                  Select Course
                  <input list="dl-courses" name="courseLabel" placeholder="Type course name..." required />
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit">Assign Course</button>
            </div>
          </ActionForm>
        </div>

        <div className="add-student-panel">
          <div className="form-card-header">
            <span>Assign Package to Student</span>
          </div>
          <ActionForm
            className="form-card-body"
            successMessage="Package assigned to student."
            resetOnSuccess
            action={async (fd: FormData) => {
              "use server";
              const sid = pickIdFrom(studentItems, String(fd.get("studentLabel") ?? ""));
              const pid = pickIdFrom(packageItems, String(fd.get("packageLabel") ?? ""));
              if (!sid || !pid) return { ok: false, error: "Pick both a student and a package." };
              return assignPackageToStudent(sid, pid);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  Select Student
                  <input list="dl-students" name="studentLabel" placeholder="Type student code or name..." required />
                </label>
              </div>
              <div className="form-field-group">
                <label>
                  Select Package
                  <input list="dl-packages" name="packageLabel" placeholder="Type package name..." required />
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit">Assign Package</button>
            </div>
          </ActionForm>
        </div>

        <div className="add-student-panel">
          <div className="form-card-header">
            <span>Assign Course to Batch</span>
          </div>
          <ActionForm
            className="form-card-body"
            successMessage="Course assigned to batch."
            resetOnSuccess
            action={async (fd: FormData) => {
              "use server";
              const bid = pickIdFrom(batchItems, String(fd.get("batchLabel") ?? ""));
              const cid = pickIdFrom(courseItems, String(fd.get("courseLabel") ?? ""));
              if (!bid || !cid) return { ok: false, error: "Pick both a batch and a course." };
              return assignCourseToBatch(bid, cid);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  Select Batch
                  <input list="dl-batches" name="batchLabel" placeholder="Type batch code..." required />
                </label>
              </div>
              <div className="form-field-group">
                <label>
                  Select Course
                  <input list="dl-courses" name="courseLabel" placeholder="Type course name..." required />
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit">Assign to Batch</button>
            </div>
          </ActionForm>
        </div>

        <div className="add-student-panel">
          <div className="form-card-header">
            <span>Assign Package to Batch</span>
          </div>
          <ActionForm
            className="form-card-body"
            successMessage="Package assigned to batch."
            resetOnSuccess
            action={async (fd: FormData) => {
              "use server";
              const bid = pickIdFrom(batchItems, String(fd.get("batchLabel") ?? ""));
              const pid = pickIdFrom(packageItems, String(fd.get("packageLabel") ?? ""));
              if (!bid || !pid) return { ok: false, error: "Pick both a batch and a package." };
              return assignPackageToBatch(bid, pid);
            }}
          >
            <div className="form-grid">
              <div className="form-field-group">
                <label>
                  Select Batch
                  <input list="dl-batches" name="batchLabel" placeholder="Type batch code..." required />
                </label>
              </div>
              <div className="form-field-group">
                <label>
                  Select Package
                  <input list="dl-packages" name="packageLabel" placeholder="Type package name..." required />
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit">Assign to Batch</button>
            </div>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
