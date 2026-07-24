import { describe, expect, it } from "vitest";
import {
  explicitReadOnlyConstraint,
  explicitReadOnlyProjectIntent,
  fallbackFollowUpResolution,
  normalizeFollowUpResolution,
  standaloneMutationIntent,
} from "@/lib/mission/classifyFollowUp";

const ctx = { source: "uploaded-copy", objective: "Static HTML/CSS/JS project" } as never;

// THE CORE GUARANTEE: the deterministic override never vetoes a change request on vocabulary. If the
// model reads any of these as an edit, no word list may pull it back to read-only. Includes verbs no
// list contains — polish, swap, spruce up, modernize, freshen, tighten, reorganize — on purpose.
const changeRequests = [
  "Can you please redesign my payment test page beautifully?",
  "make my payment test page beautiful",
  "give the landing page a fresh look",
  "spruce up the checkout",
  "modernize the whole thing",
  "the buttons feel dated, freshen them up",
  "swap the storage over to IndexedDB",
  "turn this into a TypeScript project",
  "tighten up the spacing everywhere",
  "please restyle the checkout page",
  "reorganize the nav into a dropdown",
  "can you polish the hero section?",
  "could you jazz up the footer?",
  // The exact request that was answered "I did not edit any file": removing/adding content is an
  // edit. It must never read as a read-only constraint, or the executor withholds write tools and the
  // edit becomes physically impossible.
  "remove the current photos and let me be able to add my own photos",
  "remove the photos and add an upload button",
  "delete the hero image and put an upload control there instead",
];

// Questions are semantic intent and defer to the model. Only explicit denial of mutation may
// deterministically narrow filesystem authority.
const semanticQuestions = [
  "how does the data move around in here?",
  "what does this page do?",
  "why did you choose static HTML?",
  "where is the total calculated?",
  "is the delete button wired up?",
];
const mustOverride = [
  "explain the payment flow to me, but don't change anything",
  "review the checkout without editing any files",
];

// Polite requests are ambiguous by form and must DEFER to the model (no deterministic override),
// whether the underlying verb is read-only or an edit.
const defersToModel = [
  "can you explain how the checkout works?",
  "can you polish the hero section?",
  "could you walk me through the data model?",
];

describe("override never vetoes a change request on vocabulary", () => {
  for (const msg of changeRequests) {
    it(`no override: ${msg}`, () => expect(explicitReadOnlyConstraint(msg)).toBeNull());
  }
});

describe("only unambiguous read-only signals override the model", () => {
  for (const msg of mustOverride) {
    it(`overrides: ${msg}`, () => expect(explicitReadOnlyConstraint(msg)).not.toBeNull());
  }
  for (const msg of defersToModel) {
    it(`defers: ${msg}`, () => expect(explicitReadOnlyConstraint(msg)).toBeNull());
  }
  for (const msg of semanticQuestions) {
    it(`semantic question defers: ${msg}`, () => expect(explicitReadOnlyConstraint(msg)).toBeNull());
  }
});

describe("genuine questions never get promoted to a mutation", () => {
  for (const msg of [...mustOverride, ...semanticQuestions]) {
    it(`not a standalone mutation: ${msg}`, () => expect(standaloneMutationIntent(msg)).toBeNull());
  }
});

describe("offline fallback is safe: questions stay read-only, imperatives act or ask", () => {
  for (const msg of [...mustOverride, ...semanticQuestions]) {
    it(`stays non-mutating: ${msg}`, () =>
      expect(["question", "inspection", "diagnose", "retrospective", "status"]).toContain(fallbackFollowUpResolution(msg, ctx).currentIntent));
  }
  for (const msg of changeRequests) {
    it(`acts or asks, never a silent read-only: ${msg}`, () =>
      expect(["edit", "debug", "clarify"]).toContain(fallbackFollowUpResolution(msg, ctx).currentIntent));
  }
});

describe("fuller fallback classifier keeps its vocabulary guess for offline use", () => {
  it("recognizes a subject-noun question offline", () =>
    expect(explicitReadOnlyProjectIntent("what is stored in the session")).not.toBeNull());
});

describe("structured semantic resolution is authoritative downstream", () => {
  it("preserves an edit expressed with vocabulary no deterministic list knows", () => {
    const result = normalizeFollowUpResolution({
      currentIntent: "edit",
      referencedPriorAction: null,
      relevantFiles: [],
      expectedScope: "Improve the connected interface.",
      destructive: false,
      referenceConfidence: 1,
      plannedAction: "Zhoosh the whole experience so it feels calmer.",
      continuity: "fresh_plan",
      rationale: "The semantic resolver understood an indirect design-change request.",
      clarifyingQuestion: "",
      clarifyingOptions: [],
      runtimeOperation: "none",
    }, "zhoosh teh whole ting so it dont feel so shouty", ctx);
    expect(result.currentIntent).toBe("edit");
    expect(result.destructive).toBe(false);
  });

  it("does not turn a semantic question into an edit because it contains change verbs", () => {
    const result = normalizeFollowUpResolution({
      currentIntent: "inspection",
      referencedPriorAction: null,
      relevantFiles: [],
      expectedScope: "Explain from project evidence.",
      destructive: false,
      referenceConfidence: 1,
      plannedAction: "Explain how replacing the adapter changes caching.",
      continuity: "not_applicable",
      rationale: "The user asked for explanation, not execution.",
      clarifyingQuestion: "",
      clarifyingOptions: [],
      runtimeOperation: "none",
    }, "wud swapping that adapter alter cacheing? just wanna understand", ctx);
    expect(result.currentIntent).toBe("inspection");
  });

  it("carries semantic preview recovery without requiring a recognized phrase", () => {
    const result = normalizeFollowUpResolution({
      currentIntent: "edit",
      referencedPriorAction: null,
      relevantFiles: [],
      expectedScope: "Restore the owned preview runtime only.",
      destructive: false,
      referenceConfidence: 1,
      plannedAction: "Make the project reachable again.",
      continuity: "not_applicable",
      rationale: "The semantic resolver identified a runtime-control request.",
      clarifyingQuestion: "",
      clarifyingOptions: [],
      runtimeOperation: "preview_refresh",
    }, "its ded on my rite side can u wake er up", ctx);
    expect(result.runtimeOperation).toBe("preview_refresh");
    expect(result.currentIntent).toBe("edit");
    expect(result.destructive).toBe(false);
  });
});
