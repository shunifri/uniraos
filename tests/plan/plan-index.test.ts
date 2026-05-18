import { describe, it, expect, beforeEach } from "vitest";
import {
  findPlanByConversationIdIndexed,
  invalidateUserIndex,
  invalidateAllIndexes,
} from "../../src/plan/plan-index.js";
import { createPlan, deletePlan } from "../../src/plan/plan-state.js";

describe("plan-index", () => {
  const TEST_USER = "test_index_user";

  beforeEach(() => {
    invalidateUserIndex(TEST_USER);
  });

  it("should find plan by conversationId via index", () => {
    const { fileName } = createPlan({
      title: "Indexed Plan",
      content: "- [ ] Step 1\n",
      conversationId: "conv-index-1",
    }, TEST_USER);

    const found = findPlanByConversationIdIndexed("conv-index-1", TEST_USER);
    expect(found).toBeDefined();
    expect(found!.fileName).toBe(fileName);
  });

  it("should return undefined for unknown conversationId", () => {
    const found = findPlanByConversationIdIndexed("conv-nonexistent", TEST_USER);
    expect(found).toBeUndefined();
  });

  it("should invalidate index after plan deletion", () => {
    const { fileName } = createPlan({
      title: "To Delete",
      content: "- [ ] Step 1\n",
      conversationId: "conv-index-delete",
    }, TEST_USER);

    expect(findPlanByConversationIdIndexed("conv-index-delete", TEST_USER)).toBeDefined();
    deletePlan(fileName, TEST_USER);
    invalidateUserIndex(TEST_USER);
    expect(findPlanByConversationIdIndexed("conv-index-delete", TEST_USER)).toBeUndefined();
  });
});
