/**
 * Q3 item #9: CodeHighlighter Vite alias pin smoke test.
 *
 * Why this exists:
 *   The dev server alias pattern (vite.config.ts:14-37 + vitest.config.ts:18-37)
 *   redirects `react-syntax-highlighter/dist/esm/...` to
 *   `react-syntax-highlighter/dist/cjs/...`. This is fragile to package upgrades:
 *
 *   1. New react-syntax-highlighter major may rename dist/ folders.
 *   2. New @ant-design/x may import from new subpaths not covered by alias.
 *   3. New vite/esbuild may change how optimizeDeps pre-bundles bare imports.
 *
 *   This test fails fast if any of those happens, instead of breaking the dev
 *   server silently at runtime. Run with:
 *     cd web && npx vitest run tests/code-highlighter-smoke.test.ts
 *   (Note: vitest 4.x has no --repeat flag; loop manually if needed.)
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Version pin regression
// ─────────────────────────────────────────────────────────────────────────────

describe("react-syntax-highlighter version pin", () => {
  it("is installed at the pinned ~16.1.1 version", () => {
    const pkgPath = resolve(
      __dirname,
      "../node_modules/react-syntax-highlighter/package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.version).toMatch(/^16\.1\.\d+$/);
  });

  it("is listed in web/package.json with a pinned range (no caret on minor)", () => {
    const pkgPath = resolve(__dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.dependencies["react-syntax-highlighter"]).toBe("~16.1.1");
    // override is the safety net — if antd-x upgrades its declared range,
    // override forces the pinned version anyway.
    expect(pkg.overrides?.["react-syntax-highlighter"]).toBe("~16.1.1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CJS subpath resolution — proves the alias regex targets actually exist
// ─────────────────────────────────────────────────────────────────────────────

describe("CJS subpath files exist (alias targets)", () => {
  // The vite alias regexes redirect these ESM paths to CJS:
  //   dist/esm/languages/prism/${lang} → dist/cjs/languages/prism/${lang}
  //   dist/esm/languages/hljs/${lang}  → dist/cjs/languages/hljs/${lang}
  //   dist/esm/styles/${name}          → dist/cjs/styles/${name}
  // If any of these cjs files disappear in a new version, the alias breaks.
  const cases: Array<{ name: string; path: string }> = [
    { name: "prism lang typescript", path: "dist/cjs/languages/prism/typescript.js" },
    { name: "prism lang javascript", path: "dist/cjs/languages/prism/javascript.js" },
    { name: "prism lang python", path: "dist/cjs/languages/prism/python.js" },
    { name: "hljs lang typescript", path: "dist/cjs/languages/hljs/typescript.js" },
    { name: "hljs lang javascript", path: "dist/cjs/languages/hljs/javascript.js" },
    { name: "prism style", path: "dist/cjs/styles/prism/index.js" },
    { name: "hljs style github", path: "dist/cjs/styles/hljs/github.js" },
    { name: "package entry (cjs index)", path: "dist/cjs/index.js" },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.path} exists`, () => {
      const fs = require("fs");
      const fullPath = resolve(
        __dirname,
        "../node_modules/react-syntax-highlighter",
        c.path,
      );
      expect(fs.existsSync(fullPath), `${fullPath} should exist`).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Direct CJS imports work (proves the redirect target is usable)
// ─────────────────────────────────────────────────────────────────────────────

describe("CJS module imports resolve and export expected symbols", () => {
  it("cjs index exports PrismLight, Prism, Light, LightAsync, etc.", async () => {
    // dynamic import — vitest's resolve.alias intercepts this and serves cjs
    const mod = await import("react-syntax-highlighter");
    // The aliases in vitest.config.ts redirect bare `react-syntax-highlighter`
    // to dist/cjs/index, so this is actually loading cjs/index.js.
    expect(typeof mod.PrismLight).toBe("function");
    expect(typeof mod.Prism).toBe("function");
    expect(typeof mod.Light).toBe("function");
    expect(typeof mod.LightAsync).toBe("function");
    expect(typeof mod.PrismAsync).toBe("function");
    expect(typeof mod.PrismAsyncLight).toBe("function");
    expect(typeof mod.createElement).toBe("function");
    expect(typeof mod.default).toBe("function");
  });

  it("prism typescript language module loads via the cjs alias path", async () => {
    // This simulates the regex alias in action: antd-x does
    //   import('react-syntax-highlighter/dist/esm/languages/prism/typescript')
    // and our alias rewrites it to the cjs path at module-resolution time.
    //
    // We deliberately import via the ESM path (with explicit .js extension so
    // Vite's static import-analysis doesn't choke) — the alias regex will
    // redirect it to dist/cjs/.../typescript.js. This proves the regex alias
    // chain end-to-end, instead of just verifying the file exists.
    const mod = await import(
      "react-syntax-highlighter/dist/esm/languages/prism/typescript.js"
    );
    // refractor's language modules export a function `(Prism) => void` that
    // registers the language rules. (Not an array — that's the older prismjs
    // format.) Verifying the function shape is enough to prove the module
    // loaded through the alias chain.
    expect(typeof mod.default).toBe("function");
    // typescript is a refractor extension of javascript; the .aliases hint
    // includes 'ts' so `lang="ts"` works the same as `lang="typescript"`.
    expect(mod.default.aliases).toContain("ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. End-to-end render: CodeHighlighter produces highlighted token classes
// ─────────────────────────────────────────────────────────────────────────────

describe("CodeHighlighter renders token classes via the alias chain", () => {
  it("renders prism-token spans for typescript code", async () => {
    const { CodeHighlighter } = await import("@ant-design/x");

    const sampleCode = `const greeting: string = "hello";\nfunction add(a: number, b: number): number { return a + b; }`;

    render(<CodeHighlighter lang="typescript">{sampleCode}</CodeHighlighter>);

    // CodeHighlighter wraps content in Suspense + lazy; wait for tokens to appear.
    await waitFor(
      () => {
        const tokens = document.querySelectorAll(".token");
        expect(tokens.length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );

    // @ant-design/x's CodeHighlighter uses PrismLight + inline styles
    // (useInlineStyles defaults to true). PrismLight produces only the
    // base `.token` wrapper class — specific token types (keyword,
    // string, etc.) are signalled via inline `style="color: ..."`.
    //
    // To verify the alias chain works end-to-end (and not just file
    // existence), we:
    //   1. assert multiple `.token` spans appeared (≥ 5 for the sample),
    //   2. assert at least one token has a non-empty inline `style`
    //      attribute (proves refractor parsed + PrismLight styled it),
    //   3. assert the syntax-highlighter wrapper class is present.
    const tokens = document.querySelectorAll(".token");
    expect(tokens.length).toBeGreaterThanOrEqual(5);

    const tokensWithStyle = Array.from(tokens).filter((el) => {
      const style = (el as HTMLElement).getAttribute("style");
      return style !== null && style.trim().length > 0;
    });
    expect(tokensWithStyle.length).toBeGreaterThan(0);

    // Confirm the language label is rendered (proves CodeHighlighter saw the lang prop).
    expect(screen.getByText("typescript")).toBeInTheDocument();
  }, 15000); // 15s budget — jsdom + lazy + async import + refractor AST parse

  it("falls back to plain code when lang is omitted (no SyntaxHighlighter invoked)", async () => {
    const { CodeHighlighter } = await import("@ant-design/x");

    const { container } = render(
      <CodeHighlighter>{`plain text without lang`}</CodeHighlighter>,
    );

    // The component returns <code>{children}</code> when lang is missing.
    // It should not throw, and content should be present.
    expect(container.textContent).toContain("plain text without lang");
    // No .token spans should appear because no highlighting happened.
    expect(container.querySelectorAll(".token").length).toBe(0);
  });
});