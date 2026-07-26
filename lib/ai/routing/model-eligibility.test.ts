import { describe, expect, it } from "vitest";

import { isRoutableGenerativeModel } from "./capability-registry";

describe("a new model family is not filtered out before routing sees it", () => {
  // The old rule was an allowlist of family prefixes — gpt-5, claude-, gemini- — so any family with a
  // different name was excluded entirely, however capable. These are the hypothetical names the routing
  // contract itself uses as examples of models that do not exist yet.
  it.each([
    ["openai", "sol-1"],
    ["openai", "gpt-6"],
    ["anthropic", "fable-5"],
    ["anthropic", "luna-2"],
    ["google", "terra-1-ultra"],
  ] as const)("routes %s/%s", (provider, id) => {
    expect(isRoutableGenerativeModel(provider, id)).toBe(true);
  });

  it("still routes the current families", () => {
    expect(isRoutableGenerativeModel("openai", "gpt-5.5")).toBe(true);
    expect(isRoutableGenerativeModel("anthropic", "claude-opus-5")).toBe(true);
    expect(isRoutableGenerativeModel("google", "gemini-pro-latest")).toBe(true);
  });
});

describe("non-generative endpoints stay excluded", () => {
  it.each([
    "text-embedding-3-large",
    "omni-moderation-latest",
    "whisper-1",
    "tts-1-hd",
    "dall-e-3",
    "gpt-4o-audio-preview",
    "gpt-4o-transcribe",
    "rerank-v1",
  ])("excludes %s", (id) => {
    expect(isRoutableGenerativeModel("openai", id)).toBe(false);
  });

  it("excludes an alias the provider silently repoints", () => {
    // A mission needs a model whose behavior is stable for its whole run.
    expect(isRoutableGenerativeModel("openai", "chatgpt-4o-chat-latest")).toBe(false);
  });
});

describe("superseded generations stay excluded", () => {
  it.each(["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo", "claude-2.1", "gemini-1.5-pro", "davinci-002"])("excludes %s", (id) => {
    expect(isRoutableGenerativeModel("openai", id)).toBe(false);
  });

  it("keeps the newer members of a family that had older ones", () => {
    expect(isRoutableGenerativeModel("openai", "gpt-4.5-preview")).toBe(true);
    expect(isRoutableGenerativeModel("anthropic", "claude-3-7-sonnet")).toBe(true);
  });
});
