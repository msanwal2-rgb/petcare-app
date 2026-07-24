import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globalSetup: ["./tests/helpers/global-setup.ts"],
    // Tests mutate a shared database; run files sequentially so a reseed in one
    // file can't race another.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
