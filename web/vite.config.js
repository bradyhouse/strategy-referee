import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  root: ".",
  server: {
    port: 5173,
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
