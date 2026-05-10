# 表单引擎 / 流程引擎 / AI 层 — 代码整体审查报告

> 生成时间：2026-04-30
> 审查范围：src/services/form*, src/workflow/, src/llm/, src/agents/, src/routes/*, src/skills/workflow-skills.ts, web/src/components/form-engine/

---

## 一、🔴 最高优先级（Critical）— 安全漏洞、崩溃、数据损坏

### 1. 多处 `new Function()` 存在任意代码执行风险
- **表单引擎**：`ValidationEngine.ts:196`、`LinkageEngine.ts:111`、`ConditionEngine.ts:40`
  - 用户可控的 Schema 表达式（`x-linkage`、`x-condition`、`customValidator`）直接通过 `new Function()` 执行
  - 仅对 `"` 和 `\` 做了转义，`` ` `` 和 `${}` 未处理，存在模板字符串注入
- **流程引擎**：`src/workflow/engine.ts:38-80`（`SimpleGuardEngine.evaluate`）
  - 网关条件 `${variable}` 通过 `new Function()` 执行，虽经过 `JSON.stringify` 替换，但整条链路仍属于危险模式
- **修复建议**：统一替换为安全表达式解析器（如 `jsep` + 自定义求值器），或白名单 AST 解释器

### 2. SQL 注入 / 非受控查询执行
- `src/services/data-source-service.ts:62-68`
  - `dbConfig.query` 是原始字符串直接执行，无 `SELECT`-only 限制，恶意表单设计者可写入 `DROP TABLE`
- `src/services/form-service.ts` 多处 `JSON.parse` 无 `try/catch`
  - 一行脏数据会导致整个列表 API 崩溃
- `src/services/workflow-form-service.ts:57-68`
  - `updates` 为空对象时生成 `UPDATE ... SET WHERE id = ?` 语法错误

### 3. 流程引擎竞态条件（TOCTOU）
- `src/workflow/engine.ts`
  - `claimTask`、`completeTask`、`handleUserTask` 均无数据库级锁或乐观并发控制
  - 两人可同时认领同一任务；同一任务可被重复完成并导致重复推进
- **修复建议**：MySQL 用 `SELECT ... FOR UPDATE`，SQLite 用 `db.transaction()`，或增加 `version` 字段做乐观锁

### 4. 缺失 `await` 导致运行时错误
- `src/services/workflow-task-form-service.ts:146-149`
  ```ts
  let formDef = getFormDefinition(binding.form_id);        // Promise，未 await
  if (!formDef) {
    formDef = getFormDefinitionByKey(binding.form_id);     // Promise，未 await
  }
  ```
  - Promise 为 truthy，`!formDef` 永远为 false，后续访问 `formDef.schema_json` 得到 `undefined`

### 5. 权限绕过
- `src/workflow/engine.ts:417-441`（`cancelInstance`）
  - `if (userId && instance.starter !== userId)` — 当 `userId` 为 `undefined` 时跳过检查，任何人可取消任意流程
- `src/routes/workflow-definition-routes.ts`
  - `POST/PUT/DELETE /workflow/definitions` 仅检查 `requireAuth`，无管理员权限校验，任何登录用户可修改流程定义
- `src/routes/agent-routes.ts:379-398`
  - `confirmQueue` 解析无任何权校验，可暴力猜测 `confirmId` 完成他人待确认操作

### 6. 空指针崩溃
- `src/services/workflow-task-form-service.ts:135-162`
  - 当流程节点使用现代 `formDefinitionId` 方式时，`binding` 保持为 `null`，随后访问 `binding.mapping_json` 抛错

---

## 二、🟠 高优先级（High）— 运行时错误、资源泄漏、类型失控

### 7. 错误处理严重缺失

| 位置 | 问题 |
|------|------|
| `src/llm/agent-loop.ts:404-869` | `run` / `runStream` 无顶层 try-catch，`provider.chat()` 抛错直接崩溃，流式场景不会 emit error 事件 |
| `src/llm/openai-provider.ts` / `claude-provider.ts` | `fetch()` 无 `AbortSignal`/timeout，API 挂起则永久阻塞 |
| `src/agents/orchestrator.ts:697-707` | `analyzeStrategy` 空 catch `{}`，LLM 持续失败时静默回退到 `react` |
| `src/services/data-source-service.ts` | DB/HTTP/网络异常全部返回 `{ options: [] }`，前端无任何错误提示 |
| `web/src/components/form-engine/core/ValidationEngine.ts:271-273` | 远程校验失败时返回 `{ valid: true }`，敏感场景（如用户名唯一性）会错误通过 |

### 8. AI 层内存泄漏与并发安全问题
- `src/llm/agent-loop.ts:133-137` — `conversationHistories`、`skillCreationState`、`kbSearchHasResults` 为实例级 Map，**无 TTL/LRU**，长会话内存无限增长
- `src/agents/orchestrator.ts:112-118` — `conversations`、`conversationReferences` 同样无清理
- `src/agents/orchestrator.ts:246-253` — `currentUserId` / `currentConversationId` 为可变实例属性，**并发请求互相污染**
- `src/agents/orchestrator.ts:502-554` — 同一 `conversationId` 的并发请求会非原子地交错 `appendHistory`，导致历史记录乱序

### 9. 类型系统形同虚设
- 后端服务中 `any` 泛滥：`form-service.ts`、`workflow-task-form-service.ts`、`data-source-service.ts` 的核心接口全部使用 `any`
- `src/services/form-llm-generator.ts:6-19` — `GenerateFormInput` 中 `description` 重复声明两次
- `src/workflow/engine.ts:913` — `getTaskFormSchema` 返回 `Promise<any | null>`
- `src/services/workflow-task-form-service.ts:10-12` — `schema`、`initialData`、`binding` 全为 `any`

### 10. 循环与递归风险
- `src/workflow/engine.ts:161-210` — `advance()` → `processNode()` → `advance()` 递归处理自动节点，恶意深度 workflow 会导致栈溢出
- `src/llm/agent-loop.ts` — 当 LLM 持续触发 fakeKB / optionList / emptyReply 时，`continue` 重新调用 LLM，15 次迭代内可烧完额度
- `src/agents/react-agent.ts` — 无 guard 检查，LLM 可无限循环调用同一失败工具

### 11. 深递归与栈溢出
- `src/llm/tool-bridge.ts` — 嵌套 `paramSchema` 转换无最大深度限制
- `src/llm/agent-loop.ts:301-313` / `src/agents/react-agent.ts:111-115` — `JSON.stringify` 工具结果时，循环引用会直接抛错并崩溃整个对话

### 12. JSON 提取正则过于贪婪
- `src/services/form-llm-generator.ts:42` 和 `src/workflow/workflow-llm-generator.ts:229`
  - `/\{[\s\S]*\}/` 会从第一个 `{` 匹配到最后一个 `}`，当 LLM 返回多个 JSON 块或附加说明时产生非法 JSON

---

## 三、🟡 中优先级（Medium）— 架构耦合、设计不一致、重复代码

### 13. 双表单 Schema 体系（核心架构债）
- `RaosFormSchema`（现代，富特性）与 `FormSchema`（遗留，简单 fields 数组）并存
- `src/workflow/workflow-llm-generator.ts:380-442`（`autoCreateFormsForWorkflow`）做手动有损转换：
  - 仅映射 `number` / `string`，`select/radio/checkbox/textarea/date/file/user/department` 全被抹成 `string`
  - 丢失 `validation`、`placeholder`、`ui:widget`、`format`、联动、跨字段校验等全部高级特性
- `src/inbox/adapters/workflow-adapter.ts:24` — 始终传递内联 `node.form`，即使节点配置了 `formDefinitionId`
- **建议**：废弃 `FormSchema`，提供运行时迁移适配器；统一使用 `RaosFormSchema`

### 14. 跨层双向依赖（Workflow ↔ Services）
```
src/workflow/engine.ts          → ../services/form-service.js
src/workflow/workflow-llm-generator.ts → ../services/form-service.js
src/services/workflow-task-form-service.ts → ../workflow/engine.js + ../workflow/repository.js
```
- 流程引擎（核心领域层）直接依赖上层服务，违反分层原则
- **建议**：引入依赖反转（端口/适配器），或提取共享的 `form-repository.ts` / `workflow-repository.ts`

### 15. LLM 生成器代码严重重复

| 功能 | 表单生成器 | 流程生成器 | 是否共享 |
|------|-----------|-----------|---------|
| `extractJson()` | `form-llm-generator.ts:35` | `workflow-llm-generator.ts:229` | ❌ 重复 |
| `buildSystemPrompt()` | 独立实现 | 独立实现 | ❌ 重复 |
| `buildUserPrompt()` | 独立实现 | 独立实现 | ❌ 重复 |
| JSON 校验 | `validateFormSchema()` | `validateWorkflowJson()` | ❌ 重复 |

- 三处 `extractJson`（含 `agents/protocols/parse-helpers.ts:40`）行为不一致，修 bug 需改 3 处

### 16. 全局单例与硬编码依赖
- `src/workflow/engine.ts:948-954` — `getWorkflowEngine()` 返回模块级单例，测试难以 mock
- `src/workflow/repository.ts:806-821` — `getWorkflowRepository()` 同样为可变全局实例
- `src/workflow/engine.ts:258` — 引擎内部直接调用 `getInboxService()`，无依赖注入
- `src/skills/workflow-skills.ts:124` — 硬编码节点 ID `"fill_form"`，模板变更即断裂

### 17. 数据库 Schema 不一致
- `form_definitions.id` → `VARCHAR(36)` (UUID)
- `workflow_definitions.id` → `INTEGER` (自增)
- `workflow_tasks.instance_id` → `INTEGER`
- `workflow_form_instances.instance_id` → `VARCHAR(36)`
- 导致 `workflow_form_instances` 与 `workflow_tasks` 无法做可靠外键关联

### 18. 双历史系统（AI 层）
- `AgentLoop` 维护一套 `conversationHistories`
- `Orchestrator` 维护另一套 `conversations` / `conversationReferences`
- 不同 `mode` 切换时两套历史不同步，上下文断裂

### 19. 前端状态管理问题
- `FormRenderer.tsx:218` — 整个表单订阅同一个 Zustand store，每次按键触发全表重渲染
- `debouncedAsyncValidate` — 旧 Promise 被 `clearTimeout` 后永不 resolve，造成内存泄漏和 UI 状态不一致
- `FormRenderer.tsx` — 多个 `setTimeout` / `autoSaveTimerRef` 在组件卸载时未清理

### 20. 业务逻辑缺陷
- `src/workflow/engine.ts:658-682` — 并行网关 `split` 只执行第一个分支，其余分支被静默丢弃
- `src/workflow/engine.ts:530-545` — 无 `signPolicy` 时只给第一个审批人发任务，其余人被静默忽略
- `src/workflow/engine.ts:315-318` / `288-296` — `reject` 动作将实例标记为 `completed` 而非 `cancelled`，下游无法区分通过/驳回
- `src/services/workflow-form-service.ts:24` — 运算符优先级 bug：`input.isRequired ?? true ? 1 : 0` 恒等于 `1`

---

## 四、🔵 低优先级（Low）— 代码风格、边缘情况、性能

### 21. 前端/后端类型文件手动同步
- `src/types/form.ts` 头部注释明确说明与 `web/src/components/form-engine/types.ts` 保持手动同步
- 这是**必然的漂移源**，应使用共享 types 包或从 Zod/JSON Schema 生成

### 22. 数据过滤器使用松散相等
- `src/services/data-source-service.ts:143-148` — `==` / `!=` 导致 `0 == ''`、`null == undefined` 等意外行为

### 23. `parseInt` 无 NaN 检查与 radix
- `src/routes/form-routes.ts:32-33` — `parseInt("not_a_number")` 得到 `NaN` 透传至 SQL `LIMIT`

### 24. 模板硬编码不存在的用户 ID
- `src/workflow/templates.ts` — `assignee: "it_admin"`、`assigneePolicy: "cfo"` 等可能对应数据库中不存在的用户

### 25. 路径遍历风险
- `src/routes/agent-routes.ts:177-198` — `join(SAFE_BASE, file.path)` 未校验解析后的路径是否在 `SAFE_BASE` 内

### 26. Prompt 注入
- `src/llm/agent-loop.ts:894-906`、`src/agents/orchestrator.ts:652-693` / `731-745`
  - 用户消息直接拼接到 LLM prompt 中，未做引号转义或指令隔离

---

## 五、修复优先级建议

### 立即修复（本周）
1. **安全**：替换所有 `new Function()` 为安全表达式解析器
2. **安全**：`data-source-service.ts` 限制查询为 `SELECT-only`
3. **崩溃**：`workflow-task-form-service.ts` 补全 `await`
4. **崩溃**：所有 `JSON.parse` 添加 `try/catch`
5. **崩溃**：`workflow-task-form-service.ts:162` 处理 `binding` 为 `null` 的情况
6. **权限**：修复 `cancelInstance` 的 `undefined` 绕过
7. **权限**：`workflow-definition-routes` 增加管理员校验

### 短期修复（两周内）
8. 流程引擎加乐观锁 / 行锁解决竞态条件
9. `completeTask` 补全 try-catch 或事务包裹
10. AI 层补充请求 timeout / AbortSignal
11. AI 层修复并发安全问题（`currentUserId` / history 的原子操作）
12. 统一 `extractJson` 等 LLM 工具函数到共享模块
13. 提取 `FormSchema` → `RaosFormSchema` 的完整映射，而非仅 `string/number`

### 中期重构（一个月内）
14. 解耦 Workflow ↔ Services 的双向依赖（引入 repository 端口）
15. 废弃遗留 `FormSchema`，统一为 `RaosFormSchema`
16. 统一前后端类型定义（共享包或代码生成）
17. 修复数据库 schema 类型不一致（`instance_id` 统一）
18. `AgentLoop` 与 `Orchestrator` 历史系统合并或明确职责边界
19. 前端 `FormRenderer` 性能优化（字段级订阅替代全表重渲染）
