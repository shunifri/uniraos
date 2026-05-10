# RAOS 整体架构文档

> **Recursive Agent Operating System** — 基于统一 Skill 抽象的自适应智能体操作系统  
> **版本**: v2.0 + Phase 3 迭代中  
> **日期**: 2026-04-28

---

## 1. 系统全景

RAOS 是一个**递归式智能体操作系统**，核心思想是：**"编排本质上是一组特殊的、底层的 Skill"**。所有能力（包括传统意义上的编排逻辑）统一抽象为 Skill，通过递归调用和可见性控制实现自适应系统。

### 1.1 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户交互层                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Chat    │ │ Admin    │ │ Evolution│ │ Workflow │           │
│  │  对话    │ │ 管理后台 │ │ 进化面板 │ │ 流程引擎 │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       └─────────────┴─────────────┴─────────────┘               │
│                         React 18 + Vite                         │
├─────────────────────────────────────────────────────────────────┤
│                         API 网关层                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Express  │ │ Auth     │ │ Permission│ │ SSE     │           │
│  │ Routes   │ │ Middleware│ │ Middleware│ │ Events  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
├─────────────────────────────────────────────────────────────────┤
│                         核心引擎层                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Execution│ │ Skill    │ │ Agent    │ │ Workflow │           │
│  │ Engine   │ │ Registry │ │ Loop     │ │ Engine   │           │
│  │ (递归执行)│ │ (DAG)    │ │ (ReAct)  │ │ (Lite)   │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Evolution│ │ Federation│ │ Inbox   │ │ Scheduler│           │
│  │ Controller│ │ Manager  │ │ Service │ │ Service  │           │
│  │ (进化控制)│ │ (联邦)   │ │ (收件箱)│ │ (调度)   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
├─────────────────────────────────────────────────────────────────┤
│                         能力层（Skills）                          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │Meta    │ │Data    │ │Web     │ │Memory  │ │Document│       │
│  │Skills  │ │Skills  │ │Skills  │ │Skills  │ │Skills  │       │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │Knowledge│ │Workflow│ │Graph   │ │Scheduler│ │Enterprise│   │
│  │Skills  │ │Skills  │ │Skills  │ │Skills  │ │Skills  │       │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
├─────────────────────────────────────────────────────────────────┤
│                         基础设施层                                │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │WAL     │ │Memory  │ │Vector  │ │Graph   │ │Database│       │
│  │(File)  │ │(STM/LTM)│ │(Qdrant)│ │(Neo4j) │ │(SQLite/│       │
│  │        │ │        │ │        │ │        │ │ MySQL) │       │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │Redis   │ │RabbitMQ│ │Bull    │ │Plugin  │ │Worker  │       │
│  │Session │ │Queue   │ │Queue   │ │Loader  │ │Sandbox │       │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **一切皆 Skill** | 系统所有能力（业务逻辑、系统服务、编排逻辑）统一抽象为 Skill |
| **递归调用** | AUTO_PRE → 执行 → AUTO_POST 的递归链，天然形成调用树 |
| **可见性控制** | `visible=true` 的 Skill 才对模型可见，建立安全边界 |
| **DAG 验证** | Kahn 算法检测循环依赖，确保递归终止 |
| **WAL 持久化** | 每次 execute_skill 前写入 WAL，崩溃后自动恢复 |
| **Worker 沙箱** | 动态生成的 Skill 代码在 Worker Thread 中隔离执行 |

---

## 2. 核心模块详解

### 2.1 Skill 元模型

```typescript
interface SkillDefinition {
  name: string;              // 唯一标识
  visible: boolean;          // 模型可见性
  autonomy: AutonomyLevel;   // MANUAL / AUTO_PRE / AUTO_POST / GUARDIAN
  dependencies: string[];    // 依赖的 Skill 名称（DAG 边）
  timeout: number;           // 执行超时（毫秒）
  retry: RetryPolicy;        // 重试策略
  compensate?: string;       // SAGA 补偿 Skill
  circuitBreaker?: CBConfig; // 熔断器配置
  capabilities: string[];    // 能力声明（权限控制）
  paramSchema?: ParamSchema; // 参数 Schema（运行时校验）
}
```

### 2.2 执行引擎（Execution Engine）

