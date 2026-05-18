import { describe, it, expect } from "vitest";
import {
  parsePlan,
  serializePlan,
  createPlanContent,
  computeProgress,
} from "../../src/plan/plan-parser.js";
import type { PlanMeta } from "../../src/plan/plan-types.js";

describe("Plan Parser", () => {
  const samplePlan = `---
planId: plan_test123
title: Test Plan
status: running
createdAt: 1716000000000
updatedAt: 1716003600000
currentStep: 1
totalSteps: 3
tags: [feature, backend]
---

# Test Plan

## Task 1: Setup

- [x] **Step 1:** Install dependencies
  - **Result:** success
  - **Output:** Installed 5 packages
  - **FinishedAt:** 1716000000000

- [~] **Step 2:** Configure database
  - **StartedAt:** 1716003600000

## Task 2: Implementation

- [ ] **Step 3:** Run migration
`;

  it("should parse frontmatter correctly", () => {
    const plan = parsePlan(samplePlan);
    expect(plan.meta.planId).toBe("plan_test123");
    expect(plan.meta.title).toBe("Test Plan");
    expect(plan.meta.status).toBe("running");
    expect(plan.meta.createdAt).toBe(1716000000000);
    expect(plan.meta.currentStep).toBe(1);
    expect(plan.meta.totalSteps).toBe(3);
    expect(plan.meta.tags).toEqual(["feature", "backend"]);
  });

  it("should parse steps correctly", () => {
    const plan = parsePlan(samplePlan);
    expect(plan.steps).toHaveLength(3);

    const step1 = plan.steps[0];
    expect(step1.index).toBe(0);
    expect(step1.description).toBe("Install dependencies");
    expect(step1.status).toBe("completed");
    expect(step1.result).toBe("success");
    expect(step1.output).toBe("Installed 5 packages");
    expect(step1.finishedAt).toBe(1716000000000);

    const step2 = plan.steps[1];
    expect(step2.index).toBe(1);
    expect(step2.status).toBe("running");
    expect(step2.startedAt).toBe(1716003600000);

    const step3 = plan.steps[2];
    expect(step3.index).toBe(2);
    expect(step3.status).toBe("pending");
  });

  it("should group steps by task title", () => {
    const plan = parsePlan(samplePlan);
    expect(plan.steps[0].taskTitle).toBe("Setup");
    expect(plan.steps[1].taskTitle).toBe("Setup");
    expect(plan.steps[2].taskTitle).toBe("Implementation");
  });

  it("should serialize and parse round-trip", () => {
    const plan = parsePlan(samplePlan);
    const serialized = serializePlan(plan);
    const reparsed = parsePlan(serialized);

    expect(reparsed.meta.planId).toBe(plan.meta.planId);
    expect(reparsed.meta.title).toBe(plan.meta.title);
    expect(reparsed.meta.status).toBe(plan.meta.status);
    expect(reparsed.steps).toHaveLength(plan.steps.length);
    expect(reparsed.steps[0].status).toBe(plan.steps[0].status);
    expect(reparsed.steps[0].result).toBe(plan.steps[0].result);
  });

  it("should compute progress correctly", () => {
    const plan = parsePlan(samplePlan);
    expect(computeProgress(plan)).toBe(33); // 1/3 ≈ 33%

    const allDone = parsePlan(samplePlan.replace("- [~]", "- [x]").replace("- [ ]", "- [x]"));
    expect(computeProgress(allDone)).toBe(100);
  });

  it("should create plan from user content", () => {
    const content = `## Task 1
- [ ] Step 1: Do something
- [ ] Step 2: Do another thing
`;
    const md = createPlanContent("My Plan", content, ["test"]);
    const plan = parsePlan(md);

    expect(plan.meta.title).toBe("My Plan");
    expect(plan.meta.status).toBe("draft");
    expect(plan.meta.tags).toEqual(["test"]);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].description).toBe("Do something");
  });

  it("should handle plan without frontmatter", () => {
    const noFm = `# Simple Plan
- [ ] Step 1: First
- [x] Step 2: Second
`;
    const plan = parsePlan(noFm);
    expect(plan.meta.planId).toBeTruthy();
    expect(plan.meta.title).toBe("Simple Plan");
    expect(plan.steps).toHaveLength(2);
  });

  it("should handle failed and skipped steps", () => {
    const content = `---
planId: plan_fail
title: Failed Plan
status: failed
createdAt: 1716000000000
updatedAt: 1716000000000
currentStep: 1
totalSteps: 2
---

- [!] **Step 1:** Something bad
  - **Error:** Out of memory

- [-] **Step 2:** Skip this
`;
    const plan = parsePlan(content);
    expect(plan.steps[0].status).toBe("failed");
    expect(plan.steps[0].error).toBe("Out of memory");
    expect(plan.steps[1].status).toBe("skipped");
  });
});
