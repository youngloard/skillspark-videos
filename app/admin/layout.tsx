import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getCurrentSessionUser } from "@/lib/authorization";
import AdminShell from "@/components/AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const handleSignOut = async () => {
    "use server";
    await signOut({ redirectTo: "/login" });
  };

  return (
    <AdminShell userEmail={user.email} signOutAction={handleSignOut}>
      {children}
    </AdminShell>
  );
}
