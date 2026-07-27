import { describe, expect, it } from "vitest";
import { translateTools } from "./tool-schema";

describe("Google tool schema translation", () => {
  it("converts unsupported JSON Schema const values to one-value enums", () => {
    const translated = translateTools([{
      name: "write",
      description: "Write a file",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          operation: { type: "string", const: "write" },
        },
        required: ["operation"],
      },
    }], "google");

    expect(JSON.stringify(translated)).not.toContain('"const"');
    expect(translated).toEqual([{
      functionDeclarations: [{
        name: "write",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["write"] },
          },
          required: ["operation"],
        },
      }],
    }]);
  });
});
