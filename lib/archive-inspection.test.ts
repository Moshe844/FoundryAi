import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { describeArchiveInspection, inspectZipArchive } from "./archive-inspection";

const encoder = new TextEncoder();

function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, typeof content === "string" ? encoder.encode(content) : content]),
  ));
}

/** Leading bytes of a real Java class file, so an entry is genuinely compiled output. */
const classBytes = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x00, 0x10]);

describe("listing what an archive provides", () => {
  it("lists entries and extracts the readable ones", () => {
    const archive = zipOf({
      "AndroidManifest.xml": '<manifest package="com.vendor.sdk"/>',
      "classes.jar": classBytes,
      "res/values/strings.xml": "<resources/>",
    });

    const inspection = inspectZipArchive(archive);
    expect(inspection.readable).toBe(true);
    expect(inspection.entries.map((entry) => entry.path).sort()).toEqual(["AndroidManifest.xml", "classes.jar", "res/values/strings.xml"]);

    const extracted = inspection.extracted.map((entry) => entry.path).sort();
    expect(extracted).toEqual(["AndroidManifest.xml", "res/values/strings.xml"]);
    expect(inspection.extracted.find((entry) => entry.path === "AndroidManifest.xml")?.text).toContain("com.vendor.sdk");
  });

  it("states that compiled entries were not read as source", () => {
    const inspection = inspectZipArchive(zipOf({ "classes.jar": classBytes }));
    expect(inspection.limitations.join(" ")).toContain("source code is not present");
  });

  it("classifies an entry from its real bytes, not its name", () => {
    // A file named .xml whose content is a compiled class must not be reported as readable config.
    const inspection = inspectZipArchive(zipOf({ "manifest.xml": classBytes }));
    expect(inspection.extracted).toHaveLength(0);
    expect(inspection.entries[0].editableAsText).toBe(false);
  });

  it("does not list directory entries as files", () => {
    const inspection = inspectZipArchive(zipOf({ "res/": "", "res/values.xml": "<resources/>" }));
    expect(inspection.entries.map((entry) => entry.path)).toEqual(["res/values.xml"]);
  });
});

describe("bounds are reported, never silently applied", () => {
  it("reports entries too large to open", () => {
    const inspection = inspectZipArchive(zipOf({ "big.txt": "x".repeat(4_000) }), { maxEntryBytes: 1_000 });
    expect(inspection.extracted).toHaveLength(0);
    expect(inspection.limitations.join(" ")).toContain("larger than the read limit");
  });

  it("reports a truncated entry list", () => {
    const inspection = inspectZipArchive(zipOf({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }), { maxEntries: 2 });
    expect(inspection.entries).toHaveLength(2);
    expect(inspection.limitations.join(" ")).toContain("Only the first 2 of 3 entries");
  });

  it("reports an exhausted extraction budget", () => {
    const inspection = inspectZipArchive(zipOf({ "a.txt": "x".repeat(600), "b.txt": "y".repeat(600) }), { maxTotalTextBytes: 800 });
    expect(inspection.extracted).toHaveLength(1);
    expect(inspection.limitations.join(" ")).toContain("text-extraction budget");
  });
});

describe("untrusted input", () => {
  it("refuses to read an entry that escapes the archive root", () => {
    const inspection = inspectZipArchive(zipOf({ "../../etc/passwd": "root:x:0:0", "safe.txt": "fine" }));
    expect(inspection.entries.map((entry) => entry.path)).toEqual(["safe.txt"]);
    expect(inspection.limitations.join(" ")).toContain("escape the archive root");
  });

  it("admits when the archive cannot be opened at all", () => {
    const inspection = inspectZipArchive(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(inspection.readable).toBe(false);
    expect(inspection.limitations[0]).toContain("nothing about its contents has been established");
  });
});

describe("the description keeps the caveat attached", () => {
  it("reports the useful half and the limitation together", () => {
    const archive = zipOf({ "AndroidManifest.xml": "<manifest/>", "classes.jar": classBytes });
    const described = describeArchiveInspection("sdk.aar", inspectZipArchive(archive));
    expect(described).toContain("sdk.aar");
    expect(described).toContain("AndroidManifest.xml");
    expect(described).toContain("Limitations:");
  });
});
