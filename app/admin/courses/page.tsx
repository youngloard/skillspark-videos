import { BookOpen } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { createCourse } from "@/actions/courses";
import ActionForm from "@/components/ActionForm";
import CoursesBrowser from "@/components/CoursesBrowser";

export default async function CoursesPage() {
  await requireAdmin();
  const courses = await prisma.course.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { modules: true, videos: true } } },
  });
  return (
    <div className="adm wide-canvas">
      <header className="adm-head">
        <div className="adm-head-row">
          <div>
            <span className="adm-eyebrow">
              <BookOpen size={13} aria-hidden="true" />
              Catalog
            </span>
            <h1>Courses</h1>
          </div>
          <span className="adm-count">{courses.length} total</span>
        </div>
        <p className="adm-sub">
          Each real course is one row here. Access is granted by assigning the course to a batch —
          never to a student directly.
        </p>
      </header>

      <section className="adm-section">
        <div className="adm-section-head">
          <h2>Add a new course</h2>
        </div>
        <ActionForm
          className="adm-form"
          successMessage="Course created."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return createCourse({
              name: fd.get("name"),
              description: fd.get("description") || "",
              imageUrl: fd.get("imageUrl") || "",
              status: fd.get("status") || "active",
              layout: fd.get("layout") || "module",
            });
          }}
        >
          <p className="adm-note">
            <strong>Navigation layout:</strong> “module” splits the course into modules and chapters.
            “flat” puts lessons/videos directly under the course header.
          </p>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Course name
                <input name="name" placeholder="e.g. Advanced JavaScript" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Short description
                <input name="description" placeholder="Optional brief outline…" />
              </label>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Cover image URL
                <input name="imageUrl" placeholder="e.g. https://images.com/cover.png" type="url" />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Course status
                <select name="status">
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Navigation layout
                <select name="layout" defaultValue="module">
                  <option value="module">module-based</option>
                  <option value="flat">flat (no modules)</option>
                </select>
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Create course</button>
          </div>
        </ActionForm>
      </section>

      <section className="adm-section">
        <CoursesBrowser
          courses={courses.map((c) => ({
            id: c.id,
            name: c.name,
            layout: c.layout,
            status: c.status,
            moduleCount: c._count.modules,
            videoCount: c._count.videos,
          }))}
        />
      </section>
    </div>
  );
}
