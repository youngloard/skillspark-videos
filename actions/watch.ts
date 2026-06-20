"use server";

import { requireStudent, requireVideoAccess, AuthError } from "@/lib/authorization";
import { getWatchData, type WatchData } from "@/lib/watch";
import { bad, type RD } from "./_shared";

/**
 * Fetches the full watch payload for a single lesson — used by the client
 * watch shell to swap videos in place (no page reload). Re-authorizes the
 * target video every call, so object-level access is enforced on each swap
 * exactly like a fresh page load would.
 */
export async function loadWatchPayload(videoId: string): Promise<RD<WatchData>> {
  let studentId: string;
  try {
    const { student } = await requireStudent();
    studentId = student.id;
    await requireVideoAccess(studentId, videoId);
  } catch (e) {
    if (e instanceof AuthError) return bad("You don't have access to this lesson.");
    throw e;
  }
  const data = await getWatchData(studentId, videoId);
  if (!data) return bad("Lesson not found.");
  return { ok: true, data };
}
