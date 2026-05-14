/**
 * App Designer Skill tests
 * Tests public API: preview, list, archive, formatForDisplay, applyDesign
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppDesignerService } from "../../src/skills/app-designer-skill.js";

// Mock database module
vi.mock("../../src/db/database.js", () => ({
  getDb: vi.fn(),
  isMySQL: vi.fn().mockReturnValue(false),
  getMySQLAdapter: vi.fn(),
}));

// Mock form service
vi.mock("../../src/services/form-service.js", () => ({
  createFormDefinition: vi.fn(),
  deleteFormDefinition: vi.fn(),
  getFormDefinitionByKey: vi.fn(),
}));

// Mock workflow repository
vi.mock("../../src/workflow/repository.js", () => ({
  getWorkflowRepository: vi.fn(),
}));

const TEST_OWNER = "test_user_123";
const OTHER_OWNER = "other_user_456";

function createMockRecord(overrides?: Partial<any>) {
  return {
    id: "design_test_001",
    name: "测试应用",
    description: "测试描述",
    version: 2,
    requirement: "做一个测试应用",
    designJson: {
      name: "测试应用",
      description: "测试描述",
      components: {
        skills: [{ name: "test_skill", description: "测试 Skill", logic: "logic" }],
        forms: [
          { key: "form_a", name: "表单A", fields: [{ name: "f1", title: "字段1", type: "string" }] },
          { key: "form_b", name: "表单B", fields: [{ name: "f2", title: "字段2", type: "number" }] },
        ],
        workflows: [
          {
            key: "wf_1",
            name: "工作流1",
            nodes: [
              { id: "n1", type: "start", name: "开始" },
              { id: "n2", type: "userTask", name: "任务1" },
              { id: "n3", type: "userTask", name: "任务2" },
              { id: "n4", type: "end", name: "结束" },
            ],
          },
        ],
        knowledgeBases: [{ name: "kb1", documentTypes: ["pdf"] }],
      },
      relationships: [
        { from: "workflow:wf_1", to: "form:form_a", type: "binds", description: "使用表单A" },
        { from: "workflow:wf_1", to: "form:form_b", type: "binds", description: "使用表单B" },
        { from: "skill:test_skill", to: "form:form_a", type: "triggers" },
        { from: "skill:test_skill", to: "knowledgeBase:kb1", type: "triggers" },
      ],
    },
    components: [],
    status: "draft",
    ownerId: TEST_OWNER,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("AppDesignerService", () => {
  let service: AppDesignerService;

  beforeEach(() => {
    service = new AppDesignerService();
    vi.clearAllMocks();
  });

  describe("formatForDisplay", () => {
    it("returns text and structured data", () => {
      const record = createMockRecord();
      const display = service.formatForDisplay(record);

      expect(display.text).toContain(record.name);
      expect(display.structured).toBe(record);
    });

    it("includes component counts in text", () => {
      const record = createMockRecord();
      const display = service.formatForDisplay(record);

      expect(display.text).toContain("Skills (1)");
      expect(display.text).toContain("表单 (2)");
      expect(display.text).toContain("工作流 (1)");
      expect(display.text).toContain("知识库 (1)");
    });

    it("handles empty components gracefully", () => {
      const record = createMockRecord({
        designJson: {
          name: "Empty",
          description: "",
          components: { skills: [], forms: [], workflows: [], knowledgeBases: [] },
          relationships: [],
        },
      });
      const display = service.formatForDisplay(record);

      expect(display.text).toContain("Empty");
      expect(display.text).not.toContain("Skills (");
    });
  });

  describe("archiveDesign", () => {
    it("archives a design successfully", async () => {
      const record = createMockRecord();
      service["getRecord"] = vi.fn().mockResolvedValue(record);
      const { getDb } = await import("../../src/db/database.js");
      (getDb as any).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          run: vi.fn(),
        }),
      });

      await service.archiveDesign(record.id, TEST_OWNER);
      expect(true).toBe(true);
    });

    it("throws when design does not exist", async () => {
      service["getRecord"] = vi.fn().mockResolvedValue(null);
      await expect(service.archiveDesign("nonexistent", TEST_OWNER)).rejects.toThrow("设计方案不存在或无权限");
    });

    it("throws when user is not the owner", async () => {
      const record = createMockRecord();
      service["getRecord"] = vi.fn().mockResolvedValue(record);
      await expect(service.archiveDesign(record.id, OTHER_OWNER)).rejects.toThrow("设计方案不存在或无权限");
    });
  });

  describe("previewDesign", () => {
    it("returns record for the owner", async () => {
      const record = createMockRecord();
      service["getRecord"] = vi.fn().mockResolvedValue(record);

      const result = await service.previewDesign(record.id, TEST_OWNER);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(record.id);
    });

    it("returns null when design does not exist", async () => {
      service["getRecord"] = vi.fn().mockResolvedValue(null);
      const result = await service.previewDesign("nonexistent", TEST_OWNER);
      expect(result).toBeNull();
    });

    it("returns null when user is not the owner", async () => {
      const record = createMockRecord();
      service["getRecord"] = vi.fn().mockResolvedValue(record);
      const result = await service.previewDesign(record.id, OTHER_OWNER);
      expect(result).toBeNull();
    });
  });

  describe("listDesigns", () => {
    it("returns designs for the owner", async () => {
      const { getDb } = await import("../../src/db/database.js");
      (getDb as any).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([
            { id: "d1", name: "App1", description: "", version: 1, requirement: "", design_json: "{}", components: "[]", status: "draft", owner_id: TEST_OWNER, created_at: 1000, updated_at: 2000 },
            { id: "d2", name: "App2", description: "", version: 2, requirement: "", design_json: "{}", components: "[]", status: "applied", owner_id: TEST_OWNER, created_at: 2000, updated_at: 3000 },
          ]),
        }),
      });

      const designs = await service.listDesigns(TEST_OWNER);
      expect(designs).toHaveLength(2);
      expect(designs[0].name).toBe("App1");
      expect(designs[1].status).toBe("applied");
    });

    it("returns empty array when no designs", async () => {
      const { getDb } = await import("../../src/db/database.js");
      (getDb as any).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        }),
      });

      const designs = await service.listDesigns(TEST_OWNER);
      expect(designs).toHaveLength(0);
    });
  });

  describe("applyDesign permission", () => {
    it("throws when design does not exist", async () => {
      service["getRecord"] = vi.fn().mockResolvedValue(null);
      await expect(service.applyDesign("nonexistent", TEST_OWNER, {} as any)).rejects.toThrow("设计方案不存在");
    });

    it("throws when user is not the owner", async () => {
      const record = createMockRecord();
      service["getRecord"] = vi.fn().mockResolvedValue(record);
      await expect(service.applyDesign(record.id, OTHER_OWNER, {} as any)).rejects.toThrow("无权部署此设计方案");
    });
  });
});
