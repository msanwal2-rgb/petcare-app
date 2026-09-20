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
    // Everything under /api goes to the .NET API.
    //
    // This is what lets the whole frontend use RELATIVE paths ("/api/v1/pets")
    // exactly as the reference project does. Two things fall out of it: no CORS
    // preflight, and the auth cookie stays first-party — no SameSite=None, no
    // credentials:"include" on every call.
    //
    // Production reproduces the same arrangement differently: ASP.NET serves
    // the built SPA from wwwroot, so the app and the API are genuinely one
    // origin. See BUILD_PLAN.md §2.
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: false,
      },
    },
  },

  build: {
    // Copied into API/src/Leash.Api/wwwroot for a single-process deployment.
    outDir: "dist",
    sourcemap: true,
  },
});
