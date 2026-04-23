import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { WorkflowEngine, SimpleGuardEngine } from "../../src/workflow/engine.js";
import { SQLiteWorkflowRepository, setWorkflowRepository, resetWorkflowRepository } from "../../src/workflow/repository.js";
import type { WorkflowSpec } from "../../src/workflow/types.js";
import * as userRepo from "../../src/db/user-repository.js";
import * as deptRepo from "../../src/db/department-repository.js";

vi.mock("../../src/db/user-repository.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/db/user-repository.js")>("../../src/db/user-repository.js");
  return {
    ...actual,
    getUserById: vi.fn(),
    getUsersByRole: vi.fn(),
    getUsersByDepartment: vi.fn(),
    getUserRoles: vi.fn(),
    getUserDepartment: vi.fn(),
  };
});

vi.mock("../../src/db/department-repository.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/db/department-repository.js")>("../../src/db/department-repository.js");
  return {
    ...actual,
    getDepartmentById: vi.fn(),
  };
});

function createMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workflow_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      category TEXT,
      definition TEXT NOT NULL,
      form_schema TEXT,
      created_by TEXT,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      definition_id INTEGER NOT NULL,
      definition_version INTEGER NOT NULL DEFAULT 1,
      business_key TEXT,
      starter TEXT,
      status TEXT NOT NULL,
      current_node_id TEXT,
      variables TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE workflow_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      node_name TEXT,
      task_type TEXT NOT NULL,
      assignee TEXT,
      candidate_users TEXT,
      candidate_groups TEXT,
      status TEXT NOT NULL,
      form_data TEXT,
      comment TEXT,
      action TEXT,
      due_date INTEGER,
      sign_group TEXT,
      created_at INTEGER NOT NULL,
      claimed_at INTEGER,
      completed_at INTEGER
    );
    CREATE TABLE workflow_variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      type TEXT,
      UNIQUE(instance_id, name)
    );
    CREATE TABLE connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      credentials TEXT,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
  `);
  return db;
}

describe("WorkflowEngine", () => {
  let db: Database.Database;
  let repo: SQLiteWorkflowRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    db = createMemoryDb();
    repo = new SQLiteWorkflowRepository(db);
    setWorkflowRepository(repo);
    engine = new WorkflowEngine();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    db.close();
    resetWorkflowRepository();
  });

  async function createDefinition(spec: WorkflowSpec) {
    return await repo.createDefinition({
      name: spec.name,
      key: spec.key,
      version: 1,
      definition: spec,
    });
  }

  describe("SimpleGuardEngine", () => {
    const guard = new SimpleGuardEngine();

    it("evaluates 'default' as true", async () => {
      expect(guard.evaluate("default", { variables: {}, instance: { id: 1 } as any })).toBe(true);
    });

    it("evaluates numeric comparisons", async () => {
      expect(guard.evaluate("${amount} >= 5000", { variables: { amount: 6000 }, instance: { id: 1 } as any })).toBe(true);
      expect(guard.evaluate("${amount} >= 5000", { variables: { amount: 4000 }, instance: { id: 1 } as any })).toBe(false);
    });

    it("evaluates string equality", async () => {
      expect(guard.evaluate("${type} == 'sick'", { variables: { type: "sick" }, instance: { id: 1 } as any })).toBe(true);
      expect(guard.evaluate("${type} == 'sick'", { variables: { type: "annual" }, instance: { id: 1 } as any })).toBe(false);
    });

    it("resolves nested object paths", async () => {
      expect(guard.evaluate("${user.age} >= 18", { variables: { user: { age: 20 } }, instance: { id: 1 } as any })).toBe(true);
      expect(guard.evaluate("${user.age} >= 18", { variables: { user: { age: 16 } }, instance: { id: 1 } as any })).toBe(false);
    });

    it("returns false for invalid expressions safely", async () => {
      expect(guard.evaluate("${missing} >", { variables: {}, instance: { id: 1 } as any })).toBe(false);
    });
  });

  describe("startInstance", () => {
    it("returns error when definition not found", async () => {
      const result = await engine.startInstance("missing", "user1");
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("not found");
    });

    it("returns error when definition lacks start_event", async () => {
      await createDefinition({
        key: "no_start",
        name: "No Start",
        nodes: [{ id: "end", type: "end_event" }],
      });
      const result = await engine.startInstance("no_start", "user1");
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("start_event");
    });

    it("starts and advances to user_task", async () => {
      await createDefinition({
        key: "approval",
        name: "Approval",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "Review", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approval", "user1", { amount: 100 });
      expect(result.success).toBe(true);
      expect(result.instance!.status).toBe("running");
      expect(result.instance!.currentNodeId).toBe("task1");
      expect(result.task).toBeDefined();
      expect(result.task!.nodeId).toBe("task1");
      expect(result.task!.status).toBe("pending");

      const vars = await repo.getVariables(result.instance!.id);
      expect(vars.amount).toBe(100);
      expect(vars.starter).toEqual({ id: "user1" });
    });

    it("starts and advances through service_task to end", async () => {
      await createDefinition({
        key: "auto",
        name: "Auto",
        nodes: [
          { id: "start", type: "start_event", next: "svc" },
          { id: "svc", type: "service_task", name: "Notify", service: "email", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("auto", "user1");
      expect(result.success).toBe(true);
      expect(result.instance!.status).toBe("completed");
    });
  });

  describe("advance", () => {
    it("returns error for non-existent instance", async () => {
      const result = await engine.advance(99999);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("not found");
    });

    it("returns error for completed instance", async () => {
      await createDefinition({
        key: "done",
        name: "Done",
        nodes: [
          { id: "start", type: "start_event", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const start = await engine.startInstance("done", "user1");
      expect(start.success).toBe(true);
      const result = await engine.advance(start.instance!.id);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("completed");
    });
  });

  describe("completeTask", () => {
    beforeEach(async () => {
      await createDefinition({
        key: "approval",
        name: "Approval",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "Review", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
    });

    it("completes task and advances to end", async () => {
      const start = await engine.startInstance("approval", "user1");
      const taskId = start.task!.id;
      const result = await engine.completeTask(taskId, { action: "approve", formData: { comment: "OK" } });
      expect(result.success).toBe(true);
      expect(result.instance!.status).toBe("completed");
      expect(result.task!.status).toBe("completed");
      expect(result.task!.action).toBe("approve");

      const vars = await repo.getVariables(start.instance!.id);
      expect(vars.comment).toBe("OK");
    });

    it("rejects task and ends instance immediately", async () => {
      const start = await engine.startInstance("approval", "user1");
      const taskId = start.task!.id;
      const result = await engine.completeTask(taskId, { action: "reject" });
      expect(result.success).toBe(true);
      expect(result.instance!.status).toBe("completed");
      expect(result.task!.action).toBe("reject");
    });

    it("returns error for non-existent task", async () => {
      const result = await engine.completeTask(99999);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("not found");
    });
  });

  describe("claimTask", () => {
    beforeEach(async () => {
      await createDefinition({
        key: "approval",
        name: "Approval",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "Review", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
    });

    it("claims a pending task", async () => {
      const start = await engine.startInstance("approval", "user1");
      const result = await engine.claimTask(start.task!.id, "user2");
      expect(result.success).toBe(true);
      expect(result.task!.status).toBe("claimed");
      expect(result.task!.assignee).toBe("user2");
    });

    it("returns error for already claimed task", async () => {
      const start = await engine.startInstance("approval", "user1");
      await engine.claimTask(start.task!.id, "user2");
      const result = await engine.claimTask(start.task!.id, "user3");
      expect(result.success).toBe(false);
    });
  });

  describe("transferTask", () => {
    beforeEach(async () => {
      await createDefinition({
        key: "approval",
        name: "Approval",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "Review", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
    });

    it("transfers task to another user", async () => {
      const start = await engine.startInstance("approval", "user1");
      const result = await engine.transferTask(start.task!.id, "user3", "handover");
      expect(result.success).toBe(true);
      expect(result.task!.assignee).toBe("user3");
    });
  });

  describe("cancelInstance", () => {
    beforeEach(async () => {
      await createDefinition({
        key: "approval",
        name: "Approval",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "Review", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
    });

    it("cancels running instance and tasks", async () => {
      const start = await engine.startInstance("approval", "user1");
      const result = await engine.cancelInstance(start.instance!.id, "cancelled by user");
      expect(result.success).toBe(true);
      expect(result.instance!.status).toBe("cancelled");

      const tasks = await repo.listTasks({ instanceId: start.instance!.id });
      expect(tasks.items.every((t) => t.status === "cancelled")).toBe(true);
    });

    it("returns error for non-existent instance", async () => {
      const result = await engine.cancelInstance(99999);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("not found");
    });
  });

  describe("ExclusiveGateway", () => {
    it("routes by condition match", async () => {
      await createDefinition({
        key: "gateway",
        name: "Gateway",
        nodes: [
          { id: "start", type: "start_event", next: "gw" },
          {
            id: "gw",
            type: "exclusive_gateway",
            conditions: [
              { expression: "${amount} >= 1000", next: "high" },
              { expression: "default", next: "low" },
            ],
          },
          { id: "high", type: "user_task", name: "High", next: "end" },
          { id: "low", type: "user_task", name: "Low", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const result = await engine.startInstance("gateway", "user1", { amount: 2000 });
      expect(result.success).toBe(true);
      expect(result.task!.nodeId).toBe("high");
    });

    it("routes by default when no condition matches", async () => {
      await createDefinition({
        key: "gateway",
        name: "Gateway",
        nodes: [
          { id: "start", type: "start_event", next: "gw" },
          {
            id: "gw",
            type: "exclusive_gateway",
            conditions: [
              { expression: "${amount} >= 1000", next: "high" },
              { expression: "default", next: "low" },
            ],
          },
          { id: "high", type: "user_task", name: "High", next: "end" },
          { id: "low", type: "user_task", name: "Low", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const result = await engine.startInstance("gateway", "user1", { amount: 500 });
      expect(result.success).toBe(true);
      expect(result.task!.nodeId).toBe("low");
    });

    it("returns error when no condition matches and no default", async () => {
      await createDefinition({
        key: "gateway",
        name: "Gateway",
        nodes: [
          { id: "start", type: "start_event", next: "gw" },
          {
            id: "gw",
            type: "exclusive_gateway",
            conditions: [
              { expression: "${amount} >= 1000", next: "high" },
            ],
          },
          { id: "high", type: "user_task", name: "High", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const result = await engine.startInstance("gateway", "user1", { amount: 500 });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("No matching condition");
    });
  });

  describe("ParallelGateway", () => {
    it("splits to first branch", async () => {
      await createDefinition({
        key: "parallel",
        name: "Parallel",
        nodes: [
          { id: "start", type: "start_event", next: "pg" },
          { id: "pg", type: "parallel_gateway", mode: "split", branches: ["b1", "b2"], next: "end" },
          { id: "b1", type: "user_task", name: "Branch1", next: "end" },
          { id: "b2", type: "user_task", name: "Branch2", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const result = await engine.startInstance("parallel", "user1");
      expect(result.success).toBe(true);
      expect(result.task!.nodeId).toBe("b1");
    });
  });

  describe("resolveAssignee", () => {
    it("resolves starter from variable", async () => {
      await createDefinition({
        key: "assign",
        name: "Assign",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task1", assigneePolicy: "starter", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const result = await engine.startInstance("assign", "user1");
      expect(result.task!.assignee).toBe("user1");
    });

    it("resolves starter.manager and starter.director", async () => {
      await createDefinition({
        key: "assign",
        name: "Assign",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task1", assignee: "user1", next: "t2" },
          { id: "t2", type: "user_task", name: "Task2", assigneePolicy: "starter.manager", next: "t3" },
          { id: "t3", type: "user_task", name: "Task3", assigneePolicy: "starter.director", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const start = await engine.startInstance("assign", "user1");
      // Override starter variable with manager/director info for downstream tasks
      await repo.setVariable(start.instance!.id, "starter", { id: "user1", manager: "mgr1", director: "dir1" }, "json");

      // task1 has fixed assignee
      expect(start.task!.assignee).toBe("user1");

      const r2 = await engine.completeTask(start.task!.id, { action: "approve" });
      expect(r2.task!.assignee).toBe("user1"); // completed task1

      const tasks2 = await repo.listTasks({ instanceId: start.instance!.id });
      const task2 = tasks2.items.find((t) => t.nodeId === "t2" && t.status === "pending");
      expect(task2?.assignee).toBe("mgr1");

      const r3 = await engine.completeTask(task2!.id, { action: "approve" });
      expect(r3.task!.assignee).toBe("mgr1"); // completed task2

      const tasks3 = await repo.listTasks({ instanceId: start.instance!.id });
      const task3 = tasks3.items.find((t) => t.nodeId === "t3" && t.status === "pending");
      expect(task3?.assignee).toBe("dir1");
    });
  });

  describe("parseDuration", () => {
    it("parses PT2H correctly", async () => {
      await createDefinition({
        key: "dur",
        name: "Duration",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task", dueDuration: "PT2H", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const before = Date.now();
      const result = await engine.startInstance("dur", "user1");
      const after = Date.now();
      expect(result.task!.dueDate).toBeDefined();
      expect(result.task!.dueDate! - before).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 1000);
      expect(result.task!.dueDate! - after).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 1000);
    });

    it("parses P1D correctly", async () => {
      await createDefinition({
        key: "dur",
        name: "Duration",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task", dueDuration: "P1D", next: "end" },
          { id: "end", type: "end_event" },
        ],
      });

      const before = Date.now();
      const result = await engine.startInstance("dur", "user1");
      const after = Date.now();
      expect(result.task!.dueDate).toBeDefined();
      expect(result.task!.dueDate! - before).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(result.task!.dueDate! - after).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    });
  });

  // ===== Phase 2: 会签测试 =====

  describe("SignPolicy", () => {
    const signSpec = (condition: string, minCount?: number): WorkflowSpec => ({
      key: "sign",
      name: "Sign",
      nodes: [
        { id: "start", type: "start_event", next: "task1" },
        {
          id: "task1",
          type: "user_task",
          name: "Review",
          approvers: [
            { type: "user", value: "userA" },
            { type: "user", value: "userB" },
            { type: "user", value: "userC" },
          ],
          signPolicy: { mode: "parallel", condition: condition as any, minCount },
          next: "end",
        },
        { id: "end", type: "end_event" },
      ],
    });

    it("any: one approval advances and cancels others", async () => {
      await createDefinition(signSpec("any"));
      const start = await engine.startInstance("sign", "starter1");
      expect(start.success).toBe(true);

      // 3 pending tasks
      const tasksBefore = await repo.listTasks({ instanceId: start.instance!.id });
      const pendingBefore = tasksBefore.items.filter((t) => t.status === "pending");
      expect(pendingBefore.length).toBe(3);

      // userA approves
      const taskA = pendingBefore.find((t) => t.assignee === "userA")!;
      const r1 = await engine.completeTask(taskA.id, { action: "approve" });
      expect(r1.success).toBe(true);

      // instance completed, other tasks cancelled
      const tasksAfter = await repo.listTasks({ instanceId: start.instance!.id });
      expect(tasksAfter.items.some((t) => t.status === "completed" && t.assignee === "userA")).toBe(true);
      expect(tasksAfter.items.filter((t) => t.status === "cancelled").length).toBe(2);

      const inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("completed");
    });

    it("all: all approvals required to advance", async () => {
      await createDefinition(signSpec("all"));
      const start = await engine.startInstance("sign", "starter1");
      expect(start.success).toBe(true);

      const tasksBefore = await repo.listTasks({ instanceId: start.instance!.id });
      const pendingBefore = tasksBefore.items.filter((t) => t.status === "pending");
      expect(pendingBefore.length).toBe(3);

      // userA approves — not enough
      const taskA = pendingBefore.find((t) => t.assignee === "userA")!;
      const r1 = await engine.completeTask(taskA.id, { action: "approve" });
      expect(r1.success).toBe(true);
      let inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("running");

      // userB approves — not enough
      const taskB = pendingBefore.find((t) => t.assignee === "userB")!;
      const r2 = await engine.completeTask(taskB.id, { action: "approve" });
      expect(r2.success).toBe(true);
      inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("running");

      // userC approves — now advance
      const taskC = pendingBefore.find((t) => t.assignee === "userC")!;
      const r3 = await engine.completeTask(taskC.id, { action: "approve" });
      expect(r3.success).toBe(true);
      inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("completed");
    });

    it("majority: advances when minCount reached", async () => {
      await createDefinition(signSpec("majority", 2));
      const start = await engine.startInstance("sign", "starter1");
      expect(start.success).toBe(true);

      const tasksBefore = await repo.listTasks({ instanceId: start.instance!.id });
      const pendingBefore = tasksBefore.items.filter((t) => t.status === "pending");
      expect(pendingBefore.length).toBe(3);

      // 1 approval — not enough
      const taskA = pendingBefore.find((t) => t.assignee === "userA")!;
      await engine.completeTask(taskA.id, { action: "approve" });
      let inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("running");

      // 2 approvals — majority reached
      const taskB = pendingBefore.find((t) => t.assignee === "userB")!;
      await engine.completeTask(taskB.id, { action: "approve" });
      inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("completed");
    });

    it("reject ends instance immediately in sign group", async () => {
      await createDefinition(signSpec("all"));
      const start = await engine.startInstance("sign", "starter1");
      const tasksBefore = await repo.listTasks({ instanceId: start.instance!.id });
      const pendingBefore = tasksBefore.items.filter((t) => t.status === "pending");

      const taskA = pendingBefore.find((t) => t.assignee === "userA")!;
      const r1 = await engine.completeTask(taskA.id, { action: "reject" });
      expect(r1.success).toBe(true);

      const inst = await repo.getInstanceById(start.instance!.id);
      expect(inst!.status).toBe("completed");
    });
  });

  // ===== Phase 2: 审批人策略测试 =====

  describe("Approver Strategies", () => {
    const mockUser = (id: string, deptId: string | null = null): userRepo.User => ({
      id,
      username: id,
      displayName: id,
      avatar: "",
      phone: "",
      email: "",
      departmentId: deptId,
      status: "active",
      createdAt: 0,
      updatedAt: 0,
      lastLoginAt: null,
    });

    it("user: assigns specified user", async () => {
      await createDefinition({
        key: "approver_user",
        name: "Approver User",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task", approvers: [{ type: "user", value: "specifiedUser" }], next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_user", "starter1");
      expect(result.task!.assignee).toBe("specifiedUser");
    });

    it("starter: assigns instance starter", async () => {
      await createDefinition({
        key: "approver_starter",
        name: "Approver Starter",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task", approvers: [{ type: "starter" }], next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_starter", "starter1");
      expect(result.task!.assignee).toBe("starter1");
    });

    it("starter_manager: resolves manager of starter's department", async () => {
      vi.mocked(userRepo.getUserById).mockResolvedValue(mockUser("starter1", "dept1"));
      vi.mocked(userRepo.getUsersByDepartment).mockResolvedValue([
        mockUser("mgr1", "dept1"),
        mockUser("emp1", "dept1"),
      ]);
      vi.mocked(userRepo.getUserRoles).mockImplementation(async (uid: string) => {
        if (uid === "mgr1") return [{ id: "r1", name: "manager", description: "" }];
        return [{ id: "r2", name: "employee", description: "" }];
      });

      await createDefinition({
        key: "approver_mgr",
        name: "Approver Manager",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task", approvers: [{ type: "starter_manager" }], next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_mgr", "starter1");
      expect(result.task!.assignee).toBe("mgr1");
    });

    it("starter_director: resolves director from parent department", async () => {
      vi.mocked(userRepo.getUserById).mockResolvedValue(mockUser("starter1", "dept1"));
      vi.mocked(deptRepo.getDepartmentById).mockResolvedValue({ id: "dept1", name: "Dept1", parentId: "dept2", path: "dept2/dept1", createdAt: 0, updatedAt: 0 } as any);
      vi.mocked(userRepo.getUsersByDepartment).mockImplementation(async (did: string) => {
        if (did === "dept2") return [mockUser("dir1", "dept2")];
        return [mockUser("mgr1", did)];
      });
      vi.mocked(userRepo.getUserRoles).mockImplementation(async (uid: string) => {
        if (uid === "dir1") return [{ id: "r1", name: "director", description: "" }];
        return [{ id: "r2", name: "manager", description: "" }];
      });

      await createDefinition({
        key: "approver_dir",
        name: "Approver Director",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          { id: "t1", type: "user_task", name: "Task", approvers: [{ type: "starter_director" }], next: "end" },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_dir", "starter1");
      expect(result.task!.assignee).toBe("dir1");
    });

    it("role: assigns all users with the role", async () => {
      vi.mocked(userRepo.getUsersByRole).mockResolvedValue([
        mockUser("roleUser1", "dept1"),
        mockUser("roleUser2", "dept2"),
      ]);

      await createDefinition({
        key: "approver_role",
        name: "Approver Role",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          {
            id: "t1",
            type: "user_task",
            name: "Task",
            approvers: [{ type: "role", value: "role1" }],
            signPolicy: { mode: "parallel", condition: "all" },
            next: "end",
          },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_role", "starter1");
      // multi-user triggers sign group
      const tasks = await repo.listTasks({ instanceId: result.instance!.id });
      const pending = tasks.items.filter((t) => t.status === "pending");
      expect(pending.length).toBe(2);
      expect(pending.map((t) => t.assignee).sort()).toEqual(["roleUser1", "roleUser2"]);
    });

    it("role_dept: filters users by department", async () => {
      vi.mocked(userRepo.getUsersByRole).mockResolvedValue([
        mockUser("roleUser1", "dept1"),
        mockUser("roleUser2", "dept2"),
      ]);

      await createDefinition({
        key: "approver_role_dept",
        name: "Approver Role Dept",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          {
            id: "t1",
            type: "user_task",
            name: "Task",
            approvers: [{ type: "role_dept", value: "role1", deptId: "dept1" }],
            next: "end",
          },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_role_dept", "starter1");
      expect(result.task!.assignee).toBe("roleUser1");
    });

    it("expression: evaluates to user id", async () => {
      await createDefinition({
        key: "approver_expr",
        name: "Approver Expression",
        nodes: [
          { id: "start", type: "start_event", next: "t1" },
          {
            id: "t1",
            type: "user_task",
            name: "Task",
            approvers: [{ type: "expression", value: "${approverId}" }],
            next: "end",
          },
          { id: "end", type: "end_event" },
        ],
      });
      const result = await engine.startInstance("approver_expr", "starter1", { approverId: "exprUser" });
      expect(result.task!.assignee).toBe("exprUser");
    });
  });

  // ===== Phase 2: 发起人限制测试 =====

  describe("Starter Constraints", () => {
    it("filterAvailableDefinitions: includes defs without constraints", async () => {
      await createDefinition({ key: "open", name: "Open", nodes: [{ id: "s", type: "start_event", next: "e" }, { id: "e", type: "end_event" }] });
      const defs = await repo.listDefinitions();
      const filtered = await engine.filterAvailableDefinitions(defs, "anyUser");
      expect(filtered.some((d) => d.definition.key === "open")).toBe(true);
    });

    it("filterAvailableDefinitions: filters by role constraint", async () => {
      vi.mocked(userRepo.getUserRoles).mockResolvedValue([{ id: "admin", name: "Admin", description: "" }]);
      await createDefinition({
        key: "admin_only",
        name: "Admin Only",
        starterConstraints: [{ type: "role", value: "admin" }],
        nodes: [{ id: "s", type: "start_event", next: "e" }, { id: "e", type: "end_event" }],
      });
      const defs = await repo.listDefinitions();
      const filtered = await engine.filterAvailableDefinitions(defs, "user1");
      expect(filtered.some((d) => d.definition.key === "admin_only")).toBe(true);

      // user without admin role
      vi.mocked(userRepo.getUserRoles).mockResolvedValue([{ id: "user", name: "User", description: "" }]);
      const filtered2 = await engine.filterAvailableDefinitions(defs, "user2");
      expect(filtered2.some((d) => d.definition.key === "admin_only")).toBe(false);
    });

    it("filterAvailableDefinitions: filters by department constraint", async () => {
      vi.mocked(userRepo.getUserById).mockResolvedValue({
        id: "user1", username: "u1", displayName: "U1", avatar: "", phone: "", email: "",
        departmentId: "deptA", status: "active", createdAt: 0, updatedAt: 0, lastLoginAt: null,
      });
      await createDefinition({
        key: "dept_a_only",
        name: "Dept A Only",
        starterConstraints: [{ type: "department", value: "deptA" }],
        nodes: [{ id: "s", type: "start_event", next: "e" }, { id: "e", type: "end_event" }],
      });
      const defs = await repo.listDefinitions();
      const filtered = await engine.filterAvailableDefinitions(defs, "user1");
      expect(filtered.some((d) => d.definition.key === "dept_a_only")).toBe(true);

      // user from different department
      vi.mocked(userRepo.getUserById).mockResolvedValue({
        id: "user2", username: "u2", displayName: "U2", avatar: "", phone: "", email: "",
        departmentId: "deptB", status: "active", createdAt: 0, updatedAt: 0, lastLoginAt: null,
      });
      const filtered2 = await engine.filterAvailableDefinitions(defs, "user2");
      expect(filtered2.some((d) => d.definition.key === "dept_a_only")).toBe(false);
    });
  });
});
