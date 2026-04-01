# RAOS 工程推进计划

> Recursive Agent Operating System — 从 MVP 到终极形态的阶段化路线图

---

## 当前状态 (v1.0.0 — ✅ 已发布)

| 模块 | 状态 | 说明 |
|------|------|------|
| Skill 类型系统 | ✅ | Autonomy、RetryPolicy、SkillDefinition、AsyncTaskHandle、CircuitBreaker、Capabilities、ErrorPropagation |
| SkillRegistry | ✅ | 注册/注销/查找/列表/可见性过滤 |
| DAG 验证器 | ✅ | Kahn 算法环检测 + 拓扑排序 |
| 递归执行引擎 | ✅ | AUTO_PRE/POST、深度限制、调用预算、超时、重试、SAGA 补偿、熔断器、错误传播控制 |
| GUARDIAN 执行 | ✅ | 不可超时中断的守护级执行 |
| WAL 管理 | ✅ | FileWALStore 文件持久化 + 恢复 |
| LLM 集成 | ✅ | OpenAI/Claude/OpenAI-Compatible 三种 Provider |
| Agent Loop | ✅ | ReAct 循环 + Tool-use 桥接 + 自动记忆提取 |
| 记忆系统 (STM) | ✅ | 内存 LRU + TTL + 关键词搜索 |
| 记忆系统 (LTM) | ✅ | 文件持久化 + 搜索 + 归档 + 定时归档 |
| 记忆 Skills | ✅ | 14 个记忆 Skill（存储/检索/归档/恢复/调度） |
| 插件加载器 | ✅ | 目录扫描 + skill.json 清单 + 热加载 + 事件系统 |
| 异步任务管理 | ✅ | AsyncTaskManager：创建/进度/完成/等待/回调 |
| 多模态接口 | ✅ | MultimodalProvider 接口 + 生成/理解 Skills |
| 测试 UI | ✅ | 5 页面：Skills/Chat/Memory/Config/Admin + 归档调度 + 调用树可视化 |
| 单元测试 | ✅ | 112 tests passing |
| 权限体系 | ✅ | 用户+角色+部门交叉控制，14 API 资源 + 动态 Skill 资源 |
| 认证系统 | ✅ | Session Token + Bearer Auth + 登录/登出 |
| 部门管理 | ✅ | 树形部门 + 物化路径继承 + 资源分配 |
| Admin UI | ✅ | 用户/部门/角色/资源管理页面 |
| 多层次智能体 | ✅ | Simple/ReAct/Team 三级智能体 |
| 协作协议 | ✅ | 7 种协议：HIERARCHICAL/SEQUENTIAL/SWARM/A2A/CONTRACT_NET/MARKET_BASED/BLACKBOARD |
| Orchestrator | ✅ | 自动策略选择器，根据任务复杂度决定智能体级别和协议 |
| 数据操作 Skills | ✅ | file_read/write/append/delete/list, http_call, shell_exec |
| 元 Skills | ✅ | skill_compose/from_template/from_description/info/optimizer/unregister |
| 指标收集 | ✅ | MetricsCollector：成功率、耗时分位数、错误分布 + API |
| SAGA 补偿事务 | ✅ | 执行失败时反向补偿已完成步骤 |
| 熔断器 | ✅ | CircuitBreaker：CLOSED→OPEN→HALF_OPEN 三态，可配置阈值和恢复时间 |
| 结构化日志 | ✅ | 事件驱动日志 + 可插拔 Sink + Skill 执行全链路日志 |
| 错误传播控制 | ✅ | PRE 失败可选阻断/忽略，POST 失败可选影响/隔离 |
| 增强重试 | ✅ | jitter 随机抖动 + 指数退避上限 maxBackoffMs |
| 调用树可视化 | ✅ | UI 中树形展示递归调用关系 |
| Skill 版本 | ✅ | semver 版本字段（version） |
| Skill 能力声明 | ✅ | capabilities 权限声明 + CapabilityChecker 验证器 |
| Skill 自生成 | ✅ | skill_from_description：LLM 驱动从自然语言描述生成 Skill |
| Skill 优化分析 | ✅ | skill_optimizer：根据指标自动检测性能/可靠性问题 |
| Skill 自动测试 | ✅ | skill_test：手动/LLM 自动生成测试用例并执行 |
| Skill 多版本共存 | ✅ | registerVersion/switchVersion/getVersions |
| Worker 沙箱 | ✅ | Worker Thread 隔离执行 + 内存/CPU 限制 |
| 进化控制器 | ✅ | 生成深度/速率限制 + 人工审批流程 + 价值对齐检查 |
| Prompt 管理 | ✅ | 模板注册/渲染/版本管理 + API + 3 个 Skill |
| 模型路由 | ✅ | 多模型注册 + 基于任务类型/成本/能力的自动路由选择 |
| Skill 列表全景 | ✅ | skill_list_all：含版本、能力、指标的完整信息 |
| Skill 自动测试 | ✅ | skill_test：手动/LLM 自动生成测试用例并执行 |
| 渐进式部署 | ✅ | Canary 部署 + 自动提升/回滚 |
| Skill 生命周期 | ✅ | active/canary/deprecated/retired 状态管理 + 自动淘汰 |
| 多步规划 | ✅ | plan_and_execute：LLM 规划→逐步执行→动态重规划 |
| Skill 市场 | ✅ | 导出/导入/发布/搜索 + 标准化 SkillPackage 格式 |

