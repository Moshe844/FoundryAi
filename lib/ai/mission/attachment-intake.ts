import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";
import { describeArchiveInspection, inspectZipArchive } from "@/lib/archive-inspection";
import { fileStrategy, type FileHandlingCategory } from "@/lib/file-intelligence";
/**
 * The minimum an attachment must carry to be inspected.
 *
 * Deliberately structural rather than tied to one attachment type: the client's WorkspaceAttachment and
 * the runtime's FactoryEvidenceAttachment both satisfy it, so intake works on either without either
 * having to know about the other.
 */
export type InspectableAttachment = {
  fileName: string;
  uploadStatus: "readable" | "image" | "binary" | "unsupported" | "error";
  dataUrl?: string;
  rawText?: string;
};

/**
 * Turning an uploaded file into something the mission actually uses.
 *
 * Images reached the executor as vision input and readable text was appended to the task, but anything
 * else — an AAR, a ZIP, a DLL, a packaged document — was counted in an "Imported N attachments" event
 * and then never touched again. Acknowledging a file and then ignoring it is the specific failure this
 * closes: the user watched Foundry say it had received their SDK and then build as though it had not.
 *
 * Two passes. First a deterministic one that establishes what each file is and extracts whatever can be
 * read from it, including the inside of an archive. Then a single model call that says why each one
 * matters to *this* request and which project files it corresponds to. An attachment the model cannot
 * relate to the request is reported as unrelated rather than quietly dropped, because "I could not see
 * how this fits" is a useful answer and silence is not.
 */

export type AttachmentExtract = { label: string; text: string };

export type AttachmentAssessment = {
  fileName: string;
  category: FileHandlingCategory;
  /** What can genuinely be learned from this file. */
  capability: string;
  /** What cannot be learned. Always present for anything Foundry could not read as source. */
  limitation?: string;
  /** Content that was safely read — the file itself, or readable entries found inside an archive. */
  extracts: AttachmentExtract[];
  /** Why this attachment matters to the current request. */
  relevance?: string;
  /** Existing project files this attachment corresponds to. */
  correspondingFiles: string[];
  /** How the mission is expected to use it. */
  expectedUse?: string;
  /** Set when nothing could relate this attachment to the request. Reported, never silently dropped. */
  unrelated: boolean;
};

export type AttachmentIntake = {
  assessments: AttachmentAssessment[];
  /** Compact briefing for the executor's mission context. */
  briefing: string;
  /** Attachments whose relevance could not be established. */
  unrelated: AttachmentAssessment[];
  usage?: RuntimeUsageRecord;
};

/** Per-attachment text budget, so one large log cannot crowd out every other attachment. */
const EXTRACT_BUDGET = 8_000;

/**
 * Establish what each attachment is, deterministically.
 *
 * No model call: format identification and text extraction are facts about the bytes. An archive is
 * opened here so its manifests and metadata become real evidence instead of an unopened blob.
 */
export function inspectAttachments(attachments: InspectableAttachment[]): AttachmentAssessment[] {
  return attachments.map((attachment) => {
    const bytes = bytesOf(attachment);
    const strategy = fileStrategy({ fileName: attachment.fileName, bytes });
    const extracts: AttachmentExtract[] = [];
    let limitation = strategy.limitation;

    if (strategy.editableAsText && attachment.rawText?.trim()) {
      extracts.push({ label: attachment.fileName, text: attachment.rawText.slice(0, EXTRACT_BUDGET) });
    } else if (strategy.category === "archive" || strategy.category === "packaged-artifact" || strategy.category === "documentation") {
      // An archive is inspectable even when it is not readable: its entry list says what it provides,
      // and entries that are themselves text can be read in full.
      if (bytes.length) {
        const inspection = inspectZipArchive(bytes);
        if (inspection.readable) {
          extracts.push({
            label: `${attachment.fileName} (contents)`,
            text: inspection.entries.slice(0, 200).map((entry) => `${entry.path} — ${entry.bytes} bytes${entry.editableAsText ? " (text)" : ""}`).join("\n"),
          });
          let budget = EXTRACT_BUDGET;
          for (const entry of inspection.extracted) {
            if (budget <= 0) break;
            const text = entry.text.slice(0, budget);
            budget -= text.length;
            extracts.push({ label: `${attachment.fileName}!${entry.path}`, text });
          }
          limitation = [strategy.limitation, describeArchiveInspection(attachment.fileName, inspection)].filter(Boolean).join(" ");
        }
      }
    }

    return {
      fileName: attachment.fileName,
      category: strategy.category,
      capability: strategy.capability,
      limitation,
      extracts,
      correspondingFiles: [],
      unrelated: false,
    };
  });
}

