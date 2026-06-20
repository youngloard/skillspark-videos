import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updatePackage, deletePackage, setPackageCourses } from "@/actions/packages";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import ActionForm from "@/components/ActionForm";
import ActionButton from "@/components/ActionButton";

export default async function PackageEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const pkg = await prisma.package.findUnique({
    where: { id },
    include: { packageCourses: { select: { courseId: true } } },
  });
  if (!pkg) notFound();
  const courses = await prisma.course.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
  });
  const checkedCourses = pkg.packageCourses.map((pc) => pc.courseId);

  return (
    <div className="wide-canvas">
      <h1>Package: {pkg.name}</h1>

      <div className="add-student-panel">
        <div className="form-card-header">
          <span>Package Profile</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Package profile saved."
          action={async (fd: FormData) => {
            "use server";
            return updatePackage(id, {
              name: fd.get("name"),
              description: fd.get("description") || "",
              status: fd.get("status"),
            });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Package Name
                <input name="name" defaultValue={pkg.name} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Short Description
                <input name="description" defaultValue={pkg.description ?? ""} />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Status
                <select name="status" defaultValue={pkg.status}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
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
          <span>Courses in this Package</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Package courses saved."
          action={async (fd: FormData) => {
            "use server";
            return setPackageCourses({
              packageId: id,
              courseIds: fd.getAll("courseIds"),
            });
          }}
        >
          <p style={{ marginBottom: "20px", color: "var(--muted)", fontWeight: "500" }}>
            Tick to include; untick to remove. Click "Save courses" to apply changes.
          </p>
          <div className="pickers-grid">
            <MultiCheckPicker
              name="courseIds"
              items={courses.map((c) => ({ id: c.id, label: c.name }))}
              defaultChecked={checkedCourses}
              placeholder="Search courses…"
            />
          </div>
          <div className="form-actions">
            <button type="submit">Save courses</button>
          </div>
        </ActionForm>
      </div>

      <div className="danger-zone-box">
        <h2>Danger zone</h2>
        <p style={{ color: "#7f1d1d", fontWeight: "600", marginBottom: "16px" }}>
          Deleting this package will remove its configuration and unassign it from any student or batch. Note: individual courses remain intact.
        </p>
        <ActionButton
          action={async () => {
            "use server";
            return deletePackage(id);
          }}
          successMessage={`Deleted package “${pkg.name}”.`}
          confirm={`Delete package “${pkg.name}”? Courses remain intact.`}
          redirectTo="/admin/packages"
        >
          Delete package
        </ActionButton>
      </div>
    </div>
  );
}
