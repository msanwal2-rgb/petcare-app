import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    // Mirrors the reference project's `@/*` alias, so ported files keep their
    // import paths unchanged.
    //
    // import.meta.dirname rather than __dirname: Vite's native config loader
    // (becoming the default in a future major) cannot see CommonJS globals.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },

  server: {
    port: 5173,
    // No /api proxy: the frontend calls the API at the address in
    // public/config.js, in development exactly as when deployed. The API
    // allows this origin in Cors:Origins (appsettings.Development.json).
  },

  build: {
    // Copied into API/src/Leash.Api/wwwroot for a single-process deployment.
    outDir: "dist",
    sourcemap: true,
  },
});
