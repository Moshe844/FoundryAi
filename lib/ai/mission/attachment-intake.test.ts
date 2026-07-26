import { zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/dispatch", () => ({ callManagedModel: vi.fn() }));
vi.mock("@/lib/ai/model-router", () => ({ resolveModelForTier: vi.fn() }));

import { assessAttachments, formatAttachmentBriefing, inspectAttachments, type InspectableAttachment } from "./attachment-intake";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";

const callMock = vi.mocked(callManagedModel);
const resolveMock = vi.mocked(resolveModelForTier);

beforeEach(() => {
  callMock.mockReset();
  resolveMock.mockReset();
  resolveMock.mockReturnValue({ tier: "fast", provider: "openai", model: "test-model", effort: "low" });
});

const encoder = new TextEncoder();

function dataUrlOf(bytes: Uint8Array, mediaType = "application/octet-stream"): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Leading bytes of a real Java class file. */
const classBytes = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]);

function aarAttachment(): InspectableAttachment {
  const archive = zipSync({
    "AndroidManifest.xml": encoder.encode('<manifest package="com.vendor.terminal"/>'),
    "classes.jar": classBytes,
  });
  return { fileName: "vendor-sdk.aar", uploadStatus: "binary", dataUrl: dataUrlOf(archive) };
}

describe("opening what used to be ignored", () => {
  it("inspects a packaged SDK instead of leaving it unopened", () => {
    const [assessment] = inspectAttachments([aarAttachment()]);

    expect(assessment.category).toBe("packaged-artifact");
    // The manifest inside is real evidence about what the SDK provides.
    const manifest = assessment.extracts.find((extract) => extract.label.endsWith("AndroidManifest.xml"));
    expect(manifest?.text).toContain("com.vendor.terminal");
    // And the entry listing establishes what it ships.
    expect(assessment.extracts[0].text).toContain("classes.jar");
  });

  it("keeps saying the packaged source was not read", () => {
    const [assessment] = inspectAttachments([aarAttachment()]);
    expect(assessment.limitation).toContain("source code is not present");
  });

  it("reports a compiled library it cannot open as source", () => {
    const [assessment] = inspectAttachments([
      { fileName: "legacy.dll", uploadStatus: "binary", dataUrl: dataUrlOf(new Uint8Array([0x4d, 0x5a, 0x90, 0x00])) },
    ]);
    expect(assessment.category).toBe("compiled-binary");
    expect(assessment.extracts).toHaveLength(0);
    expect(assessment.limitation).toContain("NOT read its source code");
  });

  it("reads a text attachment from its raw content", () => {
    const [assessment] = inspectAttachments([
      { fileName: "payload.json", uploadStatus: "readable", rawText: '{"amount": 1200}' },
    ]);
    expect(assessment.category).toBe("structured-data");
    expect(assessment.extracts[0].text).toContain("1200");
  });
});

describe("placing an attachment against the request", () => {
  it("records relevance, related files and expected use", async () => {
    callMock.mockResolvedValue({
      toolCalls: [{
        name: "assess_attachments",
        arguments: JSON.stringify({
          attachments: [{
            file_name: "vendor-sdk.aar",
            relevance: "Provides the terminal SDK the checkout flow must call.",
            corresponding_project_files: ["app/build.gradle"],
            expected_use: "Add it to the module dependencies and call its payment entry point.",
            unrelated: false,
          }],
        }),
      }],
    } as never);

    const intake = await assessAttachments({
      attachments: [aarAttachment()],
      request: "integrate the card terminal",
      projectFiles: ["app/build.gradle"],
      apiKey: "test",
    });

    expect(intake.assessments[0].relevance).toContain("terminal SDK");
    expect(intake.assessments[0].correspondingFiles).toEqual(["app/build.gradle"]);
    expect(intake.unrelated).toHaveLength(0);
    expect(intake.briefing).toContain("How to use it:");
  });

  it("reports an attachment it cannot place rather than dropping it", async () => {
    callMock.mockResolvedValue({
      toolCalls: [{
        name: "assess_attachments",
        arguments: JSON.stringify({
          attachments: [{ file_name: "vendor-sdk.aar", relevance: "", corresponding_project_files: [], expected_use: "", unrelated: true }],
        }),
      }],
    } as never);

    const intake = await assessAttachments({ attachments: [aarAttachment()], request: "change the footer colour", projectFiles: [], apiKey: "test" });
    expect(intake.unrelated.map((item) => item.fileName)).toEqual(["vendor-sdk.aar"]);
    // Acknowledging a file and then ignoring it is the failure being closed — it must be named.
    expect(intake.briefing).toContain("Relevance to this request could not be established");
  });

  it("treats a missing relevance as unrelated even when the flag says otherwise", async () => {
    callMock.mockResolvedValue({
      toolCalls: [{
        name: "assess_attachments",
        arguments: JSON.stringify({
          attachments: [{ file_name: "vendor-sdk.aar", relevance: "   ", corresponding_project_files: [], expected_use: "", unrelated: false }],
        }),
      }],
    } as never);

    const intake = await assessAttachments({ attachments: [aarAttachment()], request: "anything", projectFiles: [], apiKey: "test" });
    expect(intake.unrelated).toHaveLength(1);
  });

  it("keeps an attachment omitted by the model in the briefing", async () => {
    callMock.mockResolvedValue({
      toolCalls: [{ name: "assess_attachments", arguments: JSON.stringify({ attachments: [] }) }],
    } as never);

    const intake = await assessAttachments({ attachments: [aarAttachment()], request: "anything", projectFiles: [], apiKey: "test" });
    expect(intake.assessments).toHaveLength(1);
    expect(intake.briefing).toContain("vendor-sdk.aar");
  });
});

describe("degrading without inventing", () => {
  it("still reports what each file is with no provider available", async () => {
    const intake = await assessAttachments({ attachments: [aarAttachment()], request: "anything", projectFiles: [] });
    expect(callMock).not.toHaveBeenCalled();
    expect(intake.briefing).toContain("packaged-artifact");
    // Relevance is left unstated rather than guessed.
    expect(intake.assessments[0].relevance).toBeUndefined();
  });

  it("keeps the deterministic reading when the assessment call fails", async () => {
    resolveMock.mockImplementation(() => { throw new Error("no routable model"); });
    const intake = await assessAttachments({ attachments: [aarAttachment()], request: "anything", projectFiles: [], apiKey: "test" });
    expect(intake.assessments[0].category).toBe("packaged-artifact");
  });

  it("returns nothing for no attachments", async () => {
    const intake = await assessAttachments({ attachments: [], request: "anything", projectFiles: [], apiKey: "test" });
    expect(intake.briefing).toBe("");
    expect(callMock).not.toHaveBeenCalled();
  });
});

describe("the briefing keeps limits beside content", () => {
  it("puts the limitation before the extracted content", () => {
    const briefing = formatAttachmentBriefing(inspectAttachments([aarAttachment()]));
    expect(briefing.indexOf("Limitation:")).toBeLessThan(briefing.indexOf("AndroidManifest.xml"));
    expect(briefing).toContain("never describe a file as understood beyond what its limitation allows");
  });
});
