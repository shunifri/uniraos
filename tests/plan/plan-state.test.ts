import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  getUserPlanDir,
  createPlan,
  readPlan,
  listPlans,
  getPlanProgress,
  updateStepStatus,
  updatePlanStatus,
  deletePlan,
  pausePlan,
  resumePlan,
  cancelPlan,
} from "../../src/plan/plan-state.js";

const TEST_USER = "test_user_plan";
const TEST_DIR = resolve(process.cwd(), ".raos", "workspace", TEST_USER, "plans");

describe("Plan State", () => {
  beforeEach(() => {
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("should create user plan directory", () => {
    const dir = getUserPlanDir(TEST_USER);
    expect(dir).toBe(TEST_DIR);
    expect(existsSync(dir)).toBe(true);
  });

  it("should create a new plan", () => {
    const result = createPlan(
      {
        title: "Test Plan",
        content: "- [ ] Step 1: Do something\n- [ ] Step 2: Do another thing",
      },
      TEST_USER
    );

    expect(result.isNew).toBe(true);
    expect(result.plan.meta.title).toBe("Test Plan");
    expect(result.plan.meta.status).toBe("draft");
    expect(result.plan.steps).toHaveLength(2);
    expect(existsSync(join(TEST_DIR, result.fileName))).toBe(true);
  });

  it("should reuse existing plan with same title", () => {
    createPlan(
      { title: "Reuse Plan", content: "- [ ] Step 1: Test" },
      TEST_USER
    );

    const result = createPlan(
      { title: "Reuse Plan", content: "- [ ] Step 1: Test" },
      TEST_USER
    );

    expect(result.isNew).toBe(false);
    expect(result.plan.meta.title).toBe("Reuse Plan");
  });

  it("should create new version when overwrite is false and existing is completed", async () => {
    const { fileName } = createPlan(
      { title: "Version Plan", content: "- [ ] Step 1: Test" },
      TEST_USER
    );

    // 标记为已完成
    await updatePlanStatus(fileName, "completed", undefined, TEST_USER);

    const result = createPlan(
      { title: "Version Plan", content: "- [ ] Step 1: Test v2" },
      TEST_USER
    );

    expect(result.isNew).toBe(true);
    expect(result.fileName).not.toBe(fileName);
  });

  it("should overwrite existing plan when overwrite=true", () => {
    createPlan(
      { title: "Overwrite Plan", content: "- [ ] Step 1: Old" },
      TEST_USER
    );

    const result = createPlan(
      { title: "Overwrite Plan", content: "- [ ] Step 1: New\n- [ ] Step 2: Extra", overwrite: true },
      TEST_USER
    );

    expect(result.isNew).toBe(true);
    expect(result.plan.steps).toHaveLength(2);
  });

  it("should read plan correctly", () => {
    const { fileName } = createPlan(
      { title: "Read Plan", content: "- [ ] Step 1: Read me" },
      TEST_USER
    );

    const plan = readPlan(fileName, TEST_USER);
    expect(plan.meta.title).toBe("Read Plan");
    expect(plan.steps[0].description).toBe("Read me");
  });

  it("should list plans with progress", () => {
    createPlan({ title: "Plan A", content: "- [x] Step 1: Done" }, TEST_USER);
    createPlan({ title: "Plan B", content: "- [ ] Step 1: Pending\n- [ ] Step 2: Pending" }, TEST_USER);

    const plans = listPlans(TEST_USER);
    expect(plans).toHaveLength(2);
    const progresses = plans.map((p) => p.progress).sort((a, b) => a - b);
    expect(progresses).toEqual([0, 100]);
  });

  it("should filter plans by status", async () => {
    const { fileName } = createPlan(
      { title: "Status Plan", content: "- [ ] Step 1: Test" },
      TEST_USER
    );
    await updatePlanStatus(fileName, "running", undefined, TEST_USER);

    createPlan({ title: "Draft Plan", content: "- [ ] Step 1: Draft" }, TEST_USER);

    const running = listPlans(TEST_USER).filter((p) => p.status === "running");
    expect(running).toHaveLength(1);
    expect(running[0].title).toBe("Status Plan");
  });

  it("should get plan progress details", () => {
    const { fileName } = createPlan(
      { title: "Progress Plan", content: "- [x] Step 1: Done\n- [~] Step 2: Running\n- [ ] Step 3: Pending" },
      TEST_USER
    );

    const progress = getPlanProgress(fileName, TEST_USER);
    expect(progress.summary.title).toBe("Progress Plan");
    expect(progress.summary.progress).toBe(33);
    expect(progress.steps).toHaveLength(3);
    expect(progress.steps[0].status).toBe("completed");
    expect(progress.steps[1].status).toBe("running");
  });

  it("should update step status and auto-update currentStep", async () => {
    const { fileName } = createPlan(
      { title: "Update Plan", content: "- [ ] Step 1\n- [ ] Step 2\n- [ ] Step 3" },
      TEST_USER
    );

    await updateStepStatus(fileName, 0, "completed", { result: "ok" }, TEST_USER);
    const plan1 = readPlan(fileName, TEST_USER);
    expect(plan1.steps[0].status).toBe("completed");
    expect(plan1.meta.currentStep).toBe(1);

    await updateStepStatus(fileName, 1, "failed", { error: "oops" }, TEST_USER);
    const plan2 = readPlan(fileName, TEST_USER);
    expect(plan2.steps[1].status).toBe("failed");
    expect(plan2.meta.status).toBe("failed");
  });

  it("should pause, resume, and cancel plan", async () => {
    const { fileName } = createPlan(
      { title: "Lifecycle Plan", content: "- [ ] Step 1" },
      TEST_USER
    );

    const paused = await pausePlan(fileName, TEST_USER);
    expect(paused.meta.status).toBe("paused");

    const resumed = await resumePlan(fileName, TEST_USER);
    expect(resumed.meta.status).toBe("running");

    const cancelled = await cancelPlan(fileName, TEST_USER);
    expect(cancelled.meta.status).toBe("cancelled");
  });

  it("should delete plan", () => {
    const { fileName } = createPlan(
      { title: "Delete Plan", content: "- [ ] Step 1" },
      TEST_USER
    );

    const deleted = deletePlan(fileName, TEST_USER);
    expect(deleted).toBe(true);
    expect(existsSync(join(TEST_DIR, fileName))).toBe(false);
  });

  it("should reject paths outside user directory", () => {
    expect(() => {
      readPlan("../other_user/plan.md", TEST_USER);
    }).toThrow("路径安全违规");
  });
});
