# RAOS — 递归式智能体操作系统

<p align="center">
  <strong>Recursive Agent Operating System</strong> — 基于统一 Skill 抽象的自适应智能体平台
</p>

<p align="center">
  <a href="#简介">简介</a> •
  <a href="#核心特性">核心特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#架构">架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#贡献指南">贡献指南</a> •
  <a href="#许可证">许可证</a>
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

---

## 简介

RAOS（Recursive Agent Operating System）是一个**生产级递归式智能体操作系统**。它将系统所有能力——业务逻辑、编排、记忆、工具，乃至系统自我进化——统一抽象为 **Skill**。

RAOS 不再硬编码工作流，而是让智能体递归地组合与执行 Skill，从而实现：

- 🧬 **自进化** — 从自然语言描述自动生成、测试、部署新 Skill
- 🔗 **递归组合** — Skill 可以调用其他 Skill，形成任意深度的执行链
- 📊 **自我分析** — 通过执行指标和性能数据持续优化
- 🛡️ **可靠性保障** — DAG 验证、SAGA 补偿、熔断器、错误传播控制

> 📖 本仓库是 RAOS **社区版**。如需 MySQL 后端、企业级权限、工作流、联邦协作、进化引擎等高级能力，请参阅 [专业版](#专业版) 说明。

---

## 核心特性

### 🤖 智能体系统
- **三级智能体**：Simple / ReAct / Team，Orchestrator 根据任务复杂度自动选择策略
- **七种协作协议**：HIERARCHICAL、SEQUENTIAL、SWARM、A2A、CONTRACT_NET、MARKET_BASED、BLACKBOARD
- **ReAct 循环**：推理 → 行动 → 观察，支持 Tool-use 桥接和自动记忆提取

### 🧬 Skill 自进化
- `skill_from_description` — 将自然语言描述转换为可执行代码
- Skill 组合器 — 声明式组合多个 Skill 为复杂工作流
- `skill_test` — 为新生成 Skill 自动生成测试用例
- `skill_optimizer` — 分析执行数据并给出优化建议

### 🧠 记忆系统
- **STM（短期记忆）**：内存 LRU + TTL + 关键词搜索
- **LTM（长期记忆）**：文件持久化 + 语义搜索 + 自动归档 + 冲突检测
- **知识图谱**：原生图存储，支持社区检测、中心节点识别、路径查找

### 🔌 多模态与集成
- **LLM 提供商**：OpenAI、Claude、OpenAI-Compatible
- **多模态**：文本、图像、语音理解与生成
- **数据连接器**：SQLite、MySQL、PostgreSQL、MongoDB 外部数据源
- **文件处理**：DOCX/PPTX/XLSX/PDF 解析与生成

---

## 快速开始

### 环境要求

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

社区版栈仅包含：
- Redis（缓存、会话）
- Qdrant（向量检索）
- RAOS 后端（SQLite 模式）
- RAOS 前端

> 💡 **首次部署无需配置 LLM API Key**，启动后登录系统，在「系统设置 → LLM 配置」中填写即可。

部署完成后访问：
- **前端**: http://localhost
- **API**: http://localhost:3000
- **健康检查**: http://localhost:3000/health

> ⚠️ 首次部署后请立即使用默认账号 `admin / admin` 登录并修改密码。

---

## 架构

RAOS 的核心思想是：**编排本质上也是一组 Skill**。所有能力都注册在 `SkillRegistry` 中，通过 DAG 验证后，由 `ExecutionEngine` 递归执行。

```
┌─────────────────────────────────────────┐
│  用户交互层 (React 18 + Vite)            │
├─────────────────────────────────────────┤
│  API 网关 (Express + 认证)               │
├─────────────────────────────────────────┤
│  核心引擎                                │
│  ├── 执行引擎（递归、DAG）               │
│  ├── Skill 注册表                        │
│  ├── Agent 循环（ReAct）                 │
│  └── 记忆系统                            │
├─────────────────────────────────────────┤
│  Skills（记忆、Web、数据、图谱...）       │
├─────────────────────────────────────────┤
│  基础设施                                │
│  ├── STM / LTM                          │
│  ├── 向量数据库 (Qdrant)                 │
│  ├── 图数据库 (SQLite)                   │
│  └── 数据库 (SQLite)                     │
└─────────────────────────────────────────┘
```

---

## 开发指南

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
# 数据库迁移
npm run db:migrate

# 数据库种子数据
npm run db:seed

# 构建生产包
npm run build:full

# 启动生产服务
npm start

# 类型检查
npx tsc --noEmit

# 运行测试
npm test
```

---

## 专业版

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

### 专业版能力概览

专业版面向需要多租户部署、企业级治理和大规模智能体自动优化的团队：

- **MySQL 可扩展后端** — 多租户数据隔离、连接池、生产级读写扩展能力。
- **企业级 RBAC + 部门管理** — 基于角色的访问控制、组织架构层级、数据范围权限和审计日志。
- **审批工作流** — 可视化流程设计器，支持顺序/会签审批、条件分支、代理转办和 SLA 预警。
- **表单引擎** — 低代码表单设计器，支持动态字段、跨字段校验、数据联动和嵌入组件。
- **联邦协作** — 跨节点 Skill 共享、版本迁移、灰度发布和多实例 A/B 对比。
- **进化引擎** — Skill 自动优化、涌现监控、红线治理和生命周期管理。
- **标定与评测** — LLM 输出评分、候选方案排序、真实数据标定和持续指标追踪。
- **Document Mind 与企业 Skill** — 高级文档解析（DOCX/PPTX/XLSX/PDF）及企业系统连接器。
- **商业支持** — 专属技术支持、定制 SLA 和优先功能开发。

> 专业版源码维护在独立的私有仓库，采用商业授权。

**联系方式**：service@unifri.com

---

## 项目结构

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

## 贡献指南

欢迎贡献！请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

贡献流程：

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交代码并添加测试
4. 运行 `npm test` 确保所有测试通过
5. 提交 Pull Request

参与前请阅读 [行为准则](./CODE_OF_CONDUCT.md)。

---

## 许可证

RAOS 社区版基于 [MIT License](./LICENSE) 开源。

专业版/企业版采用商业授权。

---

<p align="center">
  由 RAOS Team 用 ❤️ 构建
</p>