**职责**: Skill 的递归执行、超时控制、重试、熔断、SAGA 补偿

**核心流程**:
```
execute(skill, params, context)
  ├── DAG 验证（Kahn 算法，检测循环依赖）
  ├── 调用预算检查（防止无限递归）
  ├── 能力校验（CapabilityChecker）
  ├── WAL 写入（checkpoint）
  ├── 执行 AUTO_PRE 依赖链（递归）
  ├── 执行当前 Skill（带 timeout / circuitBreaker）
  ├── 执行 AUTO_POST 依赖链（递归）
  ├── WAL 标记完成
  └── 返回结果
```

**关键子模块**:
- `AsyncTaskManager`: 异步任务创建、进度追踪、完成回调
- `CircuitBreaker`: CLOSED → OPEN → HALF_OPEN 三态熔断
- `SagaCompensator`: 失败时反向调用补偿 Skill
- `ErrorPropagator`: PRE 失败阻断/忽略，POST 失败影响/隔离

### 2.3 Skill 注册表（SkillRegistry）

**职责**: Skill 的注册、注销、查找、列表、可见性过滤、版本管理

**数据结构**:
```
SkillRegistry
  ├── skills: Map<name, SkillDefinition[]>
  ├── versions: Map<name, semver[]>
  ├── dag: Map<name, Set<dependency>>
  └── visibilityFilter: (skill, context) => boolean
```

**关键能力**:
- 多版本共存（active / canary / deprecated / retired）
- 可见性动态过滤（基于用户角色、上下文）
- DAG 拓扑排序（Kahn 算法）

### 2.4 Agent Loop

**职责**: 驱动大模型与 Skill 系统的交互循环

**流程（ReAct 变体）**:
```
1. 接收用户输入
2. 构建上下文（STM 检索 + LTM 检索 + 系统提示）
3. 调用 LLM 获取 Thought + Action
4. 解析 Action（结构化协议解析）
5. 调用对应 Skill
6. 将结果反馈给 LLM
7. 循环直到任务完成或达到 maxIterations
```

**三级 Agent**:
| 级别 | 类型 | 适用场景 |
|------|------|---------|
| L1 | SimpleAgent | 单步任务，直接调用 |
| L2 | ReActAgent | 多步推理，Tool-use |
| L3 | TeamAgent | 多 Agent 协作，Orchestrator 调度 |

### 2.5 记忆系统

**STM（短期记忆）**:
- 内存 LRU + TTL 缓存
- 关键词搜索
- 自动向 LTM 归档（触发条件：容量上限 / 时间阈值）

**LTM（长期记忆）**:
- 文件持久化 / MySQL 持久化
- 向量检索（Qdrant）
- 知识图谱（Neo4j / MySQL）
- 版本链管理 + 冲突检测

**Meta-Memory（元记忆）**:
- `recall_context`（AUTO_PRE）: 自动提取相关上下文
- `gc_collect`（GUARDIAN）: 垃圾回收过期记忆
- 用户画像自动生成

### 2.6 进化控制器（EvolutionController）

**职责**: Skill 的自我进化闭环

**五执行器**:
| 执行器 | 职责 | 触发条件 |
|--------|------|---------|
| OptimizeExecutor | 性能/可靠性优化 | 指标恶化（成功率 < 阈值） |
| GenerateExecutor | 从描述生成新 Skill | 用户需求 / 技能缺口 |
| CanaryExecutor | 金丝雀部署 | 新 Skill 生成后 |
| AdoptExecutor | 提升 canary → active | 金丝雀指标达标 |
| RetireExecutor | 淘汰废弃 Skill | 长期未使用 / 替代出现 |

**安全机制**:
- 生成深度/速率限制
- 人工审批工作流（Inbox 集成）
- 价值对齐检查
- 资源预算（进化税机制）

### 2.7 联邦管理（Federation）

**职责**: 跨 RAOS 实例的 Skill 共享与协作

**核心组件**:
- `FederationManager`: 实例注册、心跳、同步
- `SkillMigrationManager`: Skill 导出/导入/迁移
- `EvolutionEngine`: 跨实例进化策略共享
- `HttpFederationTransport`: HTTP 传输层

### 2.8 工作流引擎（Workflow Engine Lite）

