import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/authorization";

export default async function Home() {
  const user = await getCurrentSessionUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  redirect("/dashboard");
}
