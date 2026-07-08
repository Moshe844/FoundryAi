import type { EvidenceKind } from "@/lib/files";

export type EvidenceStrategyKind = EvidenceKind | "pasted-diagnostic" | "none";

export type EvidenceStrategy = {
  kind: EvidenceStrategyKind;
  parser: string;
  reasoningStrategy: string;
  presentationStrategy: string;
  verificationFocus: string;
};

export const evidenceStrategyRegistry: Record<EvidenceStrategyKind, EvidenceStrategy> = {
  log: strategy("log", "line-oriented diagnostic parser", "extract current blocker, compare signatures with prior logs, ignore resolved lines", "quote minimal proof line and show fix/verify", "latest log line is centered"),
  json: strategy("json", "structured JSON parser plus evidence index", "inspect keys, values, types, nested JSON strings, and candidate controls", "name exact path/value and provide targeted edit", "JSON path/value is cited"),
  xml: strategy("xml", "tag and text extractor plus nested value inspection", "inspect tag hierarchy, attributes/text candidates, and malformed structure", "show exact XML path or minimal replacement", "XML tag/path is cited"),
  csv: strategy("csv", "row/header parser", "compare columns, row values, missing fields, and malformed cells", "summarize columns/rows and render table when useful", "row/header evidence is cited"),
  spreadsheet: strategy("spreadsheet", "spreadsheet metadata/index parser", "inspect sheet, row, column, and upload-mapped fields", "separate row fields from configured values", "sheet/row/field is cited"),
  pdf: strategy("pdf", "document evidence summary", "extract cited facts and avoid pretending to see unavailable text", "document review with evidence excerpts", "quote only available text"),
  "word-document": strategy("word-document", "document evidence summary", "extract headings/fields and cite exact text when available", "document review", "quote only available text"),
  screenshot: strategy("screenshot", "visual inspection path", "read visible UI text, tree hierarchy, paths, selected state, and errors", "visual finding plus exact next action", "visible UI evidence is named"),
  photo: strategy("photo", "visual inspection path", "describe only visible evidence relevant to the task", "visual finding", "visible evidence is named"),
  diagram: strategy("diagram", "visual diagram inspection", "identify components, flow, dependencies, and missing/ambiguous edges", "architecture explanation or revised diagram guidance", "diagram component/edge is cited"),
  "source-code": strategy("source-code", "language/config-aware text parser", "inspect current file literally, preserve scope, validate structural completeness", "file-specific explanation and source/config blocks", "file scope is explicit"),
  "project-archive": strategy("project-archive", "archive metadata path", "ask for extracted relevant files when archive contents are unavailable", "smallest missing evidence request", "does not pretend archive contents were read"),
  video: strategy("video", "unsupported media metadata", "use metadata only unless transcript/frames are supplied", "ask for transcript or screenshot if needed", "does not hallucinate video contents"),
  audio: strategy("audio", "unsupported media metadata", "use metadata only unless transcript is supplied", "ask for transcript if needed", "does not hallucinate audio contents"),
  markdown: strategy("markdown", "heading and text parser", "inspect sections, code fences, links, and instructions", "document or instruction response", "heading/section is cited"),
  text: strategy("text", "plain text and diagnostic parser", "classify as prose, log, config, command output, or snippet before answering", "adapt to detected subtype", "detected subtype is honored"),
  unknown: strategy("unknown", "metadata and raw text fallback", "use only available evidence and ask for smallest missing parseable form", "uncertainty plus next evidence", "uncertainty is explicit"),
  "pasted-diagnostic": strategy("pasted-diagnostic", "current-message diagnostic parser", "treat current paste as newest evidence and compare with prior blockers", "debug response", "current paste is source of truth"),
  none: strategy("none", "no evidence parser", "answer from state and stable knowledge; ask only for material missing evidence", "natural engineering answer", "no fake evidence claims"),
};

export function strategyForEvidenceKind(kind: EvidenceStrategyKind): EvidenceStrategy {
  return evidenceStrategyRegistry[kind] ?? evidenceStrategyRegistry.unknown;
}

function strategy(
  kind: EvidenceStrategyKind,
  parser: string,
  reasoningStrategy: string,
  presentationStrategy: string,
  verificationFocus: string,
): EvidenceStrategy {
  return { kind, parser, reasoningStrategy, presentationStrategy, verificationFocus };
}
