import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Frontend tests. Requires `npm install -D vitest jsdom @testing-library/react
// @testing-library/jest-dom` before `npm test` will run. Kept in a separate
// config so the production `vite build` (which reads vite.config.ts) is
// untouched and never needs the test dependencies.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
