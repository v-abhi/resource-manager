import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

// 'npx cap add android' recreates the native folder on every GitHub build.
// Copy Java and patch the manifest *after* Capacitor has generated it.
const root = process.cwd();
const mainActivity = join(root, "android/app/src/main/java/com/personal/resourcemanager/MainActivity.java");
const mainActivityTemplate = join(root, "android-patches/MainActivity.java");
const manifest = join(root, "android/app/src/main/AndroidManifest.xml");
const source = await readFile(mainActivityTemplate, "utf8");
if (!source.includes("resource-manager:native-back") || !source.includes("OnBackPressedDispatcher")) {
  throw new Error("Invalid native MainActivity template. Stopping build.");
}
await mkdir(join(root, "android/app/src/main/java/com/personal/resourcemanager"), {recursive:true});
await copyFile(mainActivityTemplate, mainActivity);
let xml = await readFile(manifest, "utf8");
if (!xml.includes("android:enableOnBackInvokedCallback")) {
  if (!/<application\s/.test(xml)) throw new Error("AndroidManifest.xml has no <application> tag.");
  xml = xml.replace(/<application\s/, '<application android:enableOnBackInvokedCallback="true" ');
}
await writeFile(manifest, xml);
console.log("Verified: Android native Back and status bar WindowInsets patch applied.");
