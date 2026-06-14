/**
 * Inbox Service Tests
 *
 * Tests for InboxService CRUD, aggregation, and callback logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InboxService, setAiReviewProviderGetter } from "../../src/inbox/inbox-service.js";
import type { InboxItem, CreateInboxItemInput, InboxStats } from "../../src/inbox/inbox-types.js";

// ─── Mocks ───

const mockRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findBySourceAndSourceId: vi.fn(),
  list: vi.fn(),
  updateStatus: vi.fn(),
  updateStatusIf: vi.fn(),
  updateAISuggestion: vi.fn(),
  getStats: vi.fn(),
  getUnreadCount: vi.fn(),
};

const mockRouter = {
  route: vi.fn(),
  deliverToChat: vi.fn(),
  deliverToInbox: vi.fn(),
  deliverToEmail: vi.fn(),
  deliverToIM: vi.fn(),
};

const mockEmit = vi.fn();
const mockLog = vi.fn();
const mockEvolutionController = {
  approve: vi.fn(),
  reject: vi.fn(),
};

vi.mock("../../src/inbox/inbox-repository.js", () => ({
  getInboxRepository: () => mockRepo,
  InboxRepository: class {},
}));

vi.mock("../../src/inbox/delivery-router.js", () => ({
  getDeliveryRouter: () => mockRouter,
  DeliveryRouter: class {},
}));

vi.mock("../../src/inbox/inbox-events.js", () => ({
  inboxEventBus: {
    emitInboxEvent: (...args: any[]) => mockEmit(...args),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: (...args: any[]) => mockLog(...args),
}));

vi.mock("../../src/engine/evolution-controller.js", () => ({
  getGlobalEvolutionController: () => mockEvolutionController,
}));

// ─── Helpers ───

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "inbx_test001",
    userId: "user_1",
    type: "notification",
    category: "system_alert",
    source: "system",
    title: "Test Item",
    priority: "normal",
    status: "unread",
    payload: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateInboxItemInput> = {}): CreateInboxItemInput {
  return {
    userId: "user_1",
    type: "notification",
    category: "system_alert",
    source: "system",
    title: "Test Input",
    ...overrides,
  };
}

describe("InboxService", () => {
  let service: InboxService;

  beforeEach(() => {
    service = new InboxService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    setAiReviewProviderGetter(() => null);
  });

  describe("createItem", () => {
    it("should create item, emit event, and deliver", async () => {
      const item = makeItem({ id: "inbx_new001" });
      mockRepo.create.mockResolvedValue(item);
      mockRouter.route.mockResolvedValue({
        channel: "inbox",
        timing: "immediate",
        reason: "default_inbox",
      });

      const result = await service.createItem(makeInput());

      expect(mockRepo.create).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "new_item", userId: "user_1", item })
      );
      expect(mockRouter.route).toHaveBeenCalled();
      expect(result).toEqual(item);
    });

    it("should trigger AI review for approval items", async () => {
      const item = makeItem({ id: "inbx_app001", type: "approval" });
      mockRepo.create.mockResolvedValue(item);
      mockRouter.route.mockResolvedValue({
        channel: "inbox",
        timing: "immediate",
        reason: "default_inbox",
      });

      let chatResolved = false;
      const mockProvider = {
        chat: vi.fn().mockImplementation(async () => {
          chatResolved = true;
          return { content: '{"recommendation":"approve","confidence":0.9}' };
        }),
      };
      setAiReviewProviderGetter(() => mockProvider as any);
      mockRepo.updateAISuggestion.mockResolvedValue(undefined);

      await service.createItem(makeInput({ type: "approval" }));

      // Poll until async fire-and-forget AI review completes (max 500ms)
      const start = Date.now();
      while (!chatResolved && Date.now() - start < 500) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(mockProvider.chat).toHaveBeenCalled();
    });
  });

  describe("getItem", () => {
    it("should return item by id", async () => {
      const item = makeItem();
      mockRepo.findById.mockResolvedValue(item);

      const result = await service.getItem("inbx_test001");

      expect(mockRepo.findById).toHaveBeenCalledWith("inbx_test001");
      expect(result).toEqual(item);
    });

    it("should return null when item not found", async () => {
      mockRepo.findById.mockResolvedValue(null);

      const result = await service.getItem("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listItems", () => {
    it("should return paginated items", async () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      mockRepo.list.mockResolvedValue({ items, total: 2 });

      const result = await service.listItems({ userId: "user_1", page: 1, pageSize: 10 });

      expect(mockRepo.list).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1" }));
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe("markAsRead", () => {
    it("should update status to read and emit event", async () => {
      const item = makeItem();
      mockRepo.findById.mockResolvedValue(item);
      mockRepo.updateStatus.mockResolvedValue(undefined);

      await service.markAsRead("inbx_test001");

      expect(mockRepo.updateStatus).toHaveBeenCalledWith("inbx_test001", "read");
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "item_updated", itemId: "inbx_test001", status: "read" })
      );
    });

    it("should do nothing when item not found", async () => {
      mockRepo.findById.mockResolvedValue(null);

      await service.markAsRead("nonexistent");

      expect(mockRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("completeItem", () => {
    it("should update status to completed and emit event", async () => {
      const item = makeItem({ category: "system_alert", source: "system" });
      mockRepo.updateStatusIf.mockResolvedValue(1);
      mockRepo.findById
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce({ ...item, status: "completed" });

      const result = await service.completeItem("inbx_test001");

      expect(mockRepo.updateStatusIf).toHaveBeenCalledWith("inbx_test001", "completed", ["unread", "pending", "read"], expect.any(Number));
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "item_updated", itemId: "inbx_test001", status: "completed" })
      );
      expect(result?.status).toBe("completed");
    });

    it("should callback evolution for evolution_approval items", async () => {
      const item = makeItem({ category: "evolution_approval", source: "evolution", sourceId: "evo_1" });
      mockRepo.findById.mockResolvedValue(item);
      mockRepo.updateStatusIf.mockResolvedValue(1);
      mockEvolutionController.approve.mockResolvedValue({ success: true });

      await service.completeItem("inbx_test001", { action: "approve" });

      expect(mockEvolutionController.approve).toHaveBeenCalledWith("evo_1");
    });

    it("should callback evolution reject action", async () => {
      const item = makeItem({ category: "evolution_approval", source: "evolution", sourceId: "evo_2" });
      mockRepo.findById.mockResolvedValue(item);
      mockRepo.updateStatusIf.mockResolvedValue(1);
      mockEvolutionController.reject.mockResolvedValue({ success: true });

      await service.completeItem("inbx_test001", { action: "reject", reason: "质量不达标" });

      expect(mockEvolutionController.reject).toHaveBeenCalledWith("evo_2", "质量不达标");
    });

    it("should return null when item not found", async () => {
      mockRepo.findById.mockResolvedValue(null);

      const result = await service.completeItem("nonexistent");

      expect(result).toBeNull();
    });

    it("should skip completed or dismissed items", async () => {
      const item = makeItem({ status: "completed" });
      mockRepo.findById.mockResolvedValue(item);

      const result = await service.completeItem("inbx_test001");

      expect(mockRepo.updateStatusIf).not.toHaveBeenCalled();
      expect(result?.status).toBe("completed");
    });
  });

  describe("dismissItem", () => {
    it("should update status to dismissed", async () => {
      const item = makeItem();
      mockRepo.findById.mockResolvedValue(item);
      mockRepo.updateStatusIf.mockResolvedValue(1);

      await service.dismissItem("inbx_test001");

      expect(mockRepo.updateStatusIf).toHaveBeenCalledWith("inbx_test001", "dismissed", ["unread", "pending", "read"]);
    });

    it("should skip dismissing already completed or dismissed items", async () => {
      const item = makeItem({ status: "completed" });
      mockRepo.findById.mockResolvedValue(item);

      await service.dismissItem("inbx_test001");

      expect(mockRepo.updateStatusIf).not.toHaveBeenCalled();
    });

    it("should do nothing when item not found", async () => {
      mockRepo.findById.mockResolvedValue(null);

      await service.dismissItem("nonexistent");

      expect(mockRepo.updateStatusIf).not.toHaveBeenCalled();
    });
  });

  describe("completeBySource", () => {
    it("should complete item by source and sourceId", async () => {
      const item = makeItem({ id: "inbx_src001", source: "system", sourceId: "sys_1" });
      mockRepo.findBySourceAndSourceId.mockResolvedValue(item);
      mockRepo.findById
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce({ ...item, status: "completed" });
      mockRepo.updateStatusIf.mockResolvedValue(1);

      const result = await service.completeBySource("system", "sys_1");

      expect(mockRepo.findBySourceAndSourceId).toHaveBeenCalledWith("system", "sys_1");
      expect(mockRepo.updateStatusIf).toHaveBeenCalledWith("inbx_src001", "completed", ["unread", "pending", "read"], expect.any(Number));
      expect(result?.status).toBe("completed");
    });

    it("should return null when item not found by source", async () => {
      mockRepo.findBySourceAndSourceId.mockResolvedValue(null);

      const result = await service.completeBySource("system", "999");

      expect(result).toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return user stats", async () => {
      const stats: InboxStats = {
        unreadCount: 5,
        pendingApprovals: 2,
        pendingTasks: 1,
        unreadNotifications: 2,
        upcomingReminders: 0,
      };
      mockRepo.getStats.mockResolvedValue(stats);

      const result = await service.getStats("user_1");

      expect(mockRepo.getStats).toHaveBeenCalledWith("user_1");
      expect(result).toEqual(stats);
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread count", async () => {
      mockRepo.getUnreadCount.mockResolvedValue(7);

      const result = await service.getUnreadCount("user_1");

      expect(mockRepo.getUnreadCount).toHaveBeenCalledWith("user_1");
      expect(result).toBe(7);
    });
  });

  describe("aggregateItems", () => {
    it("should return all items when aggregation is disabled", async () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      mockRepo.list.mockResolvedValue({ items, total: 2 });

      const result = await service.aggregateItems("user_1", { enabled: false });

      expect(result).toHaveLength(2);
    });

    it("should return items directly when fewer than 2 unread items", async () => {
      const items = [makeItem({ id: "a" })];
      mockRepo.list.mockResolvedValue({ items, total: 1 });

      const result = await service.aggregateItems("user_1");

      expect(result).toHaveLength(1);
    });

    it("should cluster items by time window", async () => {
      const now = Date.now();
      const items = [
        makeItem({ id: "a", category: "system_alert", source: "system", title: "Alert 1", createdAt: now - 1000 }),
        makeItem({ id: "b", category: "system_alert", source: "system", title: "Alert 2", createdAt: now - 2000 }),
        makeItem({ id: "c", category: "system_alert", source: "system", title: "Alert 3", createdAt: now - 100000 }),
      ];
      mockRepo.list.mockResolvedValue({ items, total: 3 });

      const result = await service.aggregateItems("user_1", { timeWindowMs: 5000 });

      // a and b cluster together; c is filtered out by threshold => 1 agg item
      expect(result).toHaveLength(1);
      expect(result[0].aggregateCount).toBe(2);
    });

    it("should cluster by semantic similarity when threshold is set", async () => {
      const now = Date.now();
      const items = [
        makeItem({ id: "a", category: "system_alert", source: "system", title: "CPU high alert", description: "cpu usage", createdAt: now }),
        makeItem({ id: "b", category: "system_alert", source: "system", title: "CPU usage warning", description: "cpu high", createdAt: now + 100 }),
        makeItem({ id: "c", category: "user_reminder", source: "system", title: "Meeting reminder", description: "daily standup", createdAt: now + 200 }),
      ];
      mockRepo.list.mockResolvedValue({ items, total: 3 });

      const result = await service.aggregateItems("user_1", {
        timeWindowMs: 5000,
        similarityThreshold: 0.3,
      });

      // a and b have high similarity; c is different
      // They are in different category:source groups though!
      // system_alert:system -> a, b (clustered by similarity => 1 agg item)
      // user_reminder:system -> c (1 item)
      expect(result).toHaveLength(2);
    });
  });
});
