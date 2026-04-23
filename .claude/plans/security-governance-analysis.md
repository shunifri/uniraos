# RAOS 安全与治理问题全面分析报告

## 一、事件还原

### 用户场景
> "帮我列出毕业设计数据库中所有的表"

### AI 实际执行链路

```
用户请求
  │
  ▼
AI 调用 file_read → 读取 workspace/bysj_analysis_script.js
  │                 → 获取到数据库连接信息：
  │                    host=localhost, port=3306, user=root, password=Kavin0501@
  │
  ▼
AI 调用 mysql_query 系统 skill → 直接连接并查询数据库
  │                              → 返回 69 个表的信息
  │
  ▼
AI 调用 skill_compose 创建 skill（连续 3 个冗余 skill）
  │  - list_mysql_tables（特定连接）
  │  - list_mysql_tables_generic（通用连接参数）
  │  - list_bysj_tables（针对 bysj 数据库）
  │
  ▼
AI 将所有信息返回给用户（含数据库密码等敏感信息）
```

### 用户发现的问题

1. **敏感信息泄露**：`file_read` 读取了包含数据库密码的用户文件
2. **技能未审批却被使用**：用户认为"列出表的技能没有开放"，但 AI 实际上直接使用了 `mysql_query` 系统 skill 绕过
3. **冗余技能创建**：一次请求创建了 3 个功能相似的 skill
4. **权限问题**：`file_read` 等读取类 skill 是否应该拒绝读取可能包含敏感信息的文件？

---

## 二、根因分析（5 层安全模型）

### Layer 1: 数据层 — 文件读取安全边界过宽

**现状**：
- `file_read` 可以读取 workspace 中任何文本文件
- `isSensitiveFile()` 只检查文件名（`.env` 等），不检查内容
- 用户可以在 workspace 中存放任何文件（包括包含密码的 `.js`、`.md` 等）

**问题**：
- AI 通过读取 `bysj_analysis_script.js` 获取了数据库连接密码
- AI 通过 `file_list` 扫描到文件后，有动机去读取它

### Layer 2: 工具层 — 敏感 Skill 暴露过多信息

**现状**：
- `mysql_query` 的 description 明确说明了参数格式：`connection({host,user,password,database,port?})`
- `skillsToTools()` 将所有 skill 的完整 paramSchema 暴露给 LLM
- AgentLoop 的 `refreshTools()` 虽然过滤了权限，但系统 skill（如 `file_read`, `mysql_query`）对所有用户可见

**问题**：
- AI 知道 `mysql_query` 的存在和用法
- AI 知道 `file_read` 可以读取文件
- AI 将两者组合使用，形成"读取文件获取密码 → 连接数据库查询"的攻击链

### Layer 3: 执行层 — ExecutionEngine 缺少运行时权限检查

**现状**（审计发现 Critical 漏洞）：
- `ExecutionEngine.executeRecursive()` 直接通过 `registry.get(skillName)` 获取 skill
- **没有任何权限检查**
- 组合 skill 内部调用 `engine.execute(step.skill, ...)` 时，同样不检查权限

**问题**：
- 如果 AI 知道了 skill 名称，可以直接调用执行
- 组合 skill 的子步骤可能调用用户无权执行的 skill
- 这是深层架构缺陷

### Layer 4: 创建层 — 无冗余检测和速率限制

**现状**：
- `skill_compose` / `skill_from_description` 没有相似度检测
- 没有创建数量限制
- System Prompt 中没有约束 AI 不要创建多个变体

**问题**：
- AI 一次创建了 3 个功能重复的 skill
- 浪费审批资源和用户注意力

### Layer 5: 审批层 — 路由存在严重安全隐患

**现状**（审计发现 Critical 漏洞）：
- `routes/evolution-routes.ts` 中有两个 `POST /evolution/approve/:id` handler
- 第一个（line 49）使用 `new Function()` 执行代码 → 不安全
- 第二个（line 329）使用 `runInSandbox()` → 安全，但**永远不会被命中**
- 因为 Express 按注册顺序匹配，第一个 handler 总是赢

**问题**：
- 审批端点本身存在代码注入风险
- 安全的沙箱实现是死代码

---

## 三、完整漏洞清单

| # | 漏洞 | 严重级别 | 影响 | 位置 |
|---|------|---------|------|------|
| 1 | `file_read` 内容无敏感词检测 | High | AI 读取含密码文件 | `data-skills.ts` |
| 2 | `file_read` 文件类型无限制 | Medium | AI 读取 `.js` 等脚本文件 | `data-skills.ts` |
| 3 | 敏感 skill 描述暴露参数格式 | Medium | AI 知道如何使用 `mysql_query` | `db-skills.ts` |
| 4 | **ExecutionEngine 无权限检查** | **Critical** | 任意 skill 可被直接执行 | `execution-engine.ts` |
| 5 | **审批路由 `new Function()` 被执行** | **Critical** | 代码注入风险 | `evolution-routes.ts` |
| 6 | `skill_compose` 无冗余检测 | Medium | 重复创建 skill | `meta-skills.ts` |
| 7 | `skill_compose` 无创建数量限制 | Medium | 批量创建 skill | `meta-skills.ts` |
| 8 | `shell_exec` 黑名单可绕过 | High | 命令注入 | `data-skills.ts` |
| 9 | `db_query` 只读检查可绕过 | High | SQL 注入写操作 | `db-skills.ts` |
| 10 | `http_call` SSRF 风险 | High | 访问内网服务 | `data-skills.ts` |
| 11 | `/llm/tools` 无权限过滤 | Medium | 泄露所有 skill | `skill-routes.ts` |
| 12 | `skill_unregister` 无所有权检查 | Medium | 删除他人 skill | `meta-skills.ts` |

