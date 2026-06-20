import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import {
  updateStudent,
  deleteStudent,
  setStudentEnrollments,
} from "@/actions/students";
import {
  denyCourseForStudent,
  undenyCourseForStudent,
} from "@/actions/enrollments";
import { getAccessibleCourses, getCourseSourcesForStudent } from "@/lib/course-access";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import BatchCodeCombobox from "@/components/BatchCodeCombobox";
import ActionForm from "@/components/ActionForm";

export default async function StudentEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      batch: true,
      studentCourses: { select: { courseId: true } },
      studentPackages: { select: { packageId: true } },
      courseDenials: { include: { course: true } },
    },
  });
  if (!student) notFound();

  const [batches, courses, packages, accessible] = await Promise.all([
    prisma.batch.findMany({ orderBy: { batchCode: "asc" } }),
    prisma.course.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.package.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    getAccessibleCourses(id),
  ]);

  const enrolledCourseIds = new Set(student.studentCourses.map((c) => c.courseId));
  const enrolledPackageIds = new Set(student.studentPackages.map((p) => p.packageId));

  // Compute the union: accessible (effective) ∪ denied (so admin can see/undeny).
  const allCourseRows = await prisma.course.findMany({
    where: {
      OR: [
        { id: { in: accessible.map((c) => c.id) } },
        { studentDenials: { some: { studentId: id } } },
      ],
    },
    orderBy: { name: "asc" },
  });
  // Batched lookup — one student × many courses in a handful of parallel
  // queries (replaces the previous N×5 sequential pattern that made this
  // page noticeably slow on a catalog with many courses).
  const sourcesByCourse = await getCourseSourcesForStudent(
    id,
    allCourseRows.map((c) => c.id),
  );

  return (
    <div className="wide-canvas">
      <h1>Edit student: {student.name}</h1>

      <div className="add-student-panel">
        <div className="form-card-header">
          <span>Student Profile</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Student profile saved successfully."
          action={async (fd: FormData) => {
            "use server";
            const r = await updateStudent(id, {
              studentCode: fd.get("studentCode"),
              name: fd.get("name"),
              email: fd.get("email"),
              batchCode: fd.get("batchCode"),
              status: fd.get("status"),
              accessStartDate: fd.get("accessStartDate"),
              accessEndDate: fd.get("accessEndDate"),
            });
            if (r.ok) revalidatePath(`/admin/students/${id}`);
            return r;
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Student Code
                <input name="studentCode" defaultValue={student.studentCode} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Full Name
                <input name="name" defaultValue={student.name} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Email Address
                <input name="email" type="email" defaultValue={student.email} required />
              </label>
            </div>
          </div>

          <div className="form-grid" style={{ marginTop: "12px" }}>
            <div className="form-field-group">
              <label>
                Batch Code
                <BatchCodeCombobox
                  name="batchCode"
                  defaultValue={student.batch?.batchCode ?? ""}
                  options={batches.map((b) => ({ code: b.batchCode, name: b.batchName }))}
                  hint="Pick an existing batch or type a new code. Leave blank to remove the batch assignment."
                />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Account Status
                <select name="status" defaultValue={student.status}>
                  <option value="active">active</option>
                  <option value="blocked">blocked</option>
                </select>
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Access Start Date
                <input name="accessStartDate" type="date" defaultValue={student.accessStartDate.toISOString().slice(0, 10)} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Access End Date
                <input name="accessEndDate" type="date" defaultValue={student.accessEndDate.toISOString().slice(0, 10)} required />
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Save profile</button>
          </div>
        </ActionForm>
      </div>

      <div className="add-student-panel" style={{ marginTop: "24px" }}>
        <div className="form-card-header">
          <span>Direct Enrollments</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Enrollments saved successfully."
          action={async (fd: FormData) => {
            "use server";
            const r = await setStudentEnrollments({
              studentId: id,
              courseIds: fd.getAll("courseIds"),
              packageIds: fd.getAll("packageIds"),
            });
            if (r.ok) revalidatePath(`/admin/students/${id}`);
            return r;
          }}
        >
          <p style={{ marginBottom: "20px", color: "var(--muted)", fontWeight: "500" }}>
            Tick to assign directly to this student; untick to remove. Click "Save enrollments" to apply changes.
          </p>
          <div className="pickers-grid">
            <MultiCheckPicker
              name="courseIds"
              legend="Courses"
              items={courses.map((c) => ({ id: c.id, label: c.name }))}
              defaultChecked={[...enrolledCourseIds]}
              placeholder="Search courses…"
            />
            <MultiCheckPicker
              name="packageIds"
              legend="Packages"
              items={packages.map((p) => ({ id: p.id, label: p.name }))}
              defaultChecked={[...enrolledPackageIds]}
              placeholder="Search packages…"
            />
          </div>
          <div className="form-actions">
            <button type="submit">Save enrollments</button>
          </div>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: "32px" }}>Effective Course Access</h2>
      <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
        Shows the paths (direct, batch, package) through which the student has access. A hard block ("denied") overrides all paths.
      </p>
      {allCourseRows.length === 0 ? (
        <p className="empty-state">No accessible courses configured.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Access Source(s)</th>
                <th aria-label="Denial actions"></th>
              </tr>
            </thead>
            <tbody>
              {allCourseRows.map((c) => {
                const sources = sourcesByCourse.get(c.id) ?? [];
                const denied = sources.includes("denied");
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>
                      {sources.map((src) => (
                        <span
                          key={src}
                          className="status-pill"
                          data-tone={src === "denied" ? "danger" : undefined}
                          style={{ marginRight: "6px" }}
                        >
                          {src}
                        </span>
                      ))}
                    </td>
                    <td>
                      {denied ? (
                        <ActionForm
                          successMessage={`Access to "${c.name}" restored.`}
                          action={async () => {
                            "use server";
                            return undenyCourseForStudent(id, c.id);
                          }}
                        >
                          <button type="submit" className="row-delete" style={{ padding: "6px 12px", background: "var(--gk-green)", color: "var(--gk-dark)", borderColor: "var(--gk-dark)" }}>
                            Undeny
                          </button>
                        </ActionForm>
                      ) : (
                        <ActionForm
                          className="deny-inline-form"
                          successMessage={`Access to "${c.name}" denied.`}
                          action={async (fd: FormData) => {
                            "use server";
                            return denyCourseForStudent(id, c.id, String(fd.get("reason") ?? ""));
                          }}
                        >
                          <input
                            name="reason"
                            placeholder="Reason (optional)"
                            style={{ maxWidth: "200px", height: "36px", padding: "4px 8px" }}
                          />
                          <button type="submit" className="row-delete" style={{ padding: "6px 12px" }}>
                            Deny
                          </button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="danger-zone-box">
        <h2>Danger zone</h2>
        <p style={{ color: "#7f1d1d", fontWeight: "600", marginBottom: "16px" }}>
          Deleting this student will completely remove their access roster records. Batch enrollments and progress metrics are permanently cleared. This action is irreversible.
        </p>
        <ActionForm
          successMessage="Student deleted successfully."
          redirectTo="/admin/students"
          confirm={`Delete ${student.name}? This permanently removes their access records and cannot be undone.`}
          action={async () => {
            "use server";
            const r = await deleteStudent(id);
            if (r.ok) revalidatePath("/admin/students");
            return r;
          }}
        >
          <button type="submit">Delete student</button>
        </ActionForm>
      </div>
    </div>
  );
}
