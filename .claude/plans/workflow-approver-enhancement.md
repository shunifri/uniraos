# 审批流程增强实施计划

## 问题现状

### 1. 流程查不到的问题（已定位根因）
- `workflow_generate` 成功写入 MySQL，但 `approval_submit` 查不到 `contract_approval`
- **根因**：MySQL 迁移中 `definition`/`form_schema`/`variables`/`candidate_users`/`candidate_groups`/`form_data` 字段类型为 `JSON`，`mysql2` 驱动自动解析为 JS 对象，但代码仍按字符串调用 `JSON.parse`，导致 `"[object Object]"` 解析失败
- 已修复 `mapDefinition`/`mapInstance`/`mapTask`，但 `getVariable`/`getVariables`/`mapConnection` 中仍有未修复的裸 `JSON.parse`

### 2. 审批人策略缺失
当前仅支持：
- `assignee`: 固定用户ID
- `assigneePolicy`: 字符串策略（starter / starter.manager / starter.director）

缺失能力：
- 按角色查找审批人
- 按角色+部门交集查找
- 多人会签（全部通过/任一通过/多数通过）
- 发起人角色/部门限制

---

## 现有系统接口调研

用户系统（`src/db/user-repository.ts`）已提供：
- `getUserById(id)` → `User | null`（含 `departmentId`, `roles`）
- `getUsersByRole(roleId)` → `User[]` ✅ 可直接用于"按角色找"
- `getUsersByDepartment(deptId)` → `User[]` ✅ 可直接用于"按部门找"
- `getUserDepartment(userId)` → `{ id, name, path } | null`
- `getUserRoles(userId)` → `Array<{ id, name, description }>`

**缺失接口**：`getUsersByRoleAndDept(roleId, deptId)` — 需要新增，或基于 `getUsersByRole` 结果过滤 `departmentId`

---

## 设计方案

### 2.1 数据模型扩展

```typescript
// 审批人策略配置
export interface ApproverConfig {
  type: "user" | "role" | "role_dept" | "starter" | "starter_manager" | "starter_director" | "expression";
  value?: string;           // userId / roleId / expression
  deptId?: string;          // role_dept 时生效
}

// 会签策略
export interface SignPolicy {
  mode: "sequential" | "parallel";      // 顺序 / 并行
  condition: "all" | "any" | "majority"; // 通过条件
  minCount?: number;        // majority 时的最少通过数
}

// 发起人限制
export interface StarterConstraint {
  type: "role" | "department";
  value: string;
  message?: string;
}

// UserTaskNode 扩展（向后兼容）
export interface UserTaskNode extends BaseNode {
  type: "user_task";
  form?: FormSchema;
  
  // 原有字段保留兼容
  assignee?: string;
  assigneePolicy?: string;
  
  // 新增：审批人配置（优先于旧字段）
  approvers?: ApproverConfig[];
  
  // 新增：会签策略
  signPolicy?: SignPolicy;
  
  candidateUsers?: string[];
  candidateGroups?: string[];
  actions?: TaskAction[];
  dueDuration?: string;
  reminder?: ReminderConfig;
}

// WorkflowSpec 扩展
export interface WorkflowSpec {
  key: string;
  name: string;
  nodes: WorkflowNode[];
  starterConstraints?: StarterConstraint[];  // 流程级发起人限制
}
```

### 2.2 审批人解析引擎

替换现有 `resolveAssignee`，新增 `resolveApprovers`：

```typescript
async resolveApprovers(
  instance: WorkflowInstance,
  configs: ApproverConfig[]
): Promise<string[]> {
  const approvers = new Set<string>();
  for (const config of configs) {
    const users = await this.resolveApproverConfig(instance, config);
    users.forEach(u => approvers.add(u));
  }
  return Array.from(approvers);
}

private async resolveApproverConfig(
  instance: WorkflowInstance,
  config: ApproverConfig
): Promise<string[]> {
  switch (config.type) {
    case "user":
      return config.value ? [config.value] : [];
    case "starter":
      return [instance.starter];
    case "starter_manager": {
      const starter = await getUserById(instance.starter);
      return starter?.manager ? [starter.manager] : [];
    }
    case "starter_director": {
      const starter = await getUserById(instance.starter);
      return starter?.director ? [starter.director] : [];
    }
    case "role":
      return (await getUsersByRole(config.value!)).map(u => u.id);
    case "role_dept": {
      const users = await getUsersByRole(config.value!);
      return users.filter(u => u.departmentId === config.deptId).map(u => u.id);
    }
    case "expression": {
      // 表达式解析为 userId 字符串
      const result = this.guardEngine.evaluate(config.value!, { variables: instance.variables, instance });
      const userId = String(result ?? "");
      return userId ? [userId] : [];
    }
    default:
      return [];
  }
}
```

