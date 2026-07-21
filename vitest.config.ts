import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname), "server-only": path.resolve(__dirname, "scripts/test-server-only.ts") } },
  test: { include:["lib/**/*.test.ts"],exclude:["projects/**","node_modules/**"],environment: "node", pool: "forks", poolOptions: { forks: { singleFork: true } } },
});
