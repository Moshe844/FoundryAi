import { describe, expect, it } from "vitest";
import { buildUploadIntakeMarker, uploadIntakeFingerprint, uploadIntakeMarkerMatches } from "./upload-intake";

const upload = [
  { path: "site/index.html", content: "<h1>hi</h1>" },
  { path: "site/app.js", content: "console.log(1)" },
];
const markerFor = (files: typeof upload, name = "Existing Project") => JSON.stringify(buildUploadIntakeMarker(files, name));

describe("upload intake identity", () => {
  it("recognises the same upload regardless of file order", () => {
    expect(uploadIntakeFingerprint([...upload].reverse())).toBe(uploadIntakeFingerprint(upload));
    expect(uploadIntakeMarkerMatches(markerFor(upload), [...upload].reverse())).toBe(true);
  });

  it("ignores the display name, so intake and the mission agree on one copy", () => {
    // Intake runs before the brief exists and names the folder from the uploaded root; the mission
    // names it from the brief. Keying identity on the name forked a second copy.
    expect(uploadIntakeMarkerMatches(markerFor(upload, "site"), upload)).toBe(true);
    expect(uploadIntakeMarkerMatches(markerFor(upload, "Existing Project"), upload)).toBe(true);
  });

  it("treats changed content as a different upload", () => {
    expect(uploadIntakeMarkerMatches(markerFor(upload), [{ ...upload[0], content: "<h1>different</h1>" }, upload[1]])).toBe(false);
    expect(uploadIntakeMarkerMatches(markerFor(upload), [upload[0]])).toBe(false);
    expect(uploadIntakeMarkerMatches(markerFor(upload), [...upload, { path: "site/extra.css", content: "a{}" }])).toBe(false);
  });

  it("never matches on missing, malformed, or future-versioned markers", () => {
    expect(uploadIntakeMarkerMatches(undefined, upload)).toBe(false);
    expect(uploadIntakeMarkerMatches("not json", upload)).toBe(false);
    expect(uploadIntakeMarkerMatches(JSON.stringify({ version: 2, fingerprint: uploadIntakeFingerprint(upload) }), upload)).toBe(false);
  });

  it("normalises separators so a Windows-style path list is the same upload", () => {
    expect(uploadIntakeFingerprint([{ path: "site\\index.html", content: "<h1>hi</h1>" }]))
      .toBe(uploadIntakeFingerprint([{ path: "site/index.html", content: "<h1>hi</h1>" }]));
  });
});
