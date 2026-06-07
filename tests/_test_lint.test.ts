/**
 * Lint rule behaviour fixture — DO NOT ADD TO MAIN TEST SUITE.
 *
 * Purpose
 * -------
 * This file deliberately violates and complies with the new
 * `local/no-new-skip` ESLint rule (see `eslint.config.js` and
 * `docs/migration-skip-to-todo.md`) so that running `npm run lint` against
 * the repository exercises every branch of the rule:
 *
 *   - `it.skip(...)` / `describe.skip(...)` / `it.only(...)`  →  REPORTED
 *   - `it.todo(...)`                                            →  ALLOWED
 *   - `it.skipIf(...)` (conditional, env-var gated)            →  ALLOWED
 *   - `it(...)` (normal call, no skip/only)                    →  ALLOWED
 *
 * Verification commands (run from repo root):
 *
 *   # Rule should fire on the it.skip and it.only / describe.skip lines:
 *   npx eslint tests/_test_lint.test.ts
 *   #   expected output includes:
 *   #     17:5  error  Avoid `it.skip(...)` in new test code.  local/no-new-skip
 *   #     25:5  error  Avoid `it.only(...)` in new test code.  local/no-new-skip
 *   #     31:3  error  Avoid `describe.skip(...)` in new test code.  local/no-new-skip
 *
 *   # Rule must NOT fire on the it.todo line or the it.skipIf / it() lines:
 *   #   (look for absence of any "local/no-new-skip" entry on those lines)
 *
 * The file is excluded from the regular `npm test` run via
 * `vitest.config.ts -> test.exclude` so it never pollutes CI test counts.
 */
import { describe, it, expect } from "vitest";

describe("lint rule: local/no-new-skip (bait)", () => {
  it("always passes — sanity check that this file even loads", () => {
    expect(1 + 1).toBe(2);
  });

  // --- VIOLATIONS — the rule MUST report these -----------------------------
  it.skip("SHOULD BE FLAGGED: legacy it.skip pattern, see migration doc", () => {
    expect(true).toBe(true);
  });

  it.only("SHOULD BE FLAGGED: it.only makes the rest of the suite skipped", () => {
    expect(true).toBe(true);
  });

  describe.skip("SHOULD BE FLAGGED: describe.skip hides all children", () => {
    it("would-be nested test", () => {
      expect(true).toBe(true);
    });
  });

  // --- COMPLIANCE — the rule MUST NOT report these -------------------------
  it.todo("compliant: todo explicitly signals unimplemented, see migration doc");

  it.skipIf(
    !process.env.SOME_OPTIONAL_API_KEY,
    "compliant: conditional skip gated on env var, clearly signalled",
  );

  test.skipIf(false, "compliant: test.skipIf with explicit false is still a no-op skip, but syntactically valid");

  it("compliant: normal it() is always allowed", () => {
    expect("ok").toBe("ok");
  });
});