---

## 四、解决方案

### 4.1 文件读取安全加固（解决信息泄露）

**方案 A（推荐）: 文件类型白名单 + 内容扫描**

```typescript
// 1. 文件类型白名单：只允许读取常见文档类型
const ALLOWED_READ_EXTENSIONS = new Set([
  '.md', '.txt', '.csv', '.json',   // 文档/数据
  // '.js', '.sql', '.sh' 等明确禁止
]);

// 2. 内容敏感词扫描：读取后检查内容
function containsSensitivePatterns(content: string): boolean {
  const patterns = [
    /password\s*[:=]\s*\S+/i,
    /host\s*[:=]\s*\S+/i,         // host + password 组合
    /database\s*[:=]\s*\S+/i,
    /connection\s*[:=]\s*\{/i,
    /api[_-]?key\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
  ];
  // 需要至少匹配 2 个才判定为敏感（降低误报）
  let matchCount = 0;
  for (const p of patterns) {
    if (p.test(content)) matchCount++;
  }
  return matchCount >= 2;
}
```

**实施位置**：`data-skills.ts` 的 `file_read` handler

**效果**：
- AI 无法读取 `.js` 文件
- 即使读取 `.md` 文件，如果包含连接信息，也会被拒绝

### 4.2 敏感 Skill 信息脱敏（减少 AI 滥用能力）

**方案：修改敏感 skill 的 description 和 paramSchema**

```typescript
// mysql_query 的 description 改为：
"执行 MySQL 查询。需要管理员提供连接配置。参数: sql(string), connection(object)"

// 隐藏具体的 connection 字段名，不在 description 中说明
// paramSchema 中 description 简化为 "数据库连接配置（由管理员提供）"
```

**实施位置**：`db-skills.ts` 的 `mysql_query`, `mysql_execute`, `db_query`, `db_execute`, `http_call`, `shell_exec`

**效果**：AI 不知道具体的参数格式，降低了组合攻击的可能性

### 4.3 ExecutionEngine 权限检查（Critical 修复）

**方案：在执行前添加权限校验**

```typescript
// execution-engine.ts
private async executeRecursive(...) {
  // ... 现有代码 ...
  
  // 新增：运行时权限检查
  if (context.user?.id && context.user.id !== "default") {
    const canAccess = await permissions.hasSkillPermission(context.user.id, skillName);
    if (!canAccess) {
      throw new PermissionDeniedError(`无权执行 skill: ${skillName}`);
    }
  }
  
  // ... 继续执行 ...
}
```

**注意**：需要在 `ExecutionEngine` 初始化时注入权限服务，或使用全局权限模块

### 4.4 Skill 创建治理（解决冗余）

**方案：三层限制**

```typescript
// 1. 数量限制：每个用户每小时最多创建 3 个 skill
// 2. 相似度检测：基于名称/description 的文本相似度
// 3. Prompt 约束：在 system prompt 中明确约束
```

**System Prompt 增加约束**：
```
## Skill 创建约束
- 当用户请求创建 skill 时，**只创建最必要的一个 skill**
- 严禁创建多个功能相似的变体（如 "xxx" 和 "xxx_generic"）
- 如果已有 skill 能满足需求，直接使用已有 skill，不要创建新的
```

### 4.5 审批路由安全修复（Critical）

**方案**：删除 `evolution-routes.ts` 中第一个不安全的 handler（line 49），保留第二个使用 `runInSandbox()` 的 handler（line 329）

```typescript
// 删除 line 49-135 的 POST /evolution/approve/:id handler
// 保留 line 329-426 的 handler
// line 427+ 的 /evolution/approvals/:id/approve 保持不变
```

### 4.6 组合 Skill 执行权限级联（防御纵深）

**方案**：在 `skill_compose` 生成的 handler 中，每个子步骤执行前检查权限

```typescript
// 组合 skill 的 handler 中
for (const step of steps) {
  const canExecute = await permissions.hasSkillPermission(context.user?.id, step.skill);
  if (!canExecute) {
    return { success: false, error: new Error(`无权执行子 skill: ${step.skill}`) };
  }
  const result = await engine.execute(step.skill, resolvedParams, true);
}
```

---

## 五、实施优先级

| 优先级 | 措施 | 影响 | 工作量 |
|--------|------|------|--------|
| P0 (立即) | 修复审批路由 `new Function()` | 防止代码注入 | 小 |
| P0 (立即) | ExecutionEngine 添加权限检查 | 防止未授权执行 | 中 |
| P1 (本次) | `file_read` 内容敏感词检测 | 防止信息泄露 | 中 |
| P1 (本次) | `file_read` 文件类型白名单 | 防止读取脚本 | 小 |
| P1 (本次) | Skill 创建数量/冗余限制 | 防止滥用 | 中 |
| P2 (后续) | 敏感 skill 描述脱敏 | 降低攻击面 | 小 |
| P2 (后续) | `shell_exec` / `db_query` 安全加固 | 防止注入 | 中 |
| P2 (后续) | `/llm/tools` 权限过滤 | 防止信息泄露 | 小 |
