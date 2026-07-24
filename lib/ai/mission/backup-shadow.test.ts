import { describe, expect, it } from "vitest";
import { backupShadowWriteIssue, originalPathForBackupWrite } from "@/lib/ai/mission/executor";
import type { ProjectAccess } from "@/lib/ai/mission/project-access";

describe("originalPathForBackupWrite", () => {
  const shadows: Array<[string, string]> = [
    ["index.html.bak", "index.html"],
    ["index.html.backup", "index.html"],
    ["styles.css.orig", "styles.css"],
    ["app.js.old", "app.js"],
    ["index-backup.html", "index.html"],
    ["index_backup.html", "index.html"],
    ["index-bak.html", "index.html"],
    ["index-copy.html", "index.html"],
    ["page-old.html", "page.html"],
    ["page.redesigned.html", "page.html"],
    ["src/pages/checkout-backup.tsx", "src/pages/checkout.tsx"],
  ];
  for (const [input, expected] of shadows) {
    it(`maps ${input} -> ${expected}`, () => expect(originalPathForBackupWrite(input)).toBe(expected));
  }

  const notShadows = ["index.html", "contact.html", "index-new.html", "app-v2.js", "styles.css", "dashboard.tsx", "checkout2.html"];
  for (const input of notShadows) {
    it(`does not treat ${input} as a backup`, () => expect(originalPathForBackupWrite(input)).toBeUndefined());
  }
});

describe("backupShadowWriteIssue", () => {
  const access = (existing: string[]): ProjectAccess =>
    ({
      readFile: async (filePath: string) => ({
        exists: existing.includes(filePath.replace(/\\/g, "/")),
        content: "",
        truncated: false,
      }),
    }) as unknown as ProjectAccess;

  it("rejects a backup write when the original exists", async () => {
    const issue = await backupShadowWriteIssue(access(["index.html"]), ["index-backup.html"]);
    expect(issue).toMatch(/index\.html/);
    expect(issue).toMatch(/in place|overwrite it/i);
  });

  it("allows a backup-looking write when no original exists (genuinely new file)", async () => {
    expect(await backupShadowWriteIssue(access([]), ["archive-old.html"])).toBeUndefined();
  });

  it("allows an ordinary edit to the original", async () => {
    expect(await backupShadowWriteIssue(access(["index.html"]), ["index.html"])).toBeUndefined();
  });
});
