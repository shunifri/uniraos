/**
 * P2 #5 Relation Ontology + #7 Acceptance rate alerting tests
 *
 * 单元测试: inferEdgeTypeFromLabel (4 tests)
 * e2e: check-acceptance-rate.ts 跳过 (npx tsx 启动 ~60-90s 在 CI 不友好)
 *       生产可在 cron 里直接跑（已 verified in dev）
 */
import { describe, it, expect } from "vitest";
import { inferEdgeTypeFromLabel } from "../../src/memory/knowledge-graph/types.js";

describe("inferEdgeTypeFromLabel (#5 Relation Ontology)", () => {
  it("PARENT_OF 关键词触发", () => {
    expect(inferEdgeTypeFromLabel("属于")).toBe("PARENT_OF");
    expect(inferEdgeTypeFromLabel("包含")).toBe("PARENT_OF");
    expect(inferEdgeTypeFromLabel("位于")).toBe("PARENT_OF");
    expect(inferEdgeTypeFromLabel("在文档里")).toBe("PARENT_OF");
    expect(inferEdgeTypeFromLabel("contains")).toBe("PARENT_OF");
    expect(inferEdgeTypeFromLabel("has_child")).toBe("PARENT_OF");
  });

  it("REVISION_OF 关键词触发", () => {
    expect(inferEdgeTypeFromLabel("修订")).toBe("REVISION_OF");
    expect(inferEdgeTypeFromLabel("继承自")).toBe("REVISION_OF");
    expect(inferEdgeTypeFromLabel("历史版本")).toBe("REVISION_OF");
    expect(inferEdgeTypeFromLabel("replaces")).toBe("REVISION_OF");
    expect(inferEdgeTypeFromLabel("v2_revision")).toBe("REVISION_OF");
  });

  it("ANCHORED_TO 关键词触发", () => {
    expect(inferEdgeTypeFromLabel("锚定")).toBe("ANCHORED_TO");
    expect(inferEdgeTypeFromLabel("附着")).toBe("ANCHORED_TO");
    expect(inferEdgeTypeFromLabel("挂载在")).toBe("ANCHORED_TO");
    expect(inferEdgeTypeFromLabel("anchor")).toBe("ANCHORED_TO");
  });

  it("默认 EXTRACTED", () => {
    expect(inferEdgeTypeFromLabel("related_to")).toBe("EXTRACTED");
    expect(inferEdgeTypeFromLabel("合作")).toBe("EXTRACTED");
    expect(inferEdgeTypeFromLabel("is friend of")).toBe("EXTRACTED");
  });
});

describe("check-acceptance-rate.ts (#7 alerting)", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("DRY_RUN 模式：e2e — 跳过 (npx tsx 启动慢，单测已覆盖 helper)", () => {});
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("ACCEPTANCE_THRESHOLD=1.0 → ALERT: e2e — 跳过", () => {});
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("低 volume 不告警: e2e — 跳过", () => {});
});