---

## Phase 1: 核心稳固 (v0.2 — 预计 2~3 周)

### 1.1 状态持久化
**目标**：WAL 从内存迁移到可持久化后端

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| FileWALStore | P0 | 中 | 基于 JSON Lines 的文件 WAL，支持 append-only 写入 |
| WAL 恢复流程 | P0 | 中 | 从 WAL 文件恢复未完成的 Skill 执行，自动重放 |
| WAL 压缩 | P1 | 低 | 定期合并已完成条目，控制文件大小 |
| SQLite WALStore | P2 | 低 | 可选的 SQLite 后端，适合嵌入式场景 |

### 1.2 错误处理增强
| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 补偿事务 Skill | P0 | 高 | 执行失败时自动调用补偿逻辑（SAGA 模式） |
| 重试策略增强 | P1 | 中 | 支持 jitter、circuit breaker、指数退避上限 |
| 错误传播控制 | P1 | 中 | AUTO_PRE 失败是否阻断主 Skill、AUTO_POST 失败是否影响结果 |

### 1.3 可观测性
| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 结构化日志 | P0 | 低 | 每个 Skill 执行产出标准化日志 |
| 调用树可视化 | P1 | 中 | 在 UI 中以树形展示递归调用关系（非平铺列表） |
| 指标收集 | P1 | 中 | Skill 平均耗时、成功率、调用频率 |
| 分布式 TraceID | P2 | 低 | 支持跨进程的 trace 传播 |

### 1.4 测试体系
| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| Registry 完整测试 | P0 | 低 | 覆盖 register/unregister/可见性过滤 |
| WAL 测试 | P0 | 低 | 覆盖崩溃恢复场景 |
| 集成测试 | P1 | 中 | 端到端：注册→执行→trace→WAL 全链路 |

---

## Phase 2: 记忆系统 — 元 Skill 实现 (v0.3 — 预计 3~4 周)

> raos.md 核心观点：「记忆不仅是数据存储，更是计算的一部分」

### 2.1 短期记忆 (STM)

```
stm_store    → 写入当前会话上下文
stm_retrieve → 从会话上下文检索
stm_forget   → 主动释放（上下文窗口管理）
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| STM 作为内置 Skill | P0 | 中 | 实现 stm_store/stm_retrieve/stm_forget 三个系统 Skill |
| 会话上下文管理 | P0 | 中 | ExecutionContext 扩展，支持会话级键值存储 |
| 上下文窗口限制 | P1 | 中 | STM 容量限制 + LRU 淘汰策略 |
| STM 对模型部分可见 | P1 | 低 | 模型可 retrieve 但不可直接操作底层存储 |

### 2.2 长期记忆 (LTM)

```
ltm_store       → 持久化存储（向量数据库/文件）
ltm_search      → 语义检索
ltm_summarize   → 记忆压缩/摘要
ltm_consolidate → 短期→长期迁移
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| LTM 存储后端接口 | P0 | 中 | 定义 LTMStore trait，支持多后端 |
| 文件 LTM 实现 | P0 | 中 | 基于 JSON 文件 + 简单全文搜索的 MVP 实现 |
| 向量 LTM 实现 | P1 | 高 | 接入向量数据库（如本地 hnswlib 或远程 Qdrant） |
| ltm_consolidate | P1 | 高 | 自动将频繁访问的 STM 数据沉淀到 LTM |
| ltm_summarize | P2 | 高 | 调用 LLM 对记忆进行摘要压缩 |

