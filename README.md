# RAOS — Recursive Agent Operating System

<p align="center">
  <strong>递归式智能体操作系统</strong> / <strong>Recursive Agent Operating System</strong>
</p>

<p align="center">
  <a href="#核心特性">核心特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#架构">架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#贡献指南">贡献指南</a> •
  <a href="#许可证">许可证</a>
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a>
</p>

---

## What is RAOS?

RAOS（Recursive Agent Operating System）is a **production-grade recursive agent operating system**. It unifies all system capabilities — business logic, orchestration, memory, tools, and self-evolution — behind a single abstraction called **Skill**.

Instead of hard-coding workflows, RAOS lets agents recursively compose and execute Skills, enabling:

- 🧬 **Self-evolution** — Generate, test, and deploy new Skills from natural language descriptions
- 🔗 **Recursive composition** — Skills call other Skills, forming arbitrarily deep execution chains
- 📊 **Self-analysis** — Continuous optimization through execution metrics and performance data
- 🛡️ **Reliability** — DAG validation, SAGA compensation, circuit breakers, and error propagation control

> 📖 This is the **Community Edition** of RAOS. For the MySQL-backed Enterprise/Pro edition with advanced permissions, workflows, federation, and evolution engine, see the [Pro Edition](#pro-edition) section.

---

## 简介

RAOS（递归式智能体操作系统）是一个**生产级递归式智能体操作系统**。它将系统所有能力——业务逻辑、编排、记忆、工具乃至自我进化——统一抽象为 **Skill**。

RAOS 不再硬编码工作流，而是让智能体递归地组合与执行 Skill，从而实现：

- 🧬 **自进化** — 从自然语言描述自动生成、测试、部署新 Skill
- 🔗 **递归组合** — Skill 可以调用其他 Skill，形成任意深度的执行链
- 📊 **自我分析** — 通过执行指标和性能数据持续优化
- 🛡️ **可靠性保障** — DAG 验证、SAGA 补偿、熔断器、错误传播控制

> 📖 本仓库是 RAOS **社区版**。如需 MySQL 后端、企业级权限、工作流、联邦协作、进化引擎等高级能力，请参阅 [专业版](#专业版) 说明。

---

## 核心特性 / Core Features

### 🤖 智能体系统 / Agent System
- **三级智能体**：Simple / ReAct / Team，Orchestrator 自动根据任务复杂度选择策略
- **七种协作协议**：HIERARCHICAL、SEQUENTIAL、SWARM、A2A、CONTRACT_NET、MARKET_BASED、BLACKBOARD
- **ReAct 循环**：推理 → 行动 → 观察，支持 Tool-use 桥接和自动记忆提取

### 🧬 Skill 自进化 / Skill Self-Evolution
- `skill_from_description` — 将自然语言描述转换为可执行代码
- Skill 组合器 — 声明式组合多个 Skill 为复杂工作流
- `skill_test` — 为新生成 Skill 自动生成测试用例
- `skill_optimizer` — 分析执行数据并给出优化建议

### 🧠 记忆系统 / Memory System
- **STM（短期记忆）**：内存 LRU + TTL + 关键词搜索
- **LTM（长期记忆）**：文件持久化 + 语义搜索 + 自动归档 + 冲突检测
- **知识图谱**：原生图存储，支持社区检测、中心节点识别、路径查找

### 🔌 多模态与集成 / Multimodal & Integrations
- **LLM 提供商**：OpenAI、Claude、OpenAI-Compatible
- **多模态**：文本、图像、语音理解与生成
- **数据连接器**：SQLite、MySQL、PostgreSQL、MongoDB 外部数据源
- **文件处理**：DOCX/PPTX/XLSX/PDF 解析与生成

---

## 快速开始 / Quick Start

### 环境要求 / Requirements

- Docker 24.0+ & Docker Compose v2+
- 4C8G 以上服务器（生产建议 8C16G）
- 20GB+ 可用磁盘空间

### Docker 一键部署（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/raos-community.git && cd raos-community

# 2. 启动社区版栈（SQLite + Redis + Qdrant）
docker compose up -d
```

社区版栈包含：
- Redis（缓存、会话）
- Qdrant（向量检索）
- RAOS 后端（SQLite 模式）
- RAOS 前端

部署完成后访问：
- **前端**: http://localhost
- **API**: http://localhost:3000
- **健康检查**: http://localhost:3000/health

> 💡 **首次部署无需配置 LLM API Key**，启动后登录系统，在「系统设置 → LLM 配置」中填写即可。
>
> ⚠️ 首次部署后请立即使用默认账号 `admin / admin` 登录并修改密码。

---

## 架构 / Architecture

RAOS 的核心思想是：**编排本质上也是一组 Skill**。所有能力都注册在 `SkillRegistry` 中，通过 DAG 验证后，由 `ExecutionEngine` 递归执行。

```
┌─────────────────────────────────────────┐
│  用户交互层 / User Interface              │
│  (React 18 + Vite)                      │
├─────────────────────────────────────────┤
│  API 网关 / API Gateway                  │
│  (Express + Auth)                       │
├─────────────────────────────────────────┤
│  核心引擎 / Core Engine                  │
│  ├── 执行引擎 / Execution Engine        │
│  ├── Skill 注册表 / Skill Registry      │
│  ├── Agent 循环 / Agent Loop            │
│  └── 记忆系统 / Memory System           │
├─────────────────────────────────────────┤
│  Skills（记忆、Web、数据、图谱...）       │
├─────────────────────────────────────────┤
│  基础设施 / Infrastructure               │
│  ├── STM / LTM                          │
│  ├── 向量数据库 / Vector (Qdrant)        │
│  ├── 图数据库 / Graph (SQLite)           │
│  └── 数据库 / Database (SQLite)          │
└─────────────────────────────────────────┘
```

---

## 开发指南 / Development

```bash
# 1. 安装依赖
npm install
cd web && npm install && cd ..

# 2. 启动基础设施（Redis + Qdrant）
docker compose -f docker-compose.local.yml up -d

# 3. 运行数据库迁移
npm run db:migrate

# 4. 启动开发服务器（前后端热更新）
npm run dev
```

开发环境访问：
- 前端: http://localhost:9002
- 后端 API: http://localhost:3000

### 常用命令

```bash
npm run db:migrate
npm run db:seed
npm run build:full
npm start
npx tsc --noEmit
npm test
```

---

## 专业版 / Pro Edition

RAOS 提供专业版/企业版，包含以下高级能力：

| 能力 | 社区版 | 专业版 |
|------|--------|--------|
| Skill 系统 & Agent 循环 | ✅ | ✅ |
| STM / LTM 记忆 | ✅ | ✅ |
| 知识图谱（SQLite） | ✅ | ✅ |
| SQLite 单节点后端 | ✅ | ✅ |
| **MySQL 可扩展后端** | — | ✅ |
| **企业级 RBAC + 部门管理** | — | ✅ |
| **审批工作流** | — | ✅ |
| **表单引擎** | — | ✅ |
| **联邦协作** | — | ✅ |
| **进化引擎** | — | ✅ |
| **标定与评测** | — | ✅ |
| **商业支持** | — | ✅ |

### Pro Edition Capabilities

The Pro Edition is built for teams that need multi-tenant deployment, enterprise governance, and automated agent improvement at scale:

- **MySQL Scalable Backend** — Multi-tenant data isolation, connection pooling, and horizontal-read scaling for production workloads.
- **Enterprise RBAC + Department Management** — Role-based access control, organizational hierarchy, data-scope permissions, and audit trails.
- **Approval Workflows** — Visual workflow designer with sequential/parallel approvals, conditional branches, delegation, and SLA alerts.
- **Form Engine** — Low-code form builder with dynamic fields, cross-field validation, data linkage, and embeddable widgets.
- **Federation** — Cross-node Skill sharing, version migration, canary rollout, and A/B comparison across federated RAOS instances.
- **Evolution Engine** — Automated Skill optimization, emergence monitoring, redline governance, and lifecycle management.
- **Calibration & Evaluation** — LLM-output scoring, candidate ranking, real-data calibration, and continuous metric tracking.
- **Document Mind & Enterprise Skills** — Advanced document parsing (DOCX/PPTX/XLSX/PDF) and connectors for enterprise systems.
- **Commercial Support** — Dedicated support, custom SLAs, and prioritized feature development.

> The Pro Edition source code is maintained in a separate private repository and licensed commercially. For inquiries, please contact the RAOS Team.

---

## 项目结构 / Project Structure

```
raos-community/
├── src/                    # 后端源码
│   ├── agents/            # 智能体实现
│   ├── engine/            # 执行引擎
│   ├── llm/               # LLM 提供商封装
│   ├── memory/            # 记忆系统
│   ├── skills/            # Skill 定义与实现
│   ├── routes/            # API 路由
│   ├── db/                # 数据库层（SQLite）
│   └── server.ts          # 入口文件
├── web/                    # 前端源码
├── tests/                  # 测试
├── deploy/                 # 部署脚本
├── docker/                 # Docker 配置
├── docs/                   # 架构文档
└── package.json
```

---

## 贡献指南 / Contributing

欢迎贡献！请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交代码并添加测试
4. 运行 `npm test` 确保所有测试通过
5. 提交 Pull Request

参与前请阅读 [行为准则](./CODE_OF_CONDUCT.md)。

---

## 许可证 / License

RAOS Community Edition is licensed under the [MIT License](./LICENSE).

The Pro / Enterprise Edition is commercially licensed.

---

<p align="center">
  Built with ❤️ by the RAOS Team
</p>