const ASSESS_TOOL: NeutralTool = {
  name: "assess_attachments",
  description: "Explain why each attached file matters to the request and which project files it relates to.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      attachments: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            file_name: { type: "string", description: "The attachment's file name, exactly as given." },
            relevance: { type: "string", description: "Why this file matters to this request. Empty if you cannot tell." },
            corresponding_project_files: {
              type: "array",
              maxItems: 8,
              items: { type: "string" },
              description: "Existing project files this attachment relates to, from the listing provided. Empty when none apply.",
            },
            expected_use: { type: "string", description: "How the mission should use this file while implementing. Empty if you cannot tell." },
            unrelated: { type: "boolean", description: "True when you cannot establish any connection between this file and the request." },
          },
          required: ["file_name", "relevance", "corresponding_project_files", "expected_use", "unrelated"],
        },
      },
    },
    required: ["attachments"],
  },
};

const ASSESS_SYSTEM_PROMPT = [
  "You are given a software request, a list of files in the project, and files the user attached to the request.",
  "For each attachment, say why it matters to this specific request and how the work should use it.",
  "An attachment is an input to the work, not a document to summarize. A screenshot usually defines what the result must look like. A JSON or XML file usually defines a payload, schema, or configuration the code must match. A log usually contains the evidence needed to diagnose a failure. A packaged library usually provides a dependency the project must integrate against. A specification document states requirements.",
  "Name corresponding_project_files only from the project listing you were shown, and only where there is a real connection. An empty list is correct when the attachment introduces something the project does not have yet.",
  "You are told what could and could not be read from each file. Respect that: for a compiled or packaged file you may describe what it provides, never how it is implemented.",
  "Set unrelated true when you genuinely cannot connect the file to the request. That is an honest answer and more useful than an invented reason.",
  "Report every attachment you are given, exactly once.",
].join("\n");

/**
 * Establish relevance and project correspondence for every attachment in one call.
 *
 * One call for all of them rather than one each: they are being judged against the same request and the
 * same project, and per-file calls would multiply cost for no added accuracy.
 */
export async function assessAttachments(input: {
  attachments: InspectableAttachment[];
  request: string;
  projectFiles: string[];
  apiKey?: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
}): Promise<AttachmentIntake> {
  const assessments = inspectAttachments(input.attachments);
  if (!assessments.length) return { assessments, briefing: "", unrelated: [] };

  if (!input.apiKey) {
    // Without a provider the deterministic half still stands: what each file is, and what was read from
    // it. Relevance is left unstated rather than guessed, and the briefing says so.
    return { assessments, briefing: formatAttachmentBriefing(assessments), unrelated: [] };
  }

  try {
    const provider: ProviderId = input.provider ?? "openai";
    const tier = input.tier ?? "fast";
    const { model, effort } = resolveModelForTier(tier, { provider });

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: [ASSESS_SYSTEM_PROMPT, "Always call assess_attachments with your answer. Do not respond with plain text."].join("\n"),
        messages: [{ role: "user", content: [{ type: "text", text: [
          `Request:\n${input.request}`,
          `Project files:\n${input.projectFiles.slice(0, 300).join("\n") || "(empty project)"}`,
          `Attachments:\n${assessments.map(describeForAssessment).join("\n\n")}`,
        ].join("\n\n") }] }],
        tools: [ASSESS_TOOL],
        toolChoice: "auto",
        maxOutputTokens: 1_500,
        routing: routingContext(input.request, "inspect", tier, input.workspaceId),
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "assess_attachments");
    const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
    const byName = new Map((parsed?.attachments ?? [])
      .filter((item) => typeof item?.file_name === "string")
      .map((item) => [String(item.file_name), item] as const));

    const merged = assessments.map((assessment) => {
      const reported = byName.get(assessment.fileName);
      if (!reported) return assessment;
      const relevance = text(reported.relevance);
      return {
        ...assessment,
        relevance: relevance || undefined,
        expectedUse: text(reported.expected_use) || undefined,
        correspondingFiles: Array.isArray(reported.corresponding_project_files)
          ? reported.corresponding_project_files.filter((file): file is string => typeof file === "string" && file.trim().length > 0).slice(0, 8)
          : [],
        // An attachment with no stated relevance is unrelated whether or not the flag was set. The
        // guarantee is that it never disappears without being mentioned.
        unrelated: Boolean(reported.unrelated) || !relevance,
      };
    });

    return {
      assessments: merged,
      briefing: formatAttachmentBriefing(merged),
      unrelated: merged.filter((assessment) => assessment.unrelated),
      usage: result.usage,
    };
  } catch {
    return { assessments, briefing: formatAttachmentBriefing(assessments), unrelated: [] };
  }
}

