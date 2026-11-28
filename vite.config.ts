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
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react-vendor";
          if (id.includes("node_modules/@supabase")) return "supabase-vendor";
          if (id.includes("node_modules/lucide-react")) return "ui-vendor";
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
    },
  },
});
