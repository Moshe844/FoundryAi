import { describe, expect, it } from "vitest";
import { duplicateJvmDeclarationIssue, generatedProcessTheaterPath, hasRunnableProjectEntry } from "./executor";

describe("native runnable entry detection", () => {
  it("finds a deeply nested Android MainActivity with an internal TODO", async () => {
    const file = "app/src/main/java/com/foundry/paxpos/MainActivity.kt";
    const directories = new Set(["app", "app/src", "app/src/main", "app/src/main/java", "app/src/main/java/com", "app/src/main/java/com/foundry", "app/src/main/java/com/foundry/paxpos"]);
    const access = {
      listDir: async (relativePath: string) => {
        const prefix = relativePath ? `${relativePath}/` : "";
        const children = new Map<string, "directory" | "file">();
        for (const candidate of [...directories, file]) {
          if (!candidate.startsWith(prefix)) continue;
          const remainder = candidate.slice(prefix.length);
          if (!remainder || remainder.includes("/")) continue;
          children.set(remainder, directories.has(candidate) ? "directory" : "file");
        }
        return [...children].map(([name, kind]) => ({ name, kind }));
      },
      readFile: async (relativePath: string) => ({ exists: relativePath === file, content: `package com.foundry.paxpos\n${"// real product screen\n".repeat(30)}class MainActivity { fun checkout() { /* TODO connect terminal */ } }`, truncated: false, totalBytes: 900 }),
    };
    expect(await hasRunnableProjectEntry(access as never)).toBe(true);
  });
});

describe("JVM declaration collision rejection", () => {
  it("rejects a generated Kotlin class duplicated under java and kotlin source roots", async () => {
    const existingPath = "app/src/main/java/com/example/pos/PaxCredentials.kt";
    const existingContent = "package com.example.pos\ndata class PaxCredentials(val id: String)";
    const access = {
      searchFiles: async () => [{ path: existingPath, line: 2, preview: existingContent }],
      readFile: async (path: string) => ({ exists: path === existingPath, content: existingContent }),
    };
    await expect(duplicateJvmDeclarationIssue(access as never, [{
      path: "app/src/main/kotlin/com/example/pos/PaxCredentials.kt",
      content: "package com.example.pos\ndata class PaxCredentials(val merchant: String)",
    }])).resolves.toContain("duplicate JVM declaration");
  });
});

describe("generated process-theater rejection", () => {
  it("rejects internal provider decisions disguised as executable product code", () => {
    expect(generatedProcessTheaterPath([{
      path: "app/src/main/java/com/example/pos/DecisionVerifier.kt",
      content: `class DecisionVerifier { fun current() = DecisionCheckpoint(selectedProvider = "PAX", settingsPath = "Settings -> Credentials & Integrations", verified = true) }`,
    }])).toBe("app/src/main/java/com/example/pos/DecisionVerifier.kt");
  });

  it("does not reject a real SDK adapter that returns the provider response", () => {
    expect(generatedProcessTheaterPath([{
      path: "app/src/main/java/com/example/pos/PaxPaymentGateway.kt",
      content: `class PaxPaymentGateway(private val posLink: PosLink) { fun sale(request: PaymentRequest): PaymentResponse { posLink.PaymentRequest = request; posLink.ProcessTrans(); return posLink.PaymentResponse } }`,
    }])).toBeUndefined();
  });
});
