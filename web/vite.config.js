import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  root: ".",
  server: {
    // Was 5173 (Vite default) — collided with the dashboard repo's vite
    // when both projects ran. 4173 is Vite's own preview-server default,
    // so the mirror (5173 dev ↔ 4173 dev here) is conventional. strictPort
    // makes the bind fail loudly if 4173 is also taken, instead of vite
    // silently incrementing to 4174 / 4175 / ... .
    port: 4173,
    strictPort: true,
    // Proxy /api requests to the local Express API server during dev.
    // Production deploy can swap this for Vercel functions; the contract
    // (POST /api/evaluate with JSON body) stays the same.
    proxy: {
      "/api": {
        target: "http://localhost:5174",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