**职责**: 轻量级业务流程编排

**设计决策**: 不引入 Camunda/Flowable 等重型 BPMN 引擎，采用 JSON DSL（AI 友好）

**核心概念**:
- States / Transitions / Guards / Actions（借鉴 xstate）
- 4 张表: workflow_definitions, workflow_instances, workflow_tasks, workflow_variables
- Skill 是外部接口，引擎是内部实现

### 2.9 统一收件箱（Inbox）

**职责**: 所有需要用户被动响应的事件统一抽象为 InboxItem

**事件类型**: approval / notification / task / alert
**投递渠道**: Chat / Inbox Badge / Email / IM / Push
**AI Review**: 审批类事件自动触发 LLM 建议

### 2.10 时间感知调度器（Scheduler）

**职责**: 基于 Bull 队列的定时任务调度

**触发模式**: absolute / relative / cron / conditional
**动作类型**: inbox / chat / email / im / webhook / skill
**升级机制**: 超时未响应自动升级投递渠道

---

## 3. 数据流

### 3.1 典型请求流（Chat → Skill 执行）

```
用户输入
  ↓
前端 (React) → HTTP POST /api/agent/chat
  ↓
Express Route → Auth Middleware → Permission Middleware
  ↓
AgentLoop (ReAct)
  ├── 1. 检索 STM/LTM（记忆 Skills）
  ├── 2. 构建 Prompt（PromptManager）
  ├── 3. 调用 LLM Provider（ModelRouter 选择模型）
  ├── 4. 解析 Action（结构化协议解析）
  ├── 5. 调用 Skill（ExecutionEngine）
  │     ├── WAL 写入
  │     ├── DAG 验证
  │     ├── 递归执行依赖链
  │     └── 返回结果
  ├── 6. 结果反馈给 LLM
  └── 7. 循环或结束
  ↓
SSE 推送 → 前端展示
```

### 3.2 Skill 自进化流

```
指标恶化 / 用户需求
  ↓
EvolutionController
  ├── 1. GenerateExecutor: LLM 生成新 Skill 代码
  ├── 2. Worker 沙箱测试
  ├── 3. 人工审批（Inbox）
  ├── 4. CanaryExecutor: 金丝雀部署
  ├── 5. 指标监控
  ├── 6. AdoptExecutor: 提升为 active
  └── 7. 旧版本 RetireExecutor 淘汰
```

### 3.3 文档处理流（KB 入库）

```
上传文档
  ↓
File Routes → 保存到 uploads/
  ↓
ParsingQueue (RabbitMQ) → DocMindParser
  ├── 文本提取
  ├── 图片提取（OCR / VLM）
  ├── 表格提取
  └── 结构化输出
  ↓
KnowledgeBase
  ├── 分块（Chunking）
  ├── Embedding（OpenAIEmbeddingProvider）
  ├── 向量存储（Qdrant）
  ├── 图索引（Neo4j / MySQL）
  └── 全文索引（SQLite FTS / MySQL）
```

---

## 4. 技术栈矩阵

| 层次 | 组件 | 技术选型 | 备选方案 |
|------|------|---------|---------|
| **运行时** | 后端 | Node.js 20 + TypeScript (strict) | Deno / Bun |
| | 前端 | React 18 + Vite + Ant Design X | Vue / Angular |
| **Web 框架** | API | Express 4 | Fastify / Koa |
| | 状态管理 | Zustand (frontend) | Redux / Jotai |
| **数据库** | 关系型 | SQLite (dev) / MySQL 8.0 (prod) | PostgreSQL |
| | 向量 | Qdrant v1.9.0 | Pinecone / Weaviate |
| | 图 | Neo4j (可选) / MySQL 模拟 | ArangoDB |
| | 缓存/会话 | Redis 7 | KeyDB |
| **消息队列** | 异步任务 | RabbitMQ 3.12 | Kafka / NATS |
| | 定时调度 | Bull (Redis) | Agenda / node-cron |
| **LLM** | 文本 | OpenAI / Claude / OpenAI-Compatible | - |
| | 多模态 | OpenAI Multimodal (DALL-E / GPT-4o) | - |
| | Embedding | OpenAI text-embedding | BGE / M3E |
| **测试** | 单元测试 | Vitest + jsdom | Jest |
| | E2E | - | Playwright / Cypress |
| **部署** | 容器 | Docker + Docker Compose | Kubernetes |
| | 反向代理 | Nginx | Traefik |
| | 监控 | Prometheus + Grafana | Datadog |
| **文档解析** | Office | DocMindParser (自研) | Apache Tika |
| | PDF | pdfjs + image-extractor | pdf-parse |