### 2.3 元记忆 Skill (对模型不可见，自动执行)

```
checkpoint      → GUARDIAN, AUTO_PRE — 自动保存执行状态
recall_context  → AUTO_PRE — 自动注入相关记忆
gc_collect      → AUTO_POST — 记忆垃圾回收
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| recall_context 实现 | P0 | 高 | 执行 Skill 前自动从 LTM 检索相关信息注入 context |
| checkpoint 增强 | P1 | 中 | 从简单 WAL 升级为完整的执行快照 |
| gc_collect | P2 | 中 | 定期清理低价值记忆，释放存储 |
| 记忆版本控制 | P2 | 高 | 每个记忆操作带版本号，支持时间旅行查询 |

### 2.4 高阶深化：记忆的自指性

> 这是 RAOS 最精妙的设计 —— 记忆 Skill 也需要记忆

**递归记忆层级**：
```
第3层：模型调用 ltm_search("上次的预订")
  第2层：ltm_search 内部调用 stm_retrieve("当前会话上下文")
    第1层：checkpoint 自动保存 "正在执行 ltm_search" 的状态
      第0层：实际的向量索引/Redis/文件系统操作
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 记忆 Skill 的递归调用安全 | P0 | 高 | 防止 ltm_search → stm_retrieve → ltm_search 无限递归 |
| 记忆访问缓存 | P1 | 中 | 同一执行链内相同查询结果缓存 |
| 记忆配额限制 | P1 | 中 | 防止模型通过记忆 Skill 污染上下文（rate limiting） |
| 记忆重要性评分 | P2 | 高 | 自动评估记忆价值，决定保留/淘汰 |

---

## Phase 3: 插件化与动态加载 (v0.4 — 预计 4~6 周)

> 从硬编码到运行时可扩展

### 3.1 Skill 动态注册

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 文件系统 Skill 加载 | P0 | 中 | 扫描指定目录加载 .ts/.js Skill 文件 |
| 热加载 | P1 | 高 | 文件变更时自动重新加载 Skill（不重启服务） |
| Skill 包格式定义 | P1 | 中 | 定义 skill.json manifest + handler 文件的标准包格式 |
| 远程 Skill 加载 | P2 | 高 | 从 npm / git repo / HTTP URL 加载 Skill |

### 3.2 Skill 沙箱隔离

> raos.md 原方案是 WASM，Node.js 体系可用 VM/Worker 替代

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| Worker Thread 沙箱 | P0 | 高 | 不信任的 Skill 在 Worker 中运行，隔离主线程 |
| 资源限制 | P1 | 高 | 限制 Worker 的 CPU 时间/内存使用 |
| Node.js VM Context | P1 | 中 | 轻量级沙箱，限制可用 API |
| WASM 运行时 (可选) | P2 | 极高 | 通过 wasmtime-js 支持 WASM Skill |

### 3.3 权限系统

```
{
  "skill": "file_delete",
  "required_permissions": ["file:delete:/tmp/*"],
  "capabilities": ["network:outbound:mysql:3306"]
}
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 权限声明模型 | P0 | 中 | Skill 声明所需权限（capabilities） |
| 权限验证引擎 | P0 | 中 | 执行前检查 Skill 是否有足够权限 |
| 权限传播 | P1 | 高 | 递归调用中权限的继承与收窄 |
| Skill 签名验证 | P2 | 中 | 验证 Skill 来源的可信性 |

### 3.4 版本管理

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| Skill semver 版本 | P0 | 低 | SkillDefinition 增加 version 字段 |
| 多版本共存 | P1 | 中 | 同名 Skill 不同版本可同时注册 |
| 依赖版本约束 | P1 | 中 | dependencies 支持版本范围声明 |
| 兼容性检测 | P2 | 高 | 自动检测版本升级是否破坏现有依赖 |

---

## Phase 4: 数据操作 Skill 家族 (v0.5 — 预计 4~6 周)

> 「一切皆 Skill」的真正落地 —— 数据库、文件、网络都是 Skill

### 4.1 统一数据操作接口

```typescript
interface DataSkill {
  query(sql: string, params: unknown[]): Promise<Dataset>;
  execute(sql: string, params: unknown[]): Promise<number>;
  begin(): Promise<Transaction>;
}
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| DataSkill 接口定义 | P0 | 中 | 统一的数据操作 trait |
| SQLite Skill | P0 | 中 | better-sqlite3 包装，MVP 验证 |
| MySQL Skill | P1 | 中 | mysql2 包装 |
| PostgreSQL Skill | P1 | 中 | pg 包装 |
| Redis Skill | P1 | 中 | ioredis 包装 |
| MongoDB Skill | P2 | 中 | mongodb 包装 |

