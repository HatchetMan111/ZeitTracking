import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/static/",
  plugins: [react()],
  build: { outDir: "../app/static", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8100" } },
  test: { environment: "jsdom", setupFiles: "./src/test/setup.ts" },
});
