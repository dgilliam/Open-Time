// .mts, not .ts: Vitest 4's native config loader treats a .ts config as
// CommonJS and warns on the ESM syntax below. The extension is the fix;
// `__dirname` doesn't exist under ESM, hence import.meta.dirname (Node
// 20.11+, and this repo requires 22 — see .nvmrc).
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
