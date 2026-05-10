import { describe, it, expect, vi, beforeEach } from "vitest";
import { GenerateActionExecutor } from "../../../src/federation/executors/generate-executor.js";
import type { LLMProvider } from "../../../src/llm/types.js";
import type { SkillRegistry } from "../../../src/registry/index.js";
import type { MetricsCollector } from "../../../src/engine/metrics.js";
import type { EvolutionController } from "../../../src/engine/evolution-controller.js";
import type { EvolutionAction } from "../../../src/federation/types.js";

function makeAction(overrides: Partial<EvolutionAction> = {}): EvolutionAction {
  return {
    type: "generate",
    skillName: "new_skill",
    payload: {
      description: "A skill that greets users",
      capabilities: ["read"],
    },
    priority: 50,
    requiresApproval: false,
    ...overrides,
  };
}

describe("GenerateActionExecutor", () => {
  let llm: LLMProvider;
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let controller: EvolutionController;
  let executor: GenerateActionExecutor;

  beforeEach(() => {
    llm = {
      name: "mock-llm",
      model: "mock",
      chat: vi.fn().mockResolvedValue({
        content: "return { success: true, data: { greeting: 'hello' } };",
        toolCalls: [],
        finishReason: "stop",
      }),
    } as unknown as LLMProvider;

    registry = {
      lookup: vi.fn().mockReturnValue(undefined), // skill does not exist
      register: vi.fn(),
      registerVersion: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as SkillRegistry;

    metrics = {
      getMetrics: vi.fn().mockReturnValue(null),
    } as unknown as MetricsCollector;

    controller = {
      submitForApproval: vi.fn().mockReturnValue("approval-id-123"),
      recordGeneration: vi.fn(),
    } as unknown as EvolutionController;

    executor = new GenerateActionExecutor(llm, controller);
  });

  it("has correct actionType", () => {
    expect(executor.actionType).toBe("generate");
  });

  it("returns failure when skill already exists in registry", async () => {
    (registry.lookup as ReturnType<typeof vi.fn>).mockReturnValue({ name: "new_skill" });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
  });

  it("calls LLM with a prompt containing skill name and description", async () => {
    await executor.execute(makeAction(), { registry, metrics });

    expect(llm.chat).toHaveBeenCalledOnce();
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const promptContent: string = messages[0].content;
    expect(promptContent).toContain("new_skill");
    expect(promptContent).toContain("A skill that greets users");
  });

  it("registers the skill directly when requiresApproval is false", async () => {
    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(true);
    expect(registry.register).toHaveBeenCalledOnce();
    const registeredSkill = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(registeredSkill.name).toBe("new_skill");
    expect(registeredSkill.version).toBe("1.0.0");
  });

  it("calls recordGeneration after registering directly", async () => {
    await executor.execute(makeAction(), { registry, metrics });

    expect(controller.recordGeneration).toHaveBeenCalledWith("new_skill", "evolution-engine");
  });

  it("does not register when requiresApproval is true — submits for approval instead", async () => {
    const result = await executor.execute(makeAction({ requiresApproval: true }), { registry, metrics });

    expect(result.success).toBe(true);
    expect(registry.register).not.toHaveBeenCalled();
    expect(controller.submitForApproval).toHaveBeenCalledOnce();
  });

  it("includes approval id in message when submitted for approval", async () => {
    const result = await executor.execute(makeAction({ requiresApproval: true }), { registry, metrics });

    expect(result.message).toContain("approval-id-123");
  });

  it("passes correct args to submitForApproval", async () => {
    await executor.execute(makeAction({ requiresApproval: true }), { registry, metrics });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [name, description, ___code, capabilities, generatedBy] =
      (controller.submitForApproval as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe("new_skill");
    expect(description).toBe("A skill that greets users");
    expect(capabilities).toEqual(["read"]);
    expect(generatedBy).toBe("evolution-engine");
  });

  it("does not call recordGeneration when submitted for approval", async () => {
    await executor.execute(makeAction({ requiresApproval: true }), { registry, metrics });

    expect(controller.recordGeneration).not.toHaveBeenCalled();
  });

  it("returns failure when LLM returns no content", async () => {
    (llm.chat as ReturnType<typeof vi.fn>).mockResolvedValue({ content: null, toolCalls: [], finishReason: "stop" });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("no code");
  });

  it("returns failure when LLM call throws", async () => {
    (llm.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("LLM call failed");
  });

  it("returns failure when generated code contains forbidden patterns", async () => {
    (llm.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "require('fs').writeFileSync('/etc/passwd', 'hacked');",
      toolCalls: [],
      finishReason: "stop",
    });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("validation failed");
  });

  it("returns failure when registry.register throws", async () => {
    (registry.register as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("duplicate skill");
    });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("duplicate skill");
  });

  it("uses skill name in description if no description in payload", async () => {
    await executor.execute(makeAction({ payload: {} }), { registry, metrics });

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const promptContent: string = messages[0].content;
    expect(promptContent).toContain("new_skill");
  });
});
