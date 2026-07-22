import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveJavaHome } from "@/lib/factory/android-emulator";

const INTERFACE_CLASS = /(?:^|\/)(?:poslinkandroid|poslink|abstractposlink|commsetting|processtransresult|paymentrequest|paymentresponse|client|sdk|api|manager|service|terminal|scanner|printer|builder|config|settings?|request|response)\.class$/i;

/** Extract bounded, compiler-grounded API evidence from imported Android libraries. */
export function inspectImportedAndroidSdk(projectPath: string): { report?: string; files: string[]; error?: string } {
  const sdkDirectory = path.join(projectPath, ".foundry-input", "sdk");
  let archives: string[] = [];
  try { archives = readdirSync(sdkDirectory).filter((name) => name.toLowerCase().endsWith(".aar")); } catch { return { files: [] }; }
  if (!archives.length) return { files: [] };
  const jdk = resolveJavaHome();
  if (!jdk) return { files: archives, error: "No JDK 17+ was available to inspect the imported Android SDK." };
  const jar = path.join(jdk.javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar");
  const javap = path.join(jdk.javaHome, "bin", process.platform === "win32" ? "javap.exe" : "javap");
  const sections: string[] = ["# Imported Android SDK evidence", "", "Generated deterministically from the actual imported AAR. Do not invent APIs absent from this report; inspect additional classes with javap when needed."];
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "foundry-aar-evidence-"));
  try {
    for (const archiveName of archives.slice(0, 8)) {
      const archivePath = path.join(sdkDirectory, archiveName);
      const archiveRoot = path.join(temporaryRoot, archiveName.replace(/[^a-z0-9.-]+/gi, "-"));
      mkdirSync(archiveRoot, { recursive: true });
      const extracted = spawnSync(jar, ["xf", archivePath], { cwd: archiveRoot, encoding: "utf8", timeout: 60_000 });
      if (extracted.status !== 0) { sections.push("", `## ${archiveName}`, `Inspection failed: ${(extracted.stderr || extracted.stdout || "jar extraction failed").trim()}`); continue; }
      const classesJar = path.join(archiveRoot, "classes.jar");
      if (!existsSync(classesJar)) { sections.push("", `## ${archiveName}`, "No classes.jar was present."); continue; }
      const listed = spawnSync(jar, ["tf", classesJar], { encoding: "utf8", timeout: 60_000 });
      const classEntries = (listed.stdout || "").split(/\r?\n/).filter((entry) => {
        if (!entry.endsWith(".class")) return false;
        const publicOwner = entry.replace(/\$[^/]+(?=\.class$)/, "");
        return INTERFACE_CLASS.test(`${publicOwner.replace(/\.class$/, "")}.class`);
      }).slice(0, 96);
      sections.push("", `## ${archiveName}`, `Artifact bytes: ${statSync(archivePath).size}`, `Candidate public integration classes: ${classEntries.length}`);
      for (const entry of classEntries) {
        const className = entry.replace(/\.class$/, "").replace(/\//g, ".");
        const inspected = spawnSync(javap, ["-classpath", classesJar, "-public", "-constants", className], { encoding: "utf8", timeout: 20_000 });
        if (inspected.status === 0 && inspected.stdout.trim()) sections.push("", `### ${className}`, "```text", inspected.stdout.trim().slice(0, 12_000), "```");
        if (sections.join("\n").length > 180_000) break;
      }
      const metadata = path.join(archiveRoot, "META-INF", "com", "android", "build", "gradle", "aar-metadata.properties");
      if (existsSync(metadata)) sections.push("", "### AAR metadata", "```properties", readFileSync(metadata, "utf8").trim(), "```");
    }
    const report = `${sections.join("\n").slice(0, 200_000)}\n`;
    writeFileSync(path.join(sdkDirectory, "sdk-evidence.md"), report, "utf8");
    return { report, files: archives };
  } catch (error) {
    return { files: archives, error: error instanceof Error ? error.message : "Android SDK inspection failed." };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
