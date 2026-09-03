import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude compiled build output (dist/) in addition to vitest's own
    // defaults — without this, a local `npm run build` leaves .test.js
    // duplicates behind that vitest happily discovers and runs a second
    // time alongside the real .test.ts sources.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
