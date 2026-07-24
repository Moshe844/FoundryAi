import { describe, expect, it } from "vitest";
import { stripTerminalFormatting } from "./terminal";

describe("stripTerminalFormatting", () => {
  it("removes dense Next.js color sequences from compiler evidence", () => {
    const input = "\u001b[39m\u001b[31m\u001b[1m^\u001b[22m\u001b[39m Module not found: Can't resolve '@/components/NorthstarApp'";
    expect(stripTerminalFormatting(input)).toBe("^ Module not found: Can't resolve '@/components/NorthstarApp'");
  });

  it("keeps ordinary compiler text unchanged", () => {
    const input = "src/app/page.tsx(1,30): error TS2307";
    expect(stripTerminalFormatting(input)).toBe(input);
  });
});
