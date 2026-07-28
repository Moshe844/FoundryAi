import { describe, expect, it } from "vitest";

import { deterministicCompilerSourceRepair } from "./deterministic-source-repair";

describe("Next.js global error recovery", () => {
  it("adds the required client boundary from the framework's exact diagnostic", () => {
    const repair = deterministicCompilerSourceRepair({
      sourcePath: "src/app/global-error.tsx",
      content: "import { ShieldAlert } from 'lucide-react';\n\nexport default function GlobalError() { return null; }\n",
      diagnostic: "src/app/global-error.tsx must be a Client Component. Add the \"use client\" directive the top of the file to resolve this issue.",
    });

    expect(repair?.ruleId).toBe("next-global-error-client-boundary");
    expect(repair?.content.startsWith('"use client";\n\nimport')).toBe(true);
  });

  it("does not duplicate an existing directive", () => {
    expect(deterministicCompilerSourceRepair({
      sourcePath: "src/app/global-error.tsx",
      content: '"use client";\n\nexport default function GlobalError() { return null; }\n',
      diagnostic: "global-error.tsx must be a Client Component. Add the \"use client\" directive.",
    })).toBeUndefined();
  });
});

describe("Node native TypeScript test import recovery", () => {
  it("adds the extension to the exact missing relative import", () => {
    const repair = deterministicCompilerSourceRepair({
      sourcePath: "src/lib/dashboard.test.ts",
      content: "import { getKpis } from './dashboard'\n",
      diagnostic: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\work\\src\\lib\\dashboard' imported from C:\\work\\src\\lib\\dashboard.test.ts",
    });
    expect(repair?.ruleId).toBe("node-typescript-test-import-extension");
    expect(repair?.content).toContain("from './dashboard.ts'");
  });

  it("does not rewrite package imports or already explicit imports", () => {
    expect(deterministicCompilerSourceRepair({
      sourcePath: "src/lib/dashboard.test.ts",
      content: "import test from 'node:test'\nimport { getKpis } from './dashboard.ts'\n",
      diagnostic: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\work\\src\\lib\\other' imported from C:\\work\\src\\lib\\dashboard.test.ts",
    })).toBeUndefined();
  });
});