### 4.2 文件系统 Skill

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| file_read / file_write | P0 | 低 | 基础文件操作 Skill |
| file_watch | P1 | 中 | 文件变更监听 Skill |
| S3 兼容 Skill | P2 | 中 | 对象存储操作 |

### 4.3 通信协议 Skill

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| http_call Skill | P0 | 低 | HTTP 客户端（fetch 包装） |
| websocket Skill | P1 | 中 | WebSocket 双向通信 |
| 消息队列 Skill | P2 | 高 | Kafka/RabbitMQ/NATS 包装 |

### 4.4 连接池管理

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 连接池作为 Skill | P1 | 高 | 连接池本身是一个管理型 Skill，被数据 Skill 依赖 |
| 池状态监控 | P1 | 中 | 通过 UI 可视化连接池状态 |

---

## Phase 5: 模型集成与智能编排 (v0.6 — 预计 4~6 周)

> 让 LLM 成为 RAOS 的「大脑」，实现真正的智能体

### 5.1 LLM 集成层

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| LLM 调用 Skill | P0 | 中 | 包装 OpenAI/Claude API 为 Skill |
| Tool-use 桥接 | P0 | 高 | 将 visible Skills 转换为 LLM function/tool 定义 |
| 模型选择路由 | P1 | 中 | 根据任务复杂度自动选择模型 |
| Prompt 管理 Skill | P1 | 中 | Prompt 模板的存储、版本、A/B 测试 |

### 5.2 智能编排

> raos.md 核心：「模型可以根据任务需求动态组合 Skill，无需预定义流程」

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| ReAct 循环 Skill | P0 | 高 | 实现 Reason→Act→Observe 循环作为顶层 Skill |
| 动态 Skill 选择 | P0 | 高 | 模型基于可见 Skill 列表自主决策调用哪些 |
| 多步规划 Skill | P1 | 高 | 模型先规划执行计划，再按计划调用 Skill 序列 |
| 自适应重试 | P2 | 高 | 模型分析失败原因，决定重试策略（而非固定策略） |

### 5.3 对话与会话管理

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 会话 Skill | P0 | 中 | 管理多轮对话的上下文 |
| 上下文窗口管理 | P1 | 高 | 智能裁剪、摘要、记忆注入 |
| 多智能体会话 | P2 | 极高 | 多个 agent 之间的消息传递 |

---

## Phase 6: Skill 自我繁殖 — 终极形态 (v1.0 — ✅ 已完成)

> 「Skill 能够生成 Skill，系统能够自我进化」

### 6.1 元 Skill：创造者

```
skill_generator   → 从描述生成新 Skill
skill_composer    → 组合多个 Skill 为新 Skill
skill_optimizer   → 分析和优化现有 Skill
skill_translator  → 跨格式转换 Skill
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| skill_from_template | P0 | 中 | 基于参数化模板生成 Skill（Phase 1 生成能力） |
| skill_composer | P0 | 高 | 声明式组合多个 Skill 为一个新 Skill |
| skill_from_description | P1 | 极高 | LLM 驱动，从自然语言描述生成 Skill 代码 |
| skill_optimizer | P2 | 极高 | 分析 Skill 执行指标，自动生成优化版本 |

### 6.2 质量保证体系

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 自动测试生成 | P0 | 高 | 为生成的 Skill 自动生成单元测试 |
| 渐进式部署 | P1 | 高 | 新 Skill 先小流量运行，达到置信度后全量 |
| 自动回滚 | P1 | 中 | 监控异常指标，自动切回旧版 |
| 形式化验证 | P2 | 极高 | 对 Skill 依赖图建模，证明终止性 |

### 6.3 自我进化循环

```
观察（收集执行指标）
  → 学习（分析瓶颈）
    → 优化/生成（改进或创造 Skill）
      → 验证（测试新 Skill）
        → 部署（渐进式上线）
          → 观察...