### 2.3 会签任务处理

**并行会签模式（默认）：**
1. `handleUserTask` 解析出多个审批人 → `resolveApprovers()`
2. 若审批人数量为 1，创建普通任务
3. 若审批人数量 > 1：
   - 为每个审批人创建独立 `WorkflowTask`
   - 所有任务标记 `signGroup: node.id`
   - 存储会签策略到 `instance.variables`：`{ __sign_policy: { nodeId, total, condition, minCount } }`
4. `completeTask` 完成时：
   - 检查同 `signGroup` 的其他任务状态
   - 根据 `condition` 判断是否满足通过条件
   - `all`: 全部完成且通过 → 推进
   - `any`: 任一通过 → 推进，取消其他任务
   - `majority`: 通过数 ≥ minCount → 推进

**任务状态查询扩展：**
```typescript
export interface WorkflowTask {
  // ... 原有字段
  signGroup?: string;       // 会签组标识（nodeId）
  signIndex?: number;       // 会签组内序号
}
```

### 2.4 发起人限制检查

在 `startInstance` 中，实例创建后、任务创建前增加检查：

```typescript
// 检查流程级发起人限制
if (def.definition.starterConstraints) {
  for (const constraint of def.definition.starterConstraints) {
    const passed = await this.checkStarterConstraint(starter, constraint);
    if (!passed) {
      return { success: false, error: new Error(constraint.message || `发起人不满足条件`) };
    }
  }
}

// 检查第一个 user_task 的节点级限制（如果有）
```

---

## 实施步骤

### Phase 1: 修复 MySQL JSON 类型兼容（阻断性问题）
- [ ] 修复 `getVariable` / `getVariables`（SQLite + MySQL）中的 `JSON.parse` → 兼容对象输入
- [ ] 修复 `mapConnection` 中的 `JSON.parse` → 兼容对象输入
- [ ] 验证 `contract_approval` 可正常查询和提交

### Phase 2: 审批人策略扩展
- [ ] 扩展 `WorkflowNode` / `WorkflowSpec` / `WorkflowTask` 类型定义
- [ ] 实现 `resolveApprovers` 引擎（支持 role / role_dept / starter_manager / starter_director / user / expression）
- [ ] 修改 `handleUserTask` 支持多人审批和会签
- [ ] 修改 `completeTask` 支持会签条件判断
- [ ] 实现 `checkStarterConstraint` 发起人限制检查
- [ ] 新增 `getUsersByRoleAndDept` 辅助接口（或复用 `getUsersByRole` + 过滤）

### Phase 3: 测试与验证
- [ ] 单元测试覆盖所有新策略
- [ ] 集成测试验证会签流程（全部通过 / 任一通过 / 多数通过）
- [ ] 回归测试确保旧策略（assignee / assigneePolicy）兼容

---

## 技术风险与兼容策略

| 风险 | 缓解措施 |
|------|----------|
| MySQL JSON 类型兼容性 | 所有 JSON 字段映射统一做 `typeof === 'object'` 判断，兼容字符串和对象 |
| 向后兼容性 | `approvers` 不存在时回退到 `assignee` / `assigneePolicy`；`signPolicy` 不存在时按单任务处理 |
| 会签状态一致性 | 使用 `instance.variables` 存储会签策略状态，避免额外表；`completeTask` 时原子更新 |
| 用户体系依赖 | 复用现有 `user-repository` 接口，仅新增 `getUsersByRoleAndDept`（或内联过滤） |

---

## 预估工作量

- Phase 1（JSON 修复）：0.5 天
- Phase 2（策略扩展）：2 天
- Phase 3（测试验证）：1 天
- **总计：3.5 天**
