import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updateBatch, deleteBatch, setBatchEnrollments } from "@/actions/batches";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import ActionForm from "@/components/ActionForm";
import ActionButton from "@/components/ActionButton";

export default async function BatchEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      students: { orderBy: { name: "asc" } },
      batchCourses: { select: { courseId: true } },
      batchPackages: { select: { packageId: true } },
    },
  });
  if (!batch) notFound();
  const [courses, packages] = await Promise.all([
    prisma.course.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.package.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);
  const checkedCourses = batch.batchCourses.map((bc) => bc.courseId);
  const checkedPackages = batch.batchPackages.map((bp) => bp.packageId);

  return (
    <div className="wide-canvas">
      <h1>Batch: {batch.batchCode}</h1>

      <div className="add-student-panel">
        <summary className="form-card-header">
          <span>Batch Profile</span>
        </summary>
        <ActionForm
          className="form-card-body"
          successMessage="Batch profile saved."
          action={async (fd: FormData) => {
            "use server";
            return updateBatch(id, {
              batchCode: fd.get("batchCode"),
              batchName: fd.get("batchName"),
              description: fd.get("description") || "",
            });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Batch Code
                <input name="batchCode" defaultValue={batch.batchCode} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Batch Name
                <input name="batchName" defaultValue={batch.batchName} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Description
                <input name="description" defaultValue={batch.description ?? ""} />
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Save profile</button>
          </div>
        </ActionForm>
      </div>

      <div className="add-student-panel" style={{ marginTop: "24px" }}>
        <summary className="form-card-header">
          <span>Courses & Packages Assigned to Batch</span>
        </summary>
        <ActionForm
          className="form-card-body"
          successMessage="Batch assignments saved."
          action={async (fd: FormData) => {
            "use server";
            return setBatchEnrollments({
              batchId: id,
              courseIds: fd.getAll("courseIds"),
              packageIds: fd.getAll("packageIds"),
            });
          }}
        >
          <p style={{ marginBottom: "20px", color: "var(--muted)", fontWeight: "500" }}>
            Tick to assign; untick to remove from all current and future students in this batch.
          </p>
          <div className="pickers-grid">
            <MultiCheckPicker
              name="courseIds"
              legend="Courses"
              items={courses.map((c) => ({ id: c.id, label: c.name }))}
              defaultChecked={checkedCourses}
              placeholder="Search courses…"
            />
            <MultiCheckPicker
              name="packageIds"
              legend="Packages"
              items={packages.map((p) => ({ id: p.id, label: p.name }))}
              defaultChecked={checkedPackages}
              placeholder="Search packages…"
            />
          </div>
          <div className="form-actions">
            <button type="submit">Save assignments</button>
          </div>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: "36px" }}>Students in batch ({batch.students.length})</h2>
      {batch.students.length === 0 ? (
        <p className="empty-state">No students in this batch.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Email</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {batch.students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.studentCode}</code>
                  </td>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td className="cell-muted">{s.email}</td>
                  <td className="row-actions">
                    <Link className="row-btn" href={`/admin/students/${s.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="danger-zone-box">
        <h2>Danger zone</h2>
        <p style={{ color: "#7f1d1d", fontWeight: "600", marginBottom: "16px" }}>
          Deleting this batch will unassign all its students from the batch classification. Note: students themselves are not deleted.
        </p>
        <ActionButton
          action={async () => {
            "use server";
            return deleteBatch(id);
          }}
          successMessage={`Deleted batch “${batch.batchCode}”.`}
          confirm={`Delete batch “${batch.batchCode}”? Students are unassigned but not deleted.`}
          redirectTo="/admin/batches"
        >
          Delete batch
        </ActionButton>
      </div>
    </div>
  );
}
