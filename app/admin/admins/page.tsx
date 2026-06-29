import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { createAdmin, updateAdmin, deleteAdmin } from "@/actions/admins";
import ActionForm from "@/components/ActionForm";
import ActionButton from "@/components/ActionButton";

export default async function AdminsPage() {
  const { admin: current } = await requireAdmin();
  const admins = await prisma.admin.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="wide-canvas">
      <h1>Admins</h1>
      <p>
        Admins sign in with Google using the email below. Add, update, or remove admin access here.
      </p>

      <div className="add-student-panel">
        <div className="form-card-header">
          <span>Add an admin</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Admin added."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return createAdmin({ name: fd.get("name"), email: fd.get("email") });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Full name
                <input name="name" placeholder="e.g. Jane Admin" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Email
                <input name="email" type="email" placeholder="jane@example.com" required />
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Add admin</button>
          </div>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: "32px" }}>All admins ({admins.length})</h2>

      <div style={{ display: "grid", gap: "16px" }}>
        {admins.map((a) => (
          <div className="add-student-panel" key={a.id}>
            <div className="form-card-header">
              <span>
                {a.name}
                {a.id === current.id ? " (you)" : ""}
              </span>
              <span className="status-pill" data-tone={a.status === "active" ? undefined : "danger"}>
                {a.status}
              </span>
            </div>
            <ActionForm
              className="form-card-body"
              successMessage="Admin updated."
              action={async (fd: FormData) => {
                "use server";
                return updateAdmin(a.id, {
                  name: fd.get("name"),
                  email: fd.get("email"),
                  status: fd.get("status"),
                });
              }}
            >
              <div className="form-grid">
                <div className="form-field-group">
                  <label>
                    Full name
                    <input name="name" defaultValue={a.name} required />
                  </label>
                </div>
                <div className="form-field-group">
                  <label>
                    Email
                    <input name="email" type="email" defaultValue={a.email} required />
                  </label>
                </div>
                <div className="form-field-group">
                  <label>
                    Status
                    <select name="status" defaultValue={a.status} disabled={a.id === current.id}>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <button type="submit">Save changes</button>
              </div>
            </ActionForm>
            {a.id !== current.id ? (
              <div style={{ padding: "0 22px 18px" }}>
                <ActionButton
                  action={async () => {
                    "use server";
                    return deleteAdmin(a.id);
                  }}
                  successMessage={`Removed admin ${a.email}.`}
                  confirm={`Remove admin access for ${a.email}? They will no longer be able to sign in as an admin.`}
                  className="bulk-delete-btn"
                >
                  Delete admin
                </ActionButton>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
