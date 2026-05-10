import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../../src/scheduler/scheduler-service.js", () => ({
  getSchedulerService: vi.fn(),
}));

vi.mock("../../src/inbox/inbox-service.js", () => ({
  getInboxService: vi.fn(),
}));

vi.mock("../../src/inbox/delivery-router.js", () => ({
  getDeliveryRouter: vi.fn(),
}));

vi.mock("../../src/engine/execution-engine.js", () => ({
  getGlobalExecutionEngine: vi.fn(),
}));

vi.mock("../../src/db/user-repository.js", () => ({
  getUserById: vi.fn().mockResolvedValue({ email: "user@example.com" }),
}));

import { getSchedulerService } from "../../src/scheduler/scheduler-service.js";
import { getInboxService } from "../../src/inbox/inbox-service.js";
import { getDeliveryRouter } from "../../src/inbox/delivery-router.js";
import { getGlobalExecutionEngine } from "../../src/engine/execution-engine.js";
import { processScheduleJob } from "../../src/scheduler/scheduler-worker.js";

describe("scheduler-worker (P1)", () => {
  let mockScheduler: any;
  let mockInbox: any;
  let mockDeliveryRouter: any;
  let mockEngine: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScheduler = {
      getEvent: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    mockInbox = {
      createItem: vi.fn().mockResolvedValue(undefined),
    };
    mockDeliveryRouter = {
      deliverToChat: vi.fn().mockResolvedValue(undefined),
    };
    mockEngine = {
      execute: vi.fn().mockResolvedValue({ success: true }),
    };

    vi.mocked(getSchedulerService).mockReturnValue(mockScheduler);
    vi.mocked(getInboxService).mockReturnValue(mockInbox);
    vi.mocked(getDeliveryRouter).mockReturnValue(mockDeliveryRouter);
    vi.mocked(getGlobalExecutionEngine).mockReturnValue(mockEngine);
  });

  it("should do nothing when event not found", async () => {
    mockScheduler.getEvent.mockResolvedValue(null);

    await processScheduleJob({ eventId: "sched_missing" });

    expect(mockScheduler.updateStatus).not.toHaveBeenCalled();
  });

  it("should do nothing when event is cancelled", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      status: "cancelled",
      actionConfig: { type: "inbox", payload: {} },
    });

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockScheduler.updateStatus).not.toHaveBeenCalled();
  });

  it("should execute inbox action", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      userId: "user_1",
      status: "pending",
      type: "reminder",
      actionConfig: {
        type: "inbox",
        payload: { title: "Test Reminder", content: "Hello" },
      },
      retryCount: 0,
    });

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockScheduler.updateStatus).toHaveBeenCalledWith("sched_abc", "triggered", expect.any(Number));
    expect(mockInbox.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        title: "Test Reminder",
        description: "Hello",
      })
    );
    expect(mockScheduler.updateStatus).toHaveBeenCalledWith("sched_abc", "completed", undefined);
  });

  it("should execute chat action", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      userId: "user_1",
      status: "pending",
      type: "reminder",
      actionConfig: {
        type: "chat",
        payload: { title: "Chat Msg", text: "Hello" },
      },
      retryCount: 0,
    });

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockDeliveryRouter.deliverToChat).toHaveBeenCalled();
  });

  it("should execute email action", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      userId: "user_1",
      status: "pending",
      type: "reminder",
      actionConfig: {
        type: "email",
        payload: { to: "test@example.com", subject: "Test", body: "Content" },
      },
      retryCount: 0,
    });

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockEngine.execute).toHaveBeenCalledWith(
      "email_send",
      expect.objectContaining({
        to: "test@example.com",
        subject: "Test",
        body: "Content",
      })
    );
  });

  it("should execute im action", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      userId: "user_1",
      status: "pending",
      type: "reminder",
      actionConfig: {
        type: "im",
        payload: { content: "IM message" },
      },
      retryCount: 0,
    });

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockEngine.execute).toHaveBeenCalledWith(
      "im_bot_send",
      expect.objectContaining({ content: "IM message" })
    );
  });

  it("should handle unknown action type gracefully", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      userId: "user_1",
      status: "pending",
      type: "reminder",
      actionConfig: {
        type: "unknown",
        payload: {},
      },
      retryCount: 0,
    });

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockScheduler.updateStatus).toHaveBeenCalledWith("sched_abc", "completed", undefined);
  });

  it("should mark as failed when action throws", async () => {
    mockScheduler.getEvent.mockResolvedValue({
      id: "sched_abc",
      userId: "user_1",
      status: "pending",
      type: "reminder",
      actionConfig: {
        type: "inbox",
        payload: {},
      },
      retryCount: 0,
    });
    mockInbox.createItem.mockRejectedValue(new Error("Inbox down"));

    await processScheduleJob({ eventId: "sched_abc" });

    expect(mockScheduler.updateStatus).toHaveBeenCalledWith("sched_abc", "failed", undefined);
  });
});
