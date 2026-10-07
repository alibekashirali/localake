import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Monaco and ECharts dwarf the app code; splitting them keeps the
        // initial parse small and lets the browser cache them across builds.
        manualChunks: {
          monaco: ["monaco-editor", "@monaco-editor/react"],
          charts: ["echarts", "echarts-for-react"],
        },
      },
    },
  },
});
