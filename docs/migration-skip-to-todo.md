# Migrating `*.skip()` to `*.todo()` in RAOS Tests

> **Status**: Active (ROADMAP-2026-Q3 item #3)
> **Owner**: Coder track `q3-w1-no-new-skip-lint`
> **Lint rule**: `local/no-new-skip` (see `eslint.config.js`)
> **CI gate**: `npm run lint:no-skip`

## Why this migration exists

vitest's `it.skip(...)` / `describe.skip(...)` / `it.only(...)` is a **silent failure mode**: a
test that fails inside `.skip` doesn't run, so the suite reports "X passed" without ever
exercising the skipped code. Over 19+ months, RAOS accumulated **31 such skips** — including
`tests/agents/react-agent.test.ts` (5 reflection), `tests/agents/timeout-protection.test.ts`
(11 timeouts), `tests/agents/dynamic-team.test.ts` (3 dynamic-team), plus historical
FLAKY / e2e / worker-process / performance skips.

The new ESLint rule makes this leak visible: any future `*.skip()` or `*.only()` in test
code is a hard error at lint time. The 31 historical skips are **grandfathered** with
`// eslint-disable-next-line local/no-new-skip` and a comment pointer to this doc.

## How to fix an existing skip

There are exactly three acceptable resolutions. Pick one, then delete the
`// eslint-disable-next-line` comment as well so future regressions re-trip the lint.

### Option A — fix the implementation (preferred)

```ts
// before
// eslint-disable-next-line local/no-new-skip -- legacy skip
it.skip("should detect loop and trigger reflection after same tool called 3 times", async () => {
  // TODO: reflection feature not yet implemented in ReactAgent
});

// after — implement the feature, then enable the test
it("should detect loop and trigger reflection after same tool called 3 times", async () => {
  const agent = new ReactAgent(mockProfile, deps, { reflectionEnabled: true });
  // ...
});
```

Use this when the underlying feature is small enough to ship in the same change.

### Option B — convert `.skip` to `.todo` (acceptable for genuinely deferred work)

```ts
// before
// eslint-disable-next-line local/no-new-skip -- legacy skip
it.skip("should produce corrected result after reflection", async () => {
  // TODO: reflection feature not yet implemented in ReactAgent
  // ... 200 lines of intended implementation ...
});

// after
it.todo("should produce corrected result after reflection");
```

`it.todo()` is the **honest placeholder**: it shows up in the vitest report as "todo"
(rather than hidden as a skipped pass), and the next reader sees it as an explicit
"TBD" rather than a silent gap. This is the correct choice when the feature is
substantially larger than the test and the test would just be a stub anyway.

### Option C — add a justified disable comment (last resort)

If you must add a real `.skip` (e.g. an environment-gated e2e that's slow in CI), add
a per-line disable comment that **explains why** and points to a tracking issue:

```ts
// eslint-disable-next-line local/no-new-skip -- env-gated e2e, see JIRA-1234
it.skip("DRY_RUN 模式: end-to-end 跳过 (npx tsx 启动慢，单测已覆盖 helper)", () => {});
```

The trailing `-- reason` is required: a bare disable is treated as a code smell in
review. Reviews should reject uncommented disables.

## How to write a NEW test that needs a placeholder

Use `it.todo(...)` from the start. Do NOT use `.skip` for a "TODO" — `.skip` is
for temporarily disabling a passing test, `.todo` is for declaring a missing one.

```ts
describe("MyFeature", () => {
  it("does the main thing correctly", () => {
    // real assertions here
  });

  it.todo("handles the edge case I'll add next sprint");

  // NEVER do this:
  // it.skip("handles the edge case I'll add next sprint");
  // → blocked by `local/no-new-skip` lint rule
});
```

## How to write a NEW test that's conditional on the environment

Use `it.skipIf(condition, ...)` or `it.runIf(condition, ...)`. The lint rule
recognises the `skipIf` / `runIf` suffix and does not flag it.

```ts
// OK — clearly env-gated
it.skipIf(!process.env.ANTHROPIC_API_KEY, "requires API key for LLM call");

// OK — even simpler with runIf
it.runIf(!!process.env.MYSQL_HOST, "needs MySQL up to exercise the migration");
```

Do not use these as silent kill-switches for code you don't feel like writing.
The condition should be a real runtime dependency, not a "I'll fix this later" flag.

## How the lint rule works

`local/no-new-skip` (see `eslint.config.js`) matches `CallExpression` AST nodes
where the callee is a non-computed `MemberExpression` like `it.skip` / `describe.only`.
It explicitly:

- **Allows** `it.todo` / `test.todo` / `describe.todo` (the honest alternative).
- **Allows** `it.skipIf` / `test.skipIf` / `it.runIf` (conditional, env-gated).
- **Allows** `process.env.X ? describe.skip : describe` (skip used as a value in a
  conditional expression, not a call). Verified against `tests/db/mysql-database.test.ts:13`
  and `tests/performance/kg-retrieval.benchmark.ts:11`.
- **Forbids** `it.skip` / `test.skip` / `describe.skip` / `it.only` / `test.only` /
  `describe.only` (severity `error`).
- **Respects** `// eslint-disable-next-line local/no-new-skip` (with a comment, please).

## CI gate

`npm run lint:no-skip` runs a minimal config that exercises **only** the new rule
against `tests/`. It exits non-zero on any new skip/only violation, and silently
passes when the tree is clean. Wire it into pre-commit / pre-merge in a follow-up
PR (the current repo doesn't have husky / lint-staged configured).

`npm run lint:no-skip:report` is the same gate but always exits 0 and just prints
a summary — useful for one-off audits.

## Current grandfathered skips (24, as of 2026-06-08)

> Line numbers are a moving target — the parallel Q3-1 track (`q3-w1-calibrate-4-29-doc`)
> is removing some legacy skips as part of the same Week 1-2 push. Always re-grep
> (`grep -nE "(it|test|describe)\.(skip|only)" tests/`) for the live list.

| File | Line (≈) | Reason |
|------|----------|--------|
| `tests/agents/react-agent.test.ts` | 408 | Reflection not implemented (3 left after Q3-1 fix removed 2) |
| `tests/agents/react-agent.test.ts` | 454 | Reflection not implemented |
| `tests/agents/react-agent.test.ts` | 567 | Reflection not implemented |
| `tests/agents/timeout-protection.test.ts` | 186 | runStream fallback not implemented (9 left after Q3-1 fix removed 2) |
| `tests/agents/timeout-protection.test.ts` | 263 | HierarchicalExecutor stepTimeout |
| `tests/agents/timeout-protection.test.ts` | 285 | Sub-agent stepTimeout |
| `tests/agents/timeout-protection.test.ts` | 314 | Agent stepTimeout |
| `tests/agents/timeout-protection.test.ts` | 358 | executeStream total timeout |
| `tests/agents/timeout-protection.test.ts` | 413 | executeStream manager stepTimeout |
| `tests/agents/timeout-protection.test.ts` | 440 | executeStream sub-agent stepTimeout |
| `tests/agents/timeout-protection.test.ts` | 474 | executeStream agent stepTimeout |
| `tests/agents/timeout-protection.test.ts` | 503 | cumulative totalTimeout |
| `tests/agents/dynamic-team.test.ts` | 64 | `analyzeTaskRequirements` not implemented |
| `tests/agents/dynamic-team.test.ts` | 108 | `formTeam` not implemented |
| `tests/agents/dynamic-team.test.ts` | 193 | `runTeamStream` team_formed event not emitted |
| `tests/workflow/engine.test.ts` | 385 | FLAKY: async task creation race |
| `tests/workflow/engine.test.ts` | 394 | FLAKY: async task creation race |
| `tests/workflow/engine.test.ts` | 416 | FLAKY: async task creation race |
| `tests/workflow/engine.test.ts` | 438 | FLAKY: async task creation race |
| `tests/scripts/relation-ontology-acceptance.test.ts` | 45 | e2e script slow in CI |
| `tests/scripts/relation-ontology-acceptance.test.ts` | 47 | e2e script slow in CI |
| `tests/scripts/relation-ontology-acceptance.test.ts` | 49 | e2e script slow in CI |
| `tests/workers/worker-process.test.ts` | 4 | Worker process harness not yet wired |
| `tests/routes/health-routes.test.ts` | 114 | prom-client `register.metrics()` times out in test env |

Plus 3 skips in `tests/performance/**` (already excluded by the eslint global
ignore pattern) and 1 conditional `.skip` value in `tests/performance/kg-retrieval.benchmark.ts`
(not a call expression — not matched by the rule).

The Q3 Week 5-8 backlog (ROADMAP-2026-Q3 item #7) is the natural follow-up to
reduce this list: 3 reflection + 11 timeout + 3 dynamic-team + 1 Parallel Gateway
need actual implementations before those disable comments can be removed.

## Verification commands

```bash
# The rule fires on a brand-new skip in any test file (gate mode)
cat > tests/_tmp.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
describe("t", () => { it.skip("x", () => {}); });
EOF
npm run lint:no-skip
#   ✗ lint:no-skip — found 1 new skip/only violation(s):
#     tests/_tmp.test.ts:3:3  Avoid `it.skip(...)` in new test code. ...
#   EXIT: 1
rm tests/_tmp.test.ts

# The rule does NOT fire on it.todo
cat > tests/_tmp.test.ts <<'EOF'
import { describe, it } from "vitest";
describe("t", () => { it.todo("x"); });
EOF
npm run lint:no-skip
#   ✓ lint:no-skip — no new it.skip/describe.skip/only in test code.
#   EXIT: 0
rm tests/_tmp.test.ts

# The bait file at tests/_test_lint.test.ts is the permanent demo of the rule:
npm run lint
#   → 3 errors from the bait file (it.skip, it.only, describe.skip) — this is
#     by design; the file exists to keep the rule honest.
```
