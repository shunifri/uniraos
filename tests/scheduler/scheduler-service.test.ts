import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Bull before importing scheduler-service
const mockJobRemove = vi.fn();
const mockJob = {
  remove: mockJobRemove,
  id: "test-job",
};

const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
const mockQueueGetJob = vi.fn().mockResolvedValue(null);
const mockQueueOn = vi.fn();

vi.mock("bull", () => ({
  default: class MockBull {
    add = mockQueueAdd;
    getJob = mockQueueGetJob;
    on = mockQueueOn;
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../../src/db/mysql-adapter.js", () => ({
  getMySQLAdapter: vi.fn(),
}));

vi.mock("../../src/config/db-config.js", () => ({
  dbConfig: {
    redis: {
      nodes: [{ host: "localhost", port: 6379 }],
      password: "",
    },
  },
}));

import { getMySQLAdapter } from "../../src/db/mysql-adapter.js";
import { SchedulerService, getSchedulerService } from "../../src/scheduler/scheduler-service.js";

describe("SchedulerService (P1)", () => {
  let service: SchedulerService;
  let mockAdapter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueAdd.mockClear();
    mockQueueGetJob.mockClear();
    mockJobRemove.mockClear();

    mockAdapter = {
      execute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
      query: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getMySQLAdapter).mockReturnValue(mockAdapter);

    service = new SchedulerService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createEvent", () => {
    it("should create an absolute time event", async () => {
      const futureTime = Date.now() + 3600000;
      const event = await service.createEvent({
        userId: "user_1",
        type: "reminder",
        triggerConfig: { mode: "absolute", at: futureTime },
        actionConfig: { type: "inbox", payload: { title: "Test" } },
        source: "user",
      });

      expect(event.id).toMatch(/^sched_[a-f0-9]+/);
      expect(event.userId).toBe("user_1");
      expect(event.type).toBe("reminder");
      expect(event.status).toBe("pending");
      expect(mockQueueAdd).toHaveBeenCalledWith(
        { eventId: event.id },
        expect.objectContaining({
          delay: expect.any(Number),
          jobId: event.id,
          attempts: 3,
        })
      );
      expect(mockAdapter.execute).toHaveBeenCalled();
    });

    it("should create a relative delay event", async () => {
      const event = await service.createEvent({
        userId: "user_1",
        type: "deadline",
        triggerConfig: { mode: "relative", delayMs: 5000 },
        actionConfig: { type: "chat", payload: { text: "Hello" } },
        source: "workflow",
      });

      expect(event.type).toBe("deadline");
      expect(mockQueueAdd).toHaveBeenCalledWith(
        { eventId: event.id },
        expect.objectContaining({ delay: 5000 })
      );
    });

    it("should create a cron event", async () => {
      const event = await service.createEvent({
        userId: "user_1",
        type: "recurring",
        triggerConfig: { mode: "cron", cron: "0 9 * * *" },
        actionConfig: { type: "email", payload: { subject: "Daily" } },
        source: "system",
      });

      expect(event.type).toBe("recurring");
      expect(mockQueueAdd).toHaveBeenCalled();
    });

    it("should create a conditional event without queuing", async () => {
      const event = await service.createEvent({
        userId: "user_1",
        type: "conditional",
        triggerConfig: { mode: "conditional", condition: "x > 5" },
        actionConfig: { type: "skill", payload: { skillName: "test" } },
        source: "agent",
      });

      expect(event.type).toBe("conditional");
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it("should throw when Bull queue add fails", async () => {
      mockQueueAdd.mockRejectedValueOnce(new Error("Redis down"));

      await expect(
        service.createEvent({
          userId: "user_1",
          type: "reminder",
          triggerConfig: { mode: "relative", delayMs: 1000 },
          actionConfig: { type: "inbox", payload: {} },
          source: "user",
        })
      ).rejects.toThrow("Bull 队列添加失败");
    });
  });

  describe("cancelEvent / deleteEvent", () => {
    it("should cancel an existing event", async () => {
      mockQueueGetJob.mockResolvedValueOnce(mockJob);

      const result = await service.cancelEvent("sched_abc123");
      expect(result).toBe(true);
      expect(mockJobRemove).toHaveBeenCalled();
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        "DELETE FROM scheduled_events WHERE id = ?",
        ["sched_abc123"]
      );
    });

    it("should delete event even if job not in queue", async () => {
      mockQueueGetJob.mockResolvedValueOnce(null);

      const result = await service.deleteEvent("sched_abc123");
      expect(result).toBe(true);
      expect(mockJobRemove).not.toHaveBeenCalled();
      expect(mockAdapter.execute).toHaveBeenCalled();
    });
  });

  describe("getEvent", () => {
    it("should return event by id", async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          id: "sched_abc",
          user_id: "user_1",
          type: "reminder",
          trigger_config: JSON.stringify({ mode: "relative", delayMs: 1000 }),
          action_config: JSON.stringify({ type: "inbox", payload: {} }),
          escalation_config: null,
          source: "user",
          source_id: null,
          status: "pending",
          retry_count: 0,
          created_at: Date.now(),
        },
      ]);

      const event = await service.getEvent("sched_abc");
      expect(event).not.toBeNull();
      expect(event!.id).toBe("sched_abc");
      expect(event!.type).toBe("reminder");
    });

    it("should return null for non-existent event", async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const event = await service.getEvent("sched_missing");
      expect(event).toBeNull();
    });
  });

  describe("listEvents", () => {
    it("should list events with pagination", async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ total: 2 }])
        .mockResolvedValueOnce([
          {
            id: "sched_1",
            user_id: "user_1",
            type: "reminder",
            trigger_config: "{}",
            action_config: "{}",
            source: "user",
            status: "pending",
            retry_count: 0,
            created_at: Date.now(),
          },
          {
            id: "sched_2",
            user_id: "user_1",
            type: "deadline",
            trigger_config: "{}",
            action_config: "{}",
            source: "workflow",
            status: "completed",
            retry_count: 0,
            created_at: Date.now(),
          },
        ]);

      const result = await service.listEvents({ userId: "user_1", page: 1, pageSize: 10 });
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it("should filter by type and status", async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            id: "sched_1",
            user_id: "user_1",
            type: "reminder",
            trigger_config: "{}",
            action_config: "{}",
            source: "user",
            status: "pending",
            retry_count: 0,
            created_at: Date.now(),
          },
        ]);

      const result = await service.listEvents({
        userId: "user_1",
        type: "reminder",
        status: "pending",
      });
      expect(result.items).toHaveLength(1);
    });
  });

  describe("updateStatus", () => {
    it("should update status without triggeredAt", async () => {
      await service.updateStatus("sched_abc", "completed");
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        "UPDATE scheduled_events SET status = ? WHERE id = ?",
        ["completed", "sched_abc"]
      );
    });

    it("should update status with triggeredAt", async () => {
      const now = Date.now();
      await service.updateStatus("sched_abc", "triggered", now);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        "UPDATE scheduled_events SET status = ?, triggered_at = ? WHERE id = ?",
        ["triggered", now, "sched_abc"]
      );
    });
  });

  describe("triggerNow", () => {
    it("should trigger an event immediately", async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          id: "sched_abc",
          user_id: "user_1",
          type: "reminder",
          trigger_config: "{}",
          action_config: "{}",
          source: "user",
          status: "pending",
          retry_count: 0,
          created_at: Date.now(),
        },
      ]);

      await service.triggerNow("sched_abc");
      expect(mockQueueAdd).toHaveBeenCalledWith(
        { eventId: "sched_abc" },
        expect.objectContaining({ delay: 0 })
      );
    });

    it("should throw for non-existent event", async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await expect(service.triggerNow("sched_missing")).rejects.toThrow("Event not found");
    });
  });
});
