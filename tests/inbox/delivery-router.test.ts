/**
 * Delivery Router Tests
 *
 * Tests for delivery channel decision logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeliveryRouter } from "../../src/inbox/delivery-router.js";
import type { InboxItem, DeliveryEvent } from "../../src/inbox/inbox-types.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
}));

// Mock inbox events
const mockEmit = vi.fn();
vi.mock("../../src/inbox/inbox-events.js", () => ({
  inboxEventBus: {
    emitInboxEvent: (...args: any[]) => mockEmit(...args),
  },
}));

describe("DeliveryRouter", () => {
  let router: DeliveryRouter;

  beforeEach(() => {
    router = new DeliveryRouter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
      id: "test_001",
      userId: "user_1",
      type: "notification",
      category: "system_alert",
      source: "system",
      title: "Test",
      priority: "normal",
      status: "unread",
      payload: {},
      createdAt: Date.now(),
      ...overrides,
    };
  }

  describe("route", () => {
    it("should route urgent items to chat when user is online and has conversation", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "urgent" }),
        userOnline: true,
        relatedConversationId: "conv_1",
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("chat");
      expect(decision.timing).toBe("immediate");
      expect(decision.targetConversationId).toBe("conv_1");
      expect(decision.reason).toBe("urgent_priority");
    });

    it("should route urgent items to email fallback when user is offline", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "urgent" }),
        userOnline: false,
        relatedConversationId: "conv_1",
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("email");
      expect(decision.timing).toBe("immediate");
      expect(decision.reason).toBe("urgent_priority_offline_fallback");
    });

    it("should route urgent items to email fallback when no conversation", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "urgent" }),
        userOnline: true,
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("email");
      expect(decision.reason).toBe("urgent_priority_offline_fallback");
    });

    it("should route high priority + related conversation + chat location to chat", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "high" }),
        userOnline: true,
        userLocation: "/chat/conv_1",
        relatedConversationId: "conv_1",
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("chat");
      expect(decision.reason).toBe("high_priority_related_conversation");
    });

    it("should route high priority without chat location to inbox", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "high" }),
        userOnline: true,
        userLocation: "/dashboard",
        relatedConversationId: "conv_1",
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("inbox");
    });

    it("should route approval with approaching deadline to inbox when user online", async () => {
      const event: DeliveryEvent = {
        item: makeItem({
          type: "approval",
          dueAt: Date.now() + 2 * 3600000, // 2 hours from now
        }),
        userOnline: true,
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("inbox");
      expect(decision.reason).toBe("approval_approaching_deadline");
    });

    it("should route approval with approaching deadline to email when user offline", async () => {
      const event: DeliveryEvent = {
        item: makeItem({
          type: "approval",
          dueAt: Date.now() + 2 * 3600000,
        }),
        userOnline: false,
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("email");
    });

    it("should route approval with distant deadline to default inbox", async () => {
      const event: DeliveryEvent = {
        item: makeItem({
          type: "approval",
          dueAt: Date.now() + 48 * 3600000, // 48 hours
        }),
        userOnline: true,
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("inbox");
      expect(decision.reason).toBe("default_inbox");
    });

    it("should route normal items to inbox by default", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "normal" }),
        userOnline: true,
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("inbox");
      expect(decision.timing).toBe("immediate");
      expect(decision.reason).toBe("default_inbox");
    });

    it("should route low priority items to inbox by default", async () => {
      const event: DeliveryEvent = {
        item: makeItem({ priority: "low" }),
        userOnline: true,
      };

      const decision = await router.route(event);

      expect(decision.channel).toBe("inbox");
    });
  });

  describe("delivery methods", () => {
    it("deliverToChat should emit chat_message event", async () => {
      const item = makeItem();
      await router.deliverToChat(item, "conv_1");

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "chat_message",
          userId: "user_1",
          item,
        })
      );
    });

    it("should not throw for placeholder delivery methods", async () => {
      const item = makeItem();
      await expect(router.deliverToInbox(item)).resolves.toBeUndefined();
      await expect(router.deliverToEmail(item)).resolves.toBeUndefined();
      await expect(router.deliverToIM(item)).resolves.toBeUndefined();
    });
  });
});
