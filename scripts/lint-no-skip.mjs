#!/usr/bin/env node
/**
 * lint-no-skip.mjs — CI gate for the new `local/no-new-skip` rule.
 *
 * Why this exists
 * ---------------
 * `npm run lint` runs the full ESLint config which currently reports
 * ~17 pre-existing errors and ~1300 warnings unrelated to skip/only
 * (mostly `@typescript-eslint/no-explicit-any` and `no-require-imports`).
 * Adding a new `it.skip(...)` would be drowned in that noise.
 *
 * This script is the **dedicated gate** for the new rule:
 *   - exit 0  → no new skip/only in any test file
 *   - exit 1  → at least one new skip/only found (with location)
 *   - --report → print summary, never exit non-zero
 *
 * It runs ESLint's Node API on a stripped config (only our rule) so the
 * output is clean and the signal is unambiguous.
 *
 * Related docs: docs/migration-skip-to-todo.md
 */
import { ESLint } from "eslint";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const isReport = process.argv.includes("--report");
const targets = ["tests"];

const eslint = new ESLint({
  cwd: repoRoot,
  // Use the project's main eslint.config.js as the base, then layer our
  // minimal config on top. ESLint merges configs by `files` glob and the
  // `local` plugin is defined in the base — our override adds the rule
  // reference (`"local/no-new-skip": "error"`) but does NOT redefine the
  // plugin object, so there's no conflict.
  //
  // Note: overrideConfigFile: true → keep using the default eslint.config.js
  //       overrideConfigFile: false → use no config file (we don't want this
  //         because we'd lose tsconfig-aware parsing and the local plugin)
  //       overrideConfigFile: <path> → use a custom config file
  overrideConfigFile: true,
  // Build a minimal flat config inline so we only exercise our rule.
  // The ignores list mirrors the main config for the same paths.
  overrideConfig: {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    ignores: [
      "tests/performance/**",
      "tests/fixtures/**",
      "tests/_disabled/**",
      "tests/db/mysql-database.test.ts",
      "tests/vector/qdrant-client.test.ts",
      "tests/_test_lint.test.ts",
    ],
    languageOptions: {
      parser: (await import("@typescript-eslint/parser")).default,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: repoRoot,
        sourceType: "module",
        ecmaVersion: 2022,
      },
      globals: {
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
    plugins: {
      local: {
        rules: {
          // Mirror the rule from eslint.config.js so this script is
          // self-contained and doesn't depend on the main config.
          "no-new-skip": {
            meta: {
              type: "problem",
              messages: {
                noSkip:
                  "Avoid `{{kind}}(...)` in new test code. Use `{{kindShort}}.todo(...)` for unimplemented tests, or fix the implementation. See docs/migration-skip-to-todo.md.",
                noOnly:
                  "Avoid `{{kind}}(...)` in test code — it makes the rest of the suite silently skipped. Remove it before committing.",
              },
              schema: [],
            },
            create(context) {
              const TEST_FUNCTIONS = new Set(["it", "test", "describe"]);
              const SKIP_METHODS = new Set(["skip", "only"]);
              return {
                CallExpression(node) {
                  const callee = node.callee;
                  if (callee.type !== "MemberExpression" || callee.computed) return;
                  const obj = callee.object;
                  const prop = callee.property;
                  if (obj.type !== "Identifier" || prop.type !== "Identifier") return;
                  if (!TEST_FUNCTIONS.has(obj.name) || !SKIP_METHODS.has(prop.name)) return;
                  const kind = `${obj.name}.${prop.name}`;
                  context.report({
                    node,
                    messageId: prop.name === "skip" ? "noSkip" : "noOnly",
                    data: { kind, kindShort: obj.name },
                  });
                },
              };
            },
          },
        },
      },
    },
    rules: {
      "local/no-new-skip": "error",
    },
  },
  errorOnUnmatchedPattern: false,
});

const results = await eslint.lintFiles(targets);
const violations = results.flatMap((r) =>
  r.messages
    .filter((m) => m.ruleId === "local/no-new-skip")
    .map((m) => ({
      file: path.relative(repoRoot, r.filePath),
      line: m.line,
      column: m.column,
      message: m.message,
    })),
);

if (isReport) {
  console.log(`Scanned ${results.length} test files for new skip/only patterns.`);
  if (violations.length === 0) {
    console.log("✓ no new skip/only found (rule honoured).");
    process.exit(0);
  }
  console.log(`✗ found ${violations.length} violation(s):`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}:${v.column}  ${v.message}`);
  }
  process.exit(0);
}

// Gate mode: exit non-zero if any violation.
if (violations.length === 0) {
  console.log("✓ lint:no-skip — no new it.skip/describe.skip/only in test code.");
  process.exit(0);
}

console.error(`✗ lint:no-skip — found ${violations.length} new skip/only violation(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.column}  ${v.message}`);
}
console.error("\nIf you must add a skip/only (e.g. legacy compat), either:");
console.error("  (a) fix the implementation so the test passes; or");
console.error("  (b) change `.skip` to `.todo` — it explicitly signals unimplemented; or");
console.error("  (c) add `// eslint-disable-next-line local/no-new-skip -- reason` above the line.");
console.error("See docs/migration-skip-to-todo.md for the full migration plan.");
process.exit(1);
