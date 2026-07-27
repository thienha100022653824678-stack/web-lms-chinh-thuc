import { cp, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "dist-v5");
const staticFiles = ["index.html", "lms.html", "lesson.html", "lms-admin.html", "admin.html", "gdrive-player.html", "photo.html"];

await mkdir(output, { recursive: true });
for (const file of staticFiles) await copyFile(resolve(root, file), resolve(output, file));
for (const directory of ["vendor", "styles", "public"]) {
  await cp(resolve(root, directory), resolve(output, directory === "public" ? "." : directory), { recursive: true, force: true });
}
console.log(`Prepared V5 Preview bundle with ${staticFiles.length} unchanged B05 static entry files.`);
