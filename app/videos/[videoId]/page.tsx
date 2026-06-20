import { notFound, redirect } from "next/navigation";
import { requireStudent, requireVideoAccess, AuthError } from "@/lib/authorization";
import { getWatchData } from "@/lib/watch";
import WatchExperience from "@/components/WatchExperience";
import StudentTopbar from "@/components/StudentTopbar";

export default async function StudentVideoPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=denied");
    throw e;
  }
  const { videoId } = await params;
  try {
    await requireVideoAccess(student.id, videoId);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }

  const data = await getWatchData(student.id, videoId);
  if (!data) notFound();

  const accessUntil = student.accessEndDate.toISOString().slice(0, 10);

  return (
    <div className="sx-shell">
      <StudentTopbar accessUntil={accessUntil} />
      <WatchExperience initial={data} />
    </div>
  );
}
