/* Explore the Drive folder(s) shared with the service account.
 * Lists the "videos" folder, its course subfolders, and their video files. */
import { getDriveAccessToken } from "../lib/drive-auth";

const API = "https://www.googleapis.com/drive/v3/files";

async function list(q: string, token: string, fields = "files(id,name,mimeType,size,videoMediaMetadata)") {
  const url = new URL(API);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", `nextPageToken,${fields}`);
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("orderBy", "name");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.files as any[];
}

async function main() {
  const token = await getDriveAccessToken();
  if (!token) throw new Error("no token");

  // Find folders named "videos"
  const folders = await list(
    "mimeType = 'application/vnd.google-apps.folder' and name = 'videos' and trashed = false",
    token,
  );
  console.log("=== 'videos' folders ===");
  console.log(folders.map((f) => `${f.id}  ${f.name}`).join("\n") || "(none)");

  for (const vf of folders) {
    console.log(`\n=== Subfolders of videos (${vf.id}) ===`);
    const subs = await list(
      `'${vf.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      token,
    );
    console.log(subs.map((s) => `${s.id}  ${s.name}`).join("\n") || "(none)");

    for (const sub of subs) {
      console.log(`\n--- Files in "${sub.name}" (${sub.id}) ---`);
      const files = await list(
        `'${sub.id}' in parents and trashed = false`,
        token,
      );
      for (const f of files) {
        const dur = f.videoMediaMetadata?.durationMillis;
        console.log(`  ${f.id}  ${f.name}  [${f.mimeType}]${dur ? ` ${Math.round(dur/1000)}s` : ""}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
