import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../src/scheduler/scheduler-service.js", () => ({
  getSchedulerService: vi.fn(),
  SchedulerService: vi.fn(),
}));

import { getSchedulerService } from "../../src/scheduler/scheduler-service.js";
import schedulerRouter from "../../src/scheduler/scheduler-routes.js";

describe("scheduler-routes (P1)", () => {
  let app: express.Application;
  let mockService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      createEvent: vi.fn(),
      listEvents: vi.fn(),
      getEvent: vi.fn(),
      cancelEvent: vi.fn(),
      triggerNow: vi.fn(),
    };
    vi.mocked(getSchedulerService).mockReturnValue(mockService);

    app = express();
    app.use(express.json());
    // Mock auth middleware
    app.use((req, res, next) => {
      (req as any).user = { id: "user_test" };
      next();
    });
    app.use(schedulerRouter);
  });

  describe("POST /schedule", () => {
    it("should create a scheduled event", async () => {
      const event = {
        id: "sched_abc",
        userId: "user_test",
        type: "reminder",
        triggerConfig: { mode: "relative", delayMs: 1000 },
        actionConfig: { type: "inbox", payload: {} },
        status: "pending",
      };
      mockService.createEvent.mockResolvedValue(event);

      const res = await request(app)
        .post("/schedule")
        .send({
          type: "reminder",
          triggerConfig: { mode: "relative", delayMs: 1000 },
          actionConfig: { type: "inbox", payload: {} },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("sched_abc");
    });

    it("should return 400 for missing fields", async () => {
      const res = await request(app)
        .post("/schedule")
        .send({ type: "reminder" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Missing required fields");
    });

    it("should return 500 on service error", async () => {
      mockService.createEvent.mockRejectedValue(new Error("Redis down"));

      const res = await request(app)
        .post("/schedule")
        .send({
          type: "reminder",
          triggerConfig: { mode: "relative", delayMs: 1000 },
          actionConfig: { type: "inbox", payload: {} },
        });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /schedule", () => {
    it("should list events", async () => {
      mockService.listEvents.mockResolvedValue({
        items: [{ id: "sched_1", type: "reminder" }],
        total: 1,
      });

      const res = await request(app).get("/schedule?page=1&pageSize=10");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(mockService.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_test", page: 1, pageSize: 10 })
      );
    });
  });

  describe("GET /schedule/:id", () => {
    it("should return event details", async () => {
      mockService.getEvent.mockResolvedValue({
        id: "sched_abc",
        userId: "user_test",
        type: "reminder",
        status: "pending",
      });

      const res = await request(app).get("/schedule/sched_abc");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("sched_abc");
    });

    it("should return 404 for non-existent event", async () => {
      mockService.getEvent.mockResolvedValue(null);

      const res = await request(app).get("/schedule/sched_missing");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /schedule/:id", () => {
    it("should cancel an event", async () => {
      mockService.getEvent.mockResolvedValue({ id: "sched_abc", userId: "user_test" });
      mockService.cancelEvent.mockResolvedValue(true);

      const res = await request(app).delete("/schedule/sched_abc");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /schedule/:id/trigger", () => {
    it("should trigger an event manually", async () => {
      mockService.getEvent.mockResolvedValue({ id: "sched_abc", userId: "user_test" });
      mockService.triggerNow.mockResolvedValue(undefined);

      const res = await request(app).post("/schedule/sched_abc/trigger");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