/**
 * The briefing the executor sees.
 *
 * Each attachment's limitation sits next to its content on purpose. An executor told "here is the
 * manifest from the SDK" and not told "its source is not present" will happily describe the library's
 * internals, and that claim would then reach the user as though it had been verified.
 */
export function formatAttachmentBriefing(assessments: AttachmentAssessment[]): string {
  if (!assessments.length) return "";

  const blocks = assessments.map((assessment) => {
    const lines = [`Attachment: ${assessment.fileName} (${assessment.category})`];
    lines.push(`What it offers: ${assessment.capability}`);
    if (assessment.limitation) lines.push(`Limitation: ${assessment.limitation}`);
    if (assessment.relevance) lines.push(`Why it matters here: ${assessment.relevance}`);
    if (assessment.correspondingFiles.length) lines.push(`Related project files: ${assessment.correspondingFiles.join(", ")}`);
    if (assessment.expectedUse) lines.push(`How to use it: ${assessment.expectedUse}`);
    if (assessment.unrelated) {
      lines.push("Relevance to this request could not be established. Do not invent a use for it — if it turns out to matter, say so; otherwise report that it was not needed.");
    }
    for (const extract of assessment.extracts) {
      lines.push(`--- ${extract.label} ---`, extract.text);
    }
    return lines.join("\n");
  });

  return [
    "Attached evidence for this mission. Each of these was provided by the user deliberately — use it, and never describe a file as understood beyond what its limitation allows:",
    ...blocks,
  ].join("\n\n");
}

function describeForAssessment(assessment: AttachmentAssessment): string {
  const preview = assessment.extracts.map((extract) => `${extract.label}:\n${extract.text.slice(0, 2_000)}`).join("\n");
  return [
    `File: ${assessment.fileName} (${assessment.category})`,
    `Readable: ${assessment.capability}`,
    assessment.limitation ? `Not readable: ${assessment.limitation}` : "",
    preview ? `Content read:\n${preview}` : "No content could be read from this file.",
  ].filter(Boolean).join("\n");
}

/** An attachment's bytes, from its data URL when it has one. */
function bytesOf(attachment: InspectableAttachment): Uint8Array {
  const base64 = attachment.dataUrl?.split(",")[1];
  if (base64) {
    try {
      return new Uint8Array(Buffer.from(base64, "base64"));
    } catch {
      // Fall through to the text form below.
    }
  }
  return attachment.rawText ? new TextEncoder().encode(attachment.rawText) : new Uint8Array();
}

type ParsedAssessment = {
  attachments?: Array<{
    file_name?: unknown;
    relevance?: unknown;
    corresponding_project_files?: unknown[];
    expected_use?: unknown;
    unrelated?: unknown;
  }>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function safeJsonParse(value: string): ParsedAssessment | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
