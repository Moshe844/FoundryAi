import { describe, expect, it } from "vitest";

import { describeFileStrategy, fileStrategy, readContent } from "./file-intelligence";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function strategyFor(fileName: string, content: string | Uint8Array) {
  return fileStrategy({ fileName, bytes: typeof content === "string" ? bytesOf(content) : content });
}

describe("text is decided from the bytes", () => {
  it("reads ordinary text", () => {
    const reading = readContent(bytesOf("hello world\n"));
    expect(reading.isText).toBe(true);
    expect(reading.text).toBe("hello world\n");
  });

  it("reads an empty file as text", () => {
    expect(readContent(new Uint8Array()).isText).toBe(true);
  });

  it("rejects content containing NUL", () => {
    const reading = readContent(new Uint8Array([0x68, 0x69, 0x00, 0x68, 0x69]));
    expect(reading.isText).toBe(false);
    expect(reading.reason).toContain("NUL");
  });

  it("rejects invalid UTF-8", () => {
    const reading = readContent(new Uint8Array([0xc3, 0x28, 0xa0, 0xa1]));
    expect(reading.isText).toBe(false);
    expect(reading.reason).toContain("not valid UTF-8");
  });

  it("keeps tabs and newlines as ordinary text", () => {
    expect(readContent(bytesOf("a\tb\r\nc\n")).isText).toBe(true);
  });

  it("reads non-ASCII text", () => {
    expect(readContent(bytesOf("café — naïve 日本語")).isText).toBe(true);
  });
});

describe("extensions the old allowlist could not read", () => {
  // Each of these was classified as an opaque binary and never read, purely because its suffix was not
  // on a list. Being unlisted must not cost a file its readability.
  it.each([
    ["component.vue", "<template><div/></template>"],
    ["main.dart", "void main() {}"],
    ["Analytics.scala", "object Analytics extends App"],
    ["page.svelte", "<script>let x = 1;</script>"],
    ["Program.vb", "Module Program"],
    ["helpers.lua", "local function greet() end"],
    ["report.r", "x <- c(1, 2, 3)"],
    ["Home.razor", "@page \"/\""],
  ])("reads %s as editable source", (fileName, content) => {
    const strategy = strategyFor(fileName, content);
    expect(strategy.editableAsText).toBe(true);
    expect(strategy.category).toBe("source-code");
  });

  it.each([
    ["schema.proto", "message User { string id = 1; }"],
    ["api.graphql", "type Query { user: User }"],
  ])("reads the schema definition %s as editable structured data", (fileName, content) => {
    const strategy = strategyFor(fileName, content);
    expect(strategy.editableAsText).toBe(true);
    expect(strategy.category).toBe("structured-data");
  });

  it.each(["Makefile", "Dockerfile", "gradlew", "LICENSE"])("reads the extensionless %s as editable text", (fileName) => {
    const strategy = strategyFor(fileName, "all:\n\techo hi\n");
    expect(strategy.editableAsText).toBe(true);
    expect(strategy.category).toBe("editable-text");
  });
});

describe("text handling categories", () => {
  it.each(["package.json", "Cargo.toml", "docker-compose.yml", "settings.ini", "data.csv", "schema.sql", "app.conf"])(
    "treats %s as structured data",
    (fileName) => {
      expect(strategyFor(fileName, "key = value").category).toBe("structured-data");
    },
  );

  it.each(["README.md", "SPEC.rst", "notes.txt"])("treats %s as documentation", (fileName) => {
    expect(strategyFor(fileName, "# Heading").category).toBe("documentation");
  });
});

describe("never claiming a binary was understood as source", () => {
  it("identifies a Windows executable and says the source was not read", () => {
    const strategy = strategyFor("legacy.dll", new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
    expect(strategy.category).toBe("compiled-binary");
    expect(strategy.editableAsText).toBe(false);
    expect(strategy.limitation).toContain("NOT read its source code");
  });

  it("identifies an ELF shared object", () => {
    const strategy = strategyFor("libnative.so", new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]));
    expect(strategy.category).toBe("compiled-binary");
    expect(strategy.limitation).toBeTruthy();
  });

  it("treats an Android library as a packaged artifact, not source", () => {
    // A .aar is physically a zip; the name is what makes it a packaged artifact rather than a plain one.
    const strategy = strategyFor("sdk-release.aar", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    expect(strategy.category).toBe("packaged-artifact");
    expect(strategy.capability).toContain("entry list");
    expect(strategy.limitation).toContain("source code is not present");
  });

  it("treats a plain zip as an archive whose contents are not yet analyzed", () => {
    const strategy = strategyFor("project-backup.zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    expect(strategy.category).toBe("archive");
    expect(strategy.limitation).toContain("Nothing inside has been analyzed");
  });

  it("treats a .docx as a packaged document rather than editable text", () => {
    const strategy = strategyFor("requirements.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    expect(strategy.category).toBe("documentation");
    expect(strategy.editableAsText).toBe(false);
    expect(strategy.limitation).toContain("packaged document");
  });

  it("states what a PDF's extracted text does not include", () => {
    const strategy = strategyFor("spec.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]));
    expect(strategy.category).toBe("documentation");
    expect(strategy.limitation).toContain("scanned images");
  });

  it("treats an image as an observation, never as code", () => {
    const strategy = strategyFor("mockup.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    expect(strategy.category).toBe("image");
    expect(strategy.limitation).toContain("cannot be read as code");
  });

  it("admits when it established nothing at all", () => {
    // Unrecognised format and unreadable bytes: the honest answer is that nothing is known.
    const strategy = strategyFor("mystery.bin", new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x00]));
    expect(strategy.category).toBe("unknown");
    expect(strategy.limitation).toContain("nothing about what it contains has been established");
  });

  it("trusts the format signature over a misleading extension", () => {
    // A PNG named .ts must not be opened as TypeScript.
    const strategy = strategyFor("sneaky.ts", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    expect(strategy.editableAsText).toBe(false);
    expect(strategy.category).toBe("image");
  });
});

describe("the limitation travels with the claim", () => {
  it("includes the limitation in the description", () => {
    const strategy = strategyFor("legacy.dll", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));
    const described = describeFileStrategy("legacy.dll", strategy);
    expect(described).toContain("legacy.dll");
    expect(described).toContain("Limitation:");
  });

  it("adds no limitation to a file that really was read", () => {
    const described = describeFileStrategy("app.ts", strategyFor("app.ts", "export const x = 1;"));
    expect(described).not.toContain("Limitation:");
  });
});