---

## 5. 部署架构

### 5.1 本地开发环境

```yaml
docker-compose.local.yml:
  - MySQL 8.0 (3307)
  - Redis 7 (6380)
  - Qdrant (6333/6334)
  - RabbitMQ 3.12 (5672/15672)
  - RAOS Backend (3000)
  - RAOS Frontend (5173 dev / 80 prod)
  - Prometheus (9090)
  - Grafana (3001)
```

### 5.2 生产环境（Docker Compose）

```
                    ┌─────────────┐
                    │   Nginx     │
                    │  (SSL/反向代理)│
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         ↓                 ↓                 ↓
    ┌─────────┐     ┌─────────────┐   ┌──────────┐
    │ Frontend│     │ API Node 1  │   │ API Node 2│  ← 可水平扩展
    │ (Static)│     │   (Express) │   │ (Express) │
    └─────────┘     └──────┬──────┘   └────┬─────┘
                           │               │
              ┌────────────┼───────────────┤
              ↓            ↓               ↓
        ┌─────────┐  ┌─────────┐   ┌─────────────┐
        │  MySQL  │  │  Redis  │   │   RabbitMQ  │
        │ (Primary│  │ (Cluster│   │   (Queue)   │
        │ + Replica│  │  + Sentinel)│  └─────────────┘
        └─────────┘  └─────────┘
              │            │
              ↓            ↓
        ┌─────────┐  ┌─────────┐
        │  Qdrant │  │  Neo4j  │
        │ (Vector)│  │  (Graph) │
        └─────────┘  └─────────┘
```

### 5.3 独立 Worker 进程

```
Worker Process (src/workers/index.ts):
  ├── WAL 恢复与重放
  ├── Bull 队列消费者（Scheduler 任务执行）
  ├── Inbox 调度器迁移
  └── 不启动 HTTP 服务器
```

Worker 进程与 Server 进程共享 `bootstrap()` 初始化的核心依赖，但通过 `initWorkerInfrastructure()` 只注册队列消费者和信号处理。

---

## 6. 扩展点

| 扩展点 | 接口 | 说明 |
|--------|------|------|
| **自定义 Skill** | `defineSkill()` / `defineSystemSkill()` | 通过代码或 `skill_from_description` 动态生成 |
| **自定义 Provider** | `LLMProvider` 接口 | 实现 `chat()` / `embed()` / `stream()` 方法 |
| **自定义 Memory Backend** | `LTMBackend` 接口 | 文件 / MySQL / 自定义存储 |
| **自定义 Transport** | `FederationTransport` 接口 | HTTP / gRPC / WebSocket |
| **自定义 Plugin** | `skill.json` 清单 | 目录扫描 + 热加载 |
| **自定义路由** | `mountRoutes()` 注册 | 在 `src/routes/` 下新增模块 |
| **自定义表单组件** | `ui:widget` 注册 | 在 `web/src/components/form-engine/widgets/` 下新增 |

---

## 7. 相关文档

| 文档 | 说明 |
|------|------|
| `raos.md` | 架构论文（1628 行）— 递归 Skill 抽象的核心理论 |
| `ROADMAP.md` | 工程推进计划 — 从 MVP 到终极形态的路线图 |
| `docs/PROJECT_REVIEW.md` | 项目目标 Review & 偏差分析（本文档的配套） |
| `docs/SYSTEM_SPEC.md` | 系统说明书 — API 契约、数据模型、状态机 |
| `docs/NEO4J_INTEGRATION.md` | Neo4j 图数据库集成方案 |
| `docs/workflow-engine-research.md` | 工作流引擎调研与设计决策 |
| `docs/superpowers/plans/*.md` | 各模块的详细实施计划（TDD 步骤） |
| `DEPLOY.md` | 部署指南 |
| `docs/deployment/README.md` | 部署架构概述 |
