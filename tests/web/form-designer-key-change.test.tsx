/**
 * Q3 W2 Item #5: FormDesigner 改 key 触发 cascade 验证
 *
 * 这是契约测试 (contract test) — 验证 FormDesigner.tsx 源码结构, 不做全 React 渲染.
 * 全 React 渲染依赖太多 web 子模块的 @/ alias, 在根 vitest config 跑有循环依赖风险.
 *
 * 测试覆盖:
 *   1. FormDesigner.tsx 在保存时调 PUT /api/form/definitions/:id
 *   2. PUT body 包含 `key: state.formMeta.key` (新 key 透传)
 *   3. PUT 失败时调用 message.error(res.error || "更新失败")
 *   4. PUT 成功时调用 message.success("更新成功")
 *
 * cascade 真实行为由 tests/services/form-key-cascade.test.ts 覆盖.
 * 这里只验证前端 *正确发起* cascade-aware 的 API call.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const formDesignerSrc = readFileSync(
  resolve(__dirname, "../../web/src/pages/FormDesigner.tsx"),
  "utf-8"
);

const formRoutesSrc = readFileSync(
  resolve(__dirname, "../../src/routes/form-routes.ts"),
  "utf-8"
);

describe("FormDesigner - key change cascade contract (Q3 W2 Item #5)", () => {
  it("PUT request uses URL pattern /api/form/definitions/:id", () => {
    expect(formDesignerSrc).toMatch(
      /api\.put<[^>]*>\(\s*`\/api\/form\/definitions\/\$\{id\}`/
    );
  });

  it("PUT body includes new key from state.formMeta.key (cascade trigger)", () => {
    // The payload must include key: state.formMeta.key
    expect(formDesignerSrc).toMatch(/key:\s*state\.formMeta\.key/);
  });

  it("PUT request sends key, name, description, schemaJson in body", () => {
    // Find the inline `updateFormDefinition(id, {...})` call (not the function definition)
    // The function definition signature is `function updateFormDefinition(id, payload)`,
    // and the call site uses `updateFormDefinition(id, { key: ..., name: ... })`
    // We look for the object literal after the call's opening paren.
    const callStart = formDesignerSrc.indexOf("updateFormDefinition(formId");
    if (callStart === -1) {
      // Fallback: search for any call with `{` body
      const callMatch = formDesignerSrc.match(
        /updateFormDefinition\(\s*id\s*,\s*\{[\s\S]*?\}\s*\)/
      );
      expect(callMatch).toBeTruthy();
      const call = callMatch![0];
      expect(call).toContain("key: state.formMeta.key");
      expect(call).toContain("name: state.formMeta.name");
      expect(call).toContain("description: state.formMeta.description");
      expect(call).toContain("schemaJson: schema");
      return;
    }
    // Extract from `{` to the matching `})` after the call
    const fromBrace = formDesignerSrc.slice(callStart);
    const openIdx = fromBrace.indexOf("{");
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < fromBrace.length; i++) {
      if (fromBrace[i] === "{") depth++;
      else if (fromBrace[i] === "}") {
        depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
    }
    expect(closeIdx).toBeGreaterThan(-1);
    const call = fromBrace.slice(0, closeIdx + 2); // include closing `)`
    expect(call).toContain("key: state.formMeta.key");
    expect(call).toContain("name: state.formMeta.name");
    expect(call).toContain("description: state.formMeta.description");
    expect(call).toContain("schemaJson: schema");
  });

  it("handles save success with message.success", () => {
    expect(formDesignerSrc).toMatch(/message\.success\(["']更新成功["']/);
  });

  it("handles save failure with message.error (cascade error propagated)", () => {
    // message.error(res.error || "更新失败") - cascade error from backend must be shown
    expect(formDesignerSrc).toMatch(
      /message\.error\(res\.error\s*\|\|\s*["']更新失败["']/
    );
  });

  it("backend route /api/form/definitions/:id PUT allows key field (P1-25 still active)", () => {
    // The route must allow 'key' in the allowed list, otherwise cascade trigger fails
    expect(formRoutesSrc).toMatch(/allowed\s*=\s*\[[^\]]*['"]key['"]/);
  });

  it("backend updateFormDefinition cascades workflow_form_bindings when key changes (Q3 W2)", () => {
    // Verify the form-service.ts implements cascade via transaction
    const formServiceSrc = readFileSync(
      resolve(__dirname, "../../src/services/form-service.ts"),
      "utf-8"
    );
    // Cascade must use transaction (atomicity)
    expect(formServiceSrc).toMatch(/keyChanged/);
    expect(formServiceSrc).toMatch(/adapter\.transaction\(/);
    expect(formServiceSrc).toMatch(/db\.transaction\(/);
  });

  it("workflow-form-service exposes cascade function updateWorkflowFormBindingsFormIdByFormId", () => {
    const wfSvcSrc = readFileSync(
      resolve(__dirname, "../../src/services/workflow-form-service.ts"),
      "utf-8"
    );
    expect(wfSvcSrc).toMatch(
      /export\s+async\s+function\s+updateWorkflowFormBindingsFormIdByFormId/
    );
  });
});
