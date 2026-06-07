import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

// ---------------------------------------------------------------------------
// Custom rule: local/no-new-skip
// ---------------------------------------------------------------------------
// Background: ROADMAP-2026-Q3 item #3 — prevent new `it.skip(...)` /
// `describe.skip(...)` / `*.only(...)` from being introduced in test code.
//
// Reasoning: vitest `.skip()` silently hides a test failure from CI ("隐性谎言"),
// so 19 (now 31) historical skips have accumulated without anyone noticing.
// `.todo()` is the explicit, surfaced alternative — it shows up in the report
// as "todo" rather than "passing" and forces the next reader to look at it.
//
// Allow-list:
//   - `it.todo(...)` / `test.todo(...)` / `describe.todo(...)` are allowed.
//   - `it.skipIf(condition, ...)` and `it.runIf(condition, ...)` are allowed
//     (conditional skip, clearly signalled by the env var name).
//   - `process.env.X ? describe.skip : describe` style — `.skip` used as a
//     value in a conditional expression is not a call expression and won't
//     match. Verified at design time against tests/db/mysql-database.test.ts
//     and tests/performance/kg-retrieval.benchmark.ts.
//   - `// eslint-disable-next-line local/no-new-skip` is the historical
//     exception mechanism for the 31 pre-existing skips, see
//     docs/migration-skip-to-todo.md for the migration plan.
// ---------------------------------------------------------------------------
const TEST_FUNCTIONS = new Set(["it", "test", "describe"]);
const SKIP_METHODS = new Set(["skip", "only"]);

const noNewSkipRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow it.skip / test.skip / describe.skip / *.only in test code. Use .todo() for unimplemented tests, or fix the implementation.",
    },
    schema: [],
    messages: {
      noSkip:
        "Avoid `{{kind}}(...)` in new test code. Use `{{kindShort}}.todo(...)` for unimplemented tests, or fix the implementation. See docs/migration-skip-to-todo.md.",
      noOnly:
        "Avoid `{{kind}}(...)` in test code — it makes the rest of the suite silently skipped. Remove it before committing.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        const obj = callee.object;
        const prop = callee.property;
        if (obj.type !== "Identifier" || prop.type !== "Identifier") return;
        if (!TEST_FUNCTIONS.has(obj.name) || !SKIP_METHODS.has(prop.name)) return;
        const kind = `${obj.name}.${prop.name}`;
        const kindShort = obj.name;
        context.report({
          node,
          messageId: prop.name === "skip" ? "noSkip" : "noOnly",
          data: { kind, kindShort },
        });
      },
    };
  },
};

const raosPlugin = {
  rules: {
    "no-new-skip": noNewSkipRule,
  },
};

export default [
  {
    plugins: {
      local: raosPlugin,
    },
    rules: {
      "no-undef": "off",
      "no-redeclare": "off",
      "no-useless-escape": "off",
      "no-empty": "off",
      "no-cond-assign": "off",
      "no-prototype-builtins": "off",
      "no-func-assign": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "no-fallthrough": "off",
      "no-constant-condition": "off",
      "no-unreachable": "off",
      "valid-typeof": "off",
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "web/node_modules/**",
      "web/dist/**",
      ".raos/**",
      "src/ui/**",
      "tests/performance/**",
      // Old skip-marked fixture / archive dirs (per ROADMAP-2026-Q3 #3).
      // No new files should be added here; if you find yourself wanting to,
      // that's a signal to either implement the test or use .todo().
      "tests/fixtures/**",
      "tests/_disabled/**",
      "*.js",
      "*.cjs",
      "*.mjs",
    ],
  },
  // Base JS recommended rules (excluding TypeScript files which have their own config)
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...js.configs.recommended,
  },
  // Backend + Tests TypeScript
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
        ecmaVersion: 2022,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
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
      "@typescript-eslint": tsPlugin,
      local: raosPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "quotes": "off",
      "semi": "off",
      "no-trailing-spaces": "off",
      "no-console": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "no-useless-escape": "off",
      "no-empty": "off",
      "no-cond-assign": "off",
      "no-prototype-builtins": "off",
      "no-func-assign": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "no-fallthrough": "off",
      // ROADMAP-2026-Q3 #3: prevent new skip/only in test code.
      // Existing 31 skips are grandfathered via per-line disable comments.
      "local/no-new-skip": "error",
    },
  },
  // Frontend TypeScript/React
  {
    files: ["web/src/**/*.ts", "web/src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
        ecmaVersion: 2022,
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      local: raosPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "quotes": "off",
      "semi": "off",
      "no-trailing-spaces": "off",
      "no-console": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "no-useless-escape": "off",
      "no-empty": "off",
      "no-cond-assign": "off",
      "no-prototype-builtins": "off",
      "no-func-assign": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "no-fallthrough": "off",
      // ROADMAP-2026-Q3 #3: prevent new skip/only in frontend test code too.
      "local/no-new-skip": "error",
    },
  },
];