```

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 执行指标采集 | P0 | 中 | Skill 级别的成功率、延迟、调用频率 |
| 瓶颈自动检测 | P1 | 高 | 识别系统中的性能热点和失败聚集 |
| 进化循环引擎 | P2 | 极高 | 自动化的「观察→学习→优化→部署」闭环 |
| 生成深度限制 | P0 | 中 | max_generation_depth + 资源预算机制 |
| Skill 生命周期管理 | P1 | 高 | 长期无用的 Skill 自动回收（适者生存） |

### 6.4 高阶深化：涌现行为控制

**这是整个系统最困难也最有价值的部分。**

当 Skill 开始生成 Skill，系统行为将变得不完全可预测。需要：

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 价值对齐框架 | P0 | 极高 | 定义「好的 Skill」的评价标准，所有生成必须通过 |
| 人类监督环 | P0 | 中 | 重大进化决策需人工批准，提供撤销机制 |
| 涌现行为检测 | P1 | 极高 | 检测系统产生的非预期行为模式 |
| 进化方向约束 | P1 | 高 | 设定「不可变红线」—— 系统永远不能突破的安全边界 |
| Skill 族群分析 | P2 | 高 | 追踪 Skill 的「基因树」，理解进化路径 |

---

## Phase 7: 多智能体与生态系统 (v2.0 — 长期愿景)

| 任务 | 说明 |
|------|------|
| Skill 市场 | Skill 可在智能体间共享和交易 |
| 多智能体协作 | 不同 agent 各自拥有 Skill 集合，通过协议互操作 |
| 跨实例 Skill 迁移 | Skill 连同其记忆可在不同 RAOS 实例间迁移 |
| 联邦式 Skill 学习 | 多个 RAOS 实例共享进化经验（不共享数据） |

---

## 关键技术风险总览

| 风险 | 阶段 | 严重度 | 应对 |
|------|------|--------|------|
| 递归爆炸 | Phase 1-2 | 高 | 编译期 DAG 环检测 ✅ + 运行时深度限制 ✅ + 调用预算 ✅ |
| 记忆递归死循环 | Phase 2 | 高 | 记忆 Skill 间禁止循环依赖 + 访问缓存 |
| 状态不一致 | Phase 1 | 高 | WAL 预写日志 ✅ + 补偿事务 |
| 动态加载安全 | Phase 3 | 极高 | Worker 沙箱 + 权限声明 + 签名验证 |
| 生成 Skill 质量 | Phase 6 | 极高 | 自动测试 + 渐进部署 + 自动回滚 |
| 涌现失控 | Phase 6 | 致命 | 价值对齐 + 人类监督 + 红线约束 |
| 性能衰减 | 全阶段 | 中 | 调用树剪枝 + 缓存 + 并行执行 |

---

## 评估指标体系

| 指标 | 目标 (v0.5) | 目标 (v1.0) | 说明 |
|------|-------------|-------------|------|
| 弹性系数 | >50% | >80% | 未预定义流程成功处理的任务占比 |
| 递归效率 | <100ms/层 | <50ms/层 | 平均响应时间 / 递归深度 |
| Skill 复用率 | >3次 | >10次 | 平均每个 Skill 被调用次数 |
| 安全违规数 | <1次/天 | 0 | 模型尝试调用不可见 Skill 的次数 |
| 恢复时间 | <5s | <1s | 从崩溃到完全恢复 |
| 新 Skill 接入成本 | <1人天 | <1小时 | 新增一个数据库/协议类型 Skill 的时间 |
| 自动生成成功率 | N/A | >70% | LLM 生成 Skill 可直接使用的比率 |

---

## 里程碑总览

```
v0.1 ✅ ── 核心引擎 MVP
 │
v0.2 ✅ ── 持久化 + 可观测性 + 错误处理增强
 │
v0.3 ✅ ── 记忆系统（STM + LTM + 元记忆）
 │
v0.4 ✅ ── 插件化 + 沙箱 + 权限
 │
v0.5 ✅ ── 数据操作 Skill 家族
 │
v0.6 ✅ ── LLM 集成 + 智能编排 + 多层次智能体
 │
v0.7 ✅ ── SAGA + 熔断器 + 进化控制 + Prompt 管理
 │
v0.8 ✅ ── 多步规划 + Skill 市场 + 生命周期管理
 │
v1.0 ── Skill 自我繁殖 + 自进化（大部分完成）
 │
v2.0 ── 多智能体生态系统（基础框架已完成）
```

**预估总工期**：v0.1→v1.0 约 6~9 个月（单人），v2.0 需要团队协作。
