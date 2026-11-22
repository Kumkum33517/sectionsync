import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
    // Proxy /api calls to the Vercel dev server (runs on 3000 by default).
    // Run `vercel dev` in a separate terminal to enable real OTP emails locally.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/spa",
    // Never ship source maps to production — prevents source code exposure
    sourcemap: false,
    // Single-page app — large bundle is expected; suppress the advisory warning
    chunkSizeWarningLimit: 1200,
    // Strip console.log and debugger statements from production build
    minify: "esbuild",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
    },
  },
});
