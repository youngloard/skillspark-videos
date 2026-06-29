"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { adminCreateSchema, adminUpdateSchema, idSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

/**
 * Admin-account management. Admins sign in with Google using their email, so
 * "adding an admin" just creates an Admin row for that email. Guards prevent a
 * lockout: you can't deactivate/delete yourself, and you can't remove the last
 * active admin.
 */

export async function createAdmin(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = adminCreateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    try {
      const a = await prisma.admin.create({
        data: { name: parsed.data.name, email: parsed.data.email },
      });
      void createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "ADMIN_CREATED", entityType: "Admin", entityId: a.id,
        newValue: { name: a.name, email: a.email },
      });
      revalidatePath("/admin/admins");
      return { ok: true, data: { id: a.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("an admin with that email already exists");
      return bad("create failed");
    }
  });
}

export async function updateAdmin(adminId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(adminId).success) return bad("invalid id");
    const parsed = adminUpdateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const before = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!before) return bad("not found");

    // Lockout guards when deactivating.
    if (parsed.data.status === "inactive" && before.status === "active") {
      if (adminId === admin.id) return bad("you can't deactivate your own account");
      const activeCount = await prisma.admin.count({ where: { status: "active" } });
      if (activeCount <= 1) return bad("can't deactivate the last active admin");
    }

    try {
      const after = await prisma.admin.update({ where: { id: adminId }, data: parsed.data });
      void createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "ADMIN_UPDATED", entityType: "Admin", entityId: adminId,
        oldValue: before, newValue: after,
      });
      revalidatePath("/admin/admins");
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("an admin with that email already exists");
      return bad("update failed");
    }
  });
}

export async function deleteAdmin(adminId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(adminId).success) return bad("invalid id");
    if (adminId === admin.id) return bad("you can't delete your own account");
    const before = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!before) return bad("not found");
    if (before.status === "active") {
      const activeCount = await prisma.admin.count({ where: { status: "active" } });
      if (activeCount <= 1) return bad("can't delete the last active admin");
    }
    await prisma.admin.delete({ where: { id: adminId } });
    void createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "ADMIN_DELETED", entityType: "Admin", entityId: adminId,
      oldValue: before,
    });
    revalidatePath("/admin/admins");
    return { ok: true };
  });
}
