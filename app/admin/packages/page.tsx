import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { createPackage } from "@/actions/packages";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import ActionForm from "@/components/ActionForm";
import RowDeleteButton from "@/components/RowDeleteButton";

export default async function PackagesPage() {
  await requireAdmin();
  const [packages, courses] = await Promise.all([
    prisma.package.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { packageCourses: true } } },
    }),
    prisma.course.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="wide-canvas">
      <h1>Packages</h1>
      <div className="add-student-panel" style={{ marginBottom: "32px" }}>
        <div className="form-card-header">
          <span>Add a New Package</span>
        </div>
        <ActionForm
          className="form-card-body form-vertical"
          successMessage="Package created."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return createPackage({
              name: fd.get("name"),
              description: fd.get("description") || "",
              imageUrl: fd.get("imageUrl") || "",
              status: fd.get("status") || "active",
              courseIds: fd.getAll("courseIds"),
            });
          }}
        >
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            Pick the courses that make up this package.
          </p>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Package Name
                <input name="name" placeholder="e.g. Full Stack Bundle" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Short Description
                <input name="description" placeholder="Optional brief outline..." />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Package Status
                <select name="status">
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Cover Image URL
                <input
                  name="imageUrl"
                  placeholder="e.g. https://images.com/package.png"
                  type="url"
                />
              </label>
            </div>
          </div>
          <div className="pickers-grid">
            <MultiCheckPicker
              name="courseIds"
              legend="Courses in this package"
              items={courses.map((c) => ({ id: c.id, label: c.name }))}
              placeholder="Search courses…"
            />
          </div>
          <div className="form-actions">
            <button type="submit">Create package</button>
          </div>
        </ActionForm>
      </div>

      <h2>All packages</h2>
      <div className="table-wrap">
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Courses</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.status}</td>
                <td>{p._count.packageCourses}</td>
                <td className="row-actions">
                  <Link className="row-btn" href={`/admin/packages/${p.id}`}>Open</Link>
                  <RowDeleteButton kind="package" id={p.id} label={p.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
