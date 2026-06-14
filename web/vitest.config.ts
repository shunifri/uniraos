import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: resolve(__dirname, "src"),
      },
      // Q3 item #9: mirror vite.config.ts alias so smoke test sees the same
      // resolution as dev server. Without this, dynamic ESM imports like
      //   import('react-syntax-highlighter/dist/esm/languages/prism/${lang}')
      // inside @ant-design/x CodeHighlighter would fail in jsdom.
      {
        find: /^react-syntax-highlighter\/dist\/esm\/languages\/prism\/(.+)$/,
        replacement: "react-syntax-highlighter/dist/cjs/languages/prism/$1",
      },
      {
        find: /^react-syntax-highlighter\/dist\/esm\/languages\/hljs\/(.+)$/,
        replacement: "react-syntax-highlighter/dist/cjs/languages/hljs/$1",
      },
      {
        find: /^react-syntax-highlighter\/dist\/esm\/styles\/(.+)$/,
        replacement: "react-syntax-highlighter/dist/cjs/styles/$1",
      },
      {
        find: "react-syntax-highlighter",
        replacement: "react-syntax-highlighter/dist/cjs/index",
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Q3 item #9: include top-level web/tests/ for smoke tests that aren't
    // co-located with src/ components (e.g. dependency-version regression tests).
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
      thresholds: {
        statements: 8,
        branches: 3,
        functions: 8,
        lines: 8,
      },
    },
  },
});
