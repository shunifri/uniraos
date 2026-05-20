# RAOS — Recursive Agent Operating System

<p align="center">
  <strong>递归式智能体操作系统</strong> — 基于统一 Skill 抽象的自适应智能体平台
</p>

<p align="center">
  <a href="#核心特性">核心特性</a> •
  <a href="#一键部署">一键部署</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#文档">文档</a>
</p>

---

## 简介

RAOS（Recursive Agent Operating System）是一个**生产级智能体操作系统**，将系统所有能力统一抽象为"Skill"，通过递归调用和可见性控制替代传统的分层编排架构。

**核心设计思想**：编排本质上是一组特殊的、底层的 Skill。通过统一抽象，系统可以：
- 🧬 **自进化** — 从自然语言描述自动生成、测试、部署新 Skill
- 🔗 **递归组合** — Skill 可以调用其他 Skill，形成任意深度的执行链
- 📊 **自我分析** — 通过执行指标和性能数据持续优化
- 🛡️ **可靠性保障** — DAG 验证、SAGA 补偿、熔断器、错误传播控制

---

## 核心特性

### 🤖 智能体系统
- **三级智能体**：Simple / ReAct / Team，Orchestrator 自动根据任务复杂度选择策略
- **7 种协作协议**：HIERARCHICAL、SEQUENTIAL、SWARM、A2A、CONTRACT_NET、MARKET_BASED、BLACKBOARD
- **ReAct 循环**：推理 → 行动 → 观察，支持 Tool-use 桥接和自动记忆提取

### 🧬 Skill 自进化
- **自然语言生成 Skill**：`skill_from_description` 将描述转为可执行代码
- **Skill 组合器**：声明式组合多个 Skill 为复杂工作流
- **自动测试生成**：`skill_test` 为新生成 Skill 自动生成测试用例
- **性能优化建议**：`skill_optimizer` 分析执行数据并给出优化方案

### 🧠 记忆系统
- **STM（短期记忆）**：内存 LRU + TTL + 关键词搜索
- **LTM（长期记忆）**：文件持久化 + 语义搜索 + 自动归档 + 冲突检测
- **知识图谱**：Neo4j 原生图存储，支持社区检测、中心节点识别、路径查找

### 🏢 企业级能力
- **权限体系**：用户 + 角色 + 部门三维交叉控制（RBAC + ABAC）
- **审批工作流**：可视化流程设计器，支持表单绑定、条件分支、会签
- **表单引擎**：Schema 驱动动态表单，支持数据联动、自定义校验
- **部门管理**：树形结构 + 物化路径继承 + 资源分配
- **联邦协作**：多实例互联，支持跨节点 Skill 调用

### 🔌 多模态与集成
- **LLM 提供商**：OpenAI / Claude / OpenAI-Compatible
- **多模态接口**：文本、图像、语音理解与生成
- **数据连接器**：MySQL、PostgreSQL、SQLite、MongoDB 外部数据源
- **文件处理**：DOCX/PPTX/XLSX/PDF 解析与生成，PPT 自动排版

---

## 一键部署

### 环境要求

- Docker 24.0+ & Docker Compose v2+
- 4C8G 以上服务器（生产建议 8C16G）
- 20GB+ 可用磁盘空间

### 生产环境部署（交互式向导，推荐）

```bash
# 1. 克隆代码
git clone <repo> && cd raos

# 2. 启动交互式部署向导（引导配置环境变量、选择部署方式）
./deploy/deploy.sh
```

向导会自动完成：
1. 检查 Docker / Docker Compose 环境
2. 引导生成 `.env`（自动随机生成密码，可确认/修改）
3. 选择部署方式（本地构建 / 拉取镜像 / 纯镜像）
4. 构建/拉取镜像
5. 启动全部服务并执行健康检查

> 💡 **首次部署无需配置 LLM API Key**，启动后登录系统，在「系统设置 → LLM 配置」中填写即可。

### 其他部署方式

```bash
# 本地构建镜像（开发/测试）
./deploy/deploy.sh --build

# 非交互模式（CI/CD 自动化）
./deploy/deploy.sh --non-interactive --build

# 纯镜像快速部署（无源码，仅下载配置）
./deploy/deploy.sh --quick
```

部署完成后访问：
- **前端**: http://localhost
- **API**: http://localhost:3000
- **健康检查**: http://localhost:3000/health

> ⚠️ 首次部署后请立即使用默认账号 `admin / admin` 登录并修改密码。
>
> 💡 LLM API Key 可在部署后通过系统设置配置，无需预先写入环境文件。

### 启用监控（可选）

```bash
docker compose --profile monitoring up -d
```

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001

---

## 版本升级

### 一键升级（零停机，数据保留）

```bash
# 升级到指定版本
./deploy/upgrade.sh --version v1.2.0

# 本地重新构建后升级
./deploy/upgrade.sh --build
```

`upgrade.sh` 会自动完成：
1. **自动全量备份**（可 `--skip-backup` 跳过，不推荐）
2. **拉取/构建新镜像**
3. **数据库迁移**（在临时容器执行，不影响运行中的服务）
4. **滚动重启**（先停 Worker → 重启后端 → 等待健康 → 重启 Worker + 前端）
5. **健康检查**（超时自动回滚）

### 数据持久化保障

所有数据存储在 Docker **命名卷**中：

| 服务 | 卷名 | 说明 |
|------|------|------|
| MySQL | `mysql_primary_data` | 业务数据 |
| Redis | `redis_data` | 缓存、会话 |
| Qdrant | `qdrant_storage` | 向量数据 |
| MinIO | `minio_data` | 文件对象 |
| Neo4j | `neo4j_data` | 图数据 |

**升级不会删除数据**：
- `docker compose up -d` 保留现有卷 ✅
- `docker compose down` 保留现有卷 ✅
- 只有 `docker compose down -v` 才会清除数据 ❌

### 备份与恢复

```bash
# 一键全量备份
./deploy/backup.sh

# MySQL 恢复
zcat backups/20240115_120000/mysql_full.sql.gz | \
  docker exec -i raos-mysql-primary mysql -u root -p"$MYSQL_ROOT_PASSWORD" raos
```

详细部署文档参见 [DEPLOY.md](./DEPLOY.md)。

---

## 开发指南

### 开发环境启动

```bash
# 1. 安装依赖
npm install
cd web && npm install && cd ..

# 2. 启动基础设施（MySQL、Redis、Qdrant、RabbitMQ）
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

# 启动 Worker
npm run worker:start

# 类型检查
npx tsc --noEmit
```

---

## 测试

```bash
# 后端测试
npm test

# 前端测试
cd web && npm test
```

**当前测试状态**：
- 后端：`141 test files | 1562 tests passed | 0 failed`
- 前端：`27 test files | 171 tests passed | 0 failed`
- TypeScript：`0 errors`

---

## 技术栈

### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 20+ | 运行时 |
| TypeScript | 5.9 | 类型系统 |
| Express | 5.x | Web 框架 |
| MySQL | 8.0 | 主数据库 |
| better-sqlite3 | 12.x | 本地/SQLite 模式 |
| Redis | 7.x | 缓存、会话 |
| Qdrant | 1.9 | 向量数据库 |
| RabbitMQ | 3.12 | 消息队列 |
| MinIO | 2024Q1 | 对象存储 |
| Neo4j | 5.15 | 图数据库 |
| Bull | latest | 任务队列 |

### 前端
| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3 | UI 框架 |
| Vite | 6.x | 构建工具 |
| Ant Design | 5.24 | 组件库 |
| Ant Design X | 2.4 | AI 对话组件 |
| Zustand | 5.0 | 状态管理 |
| React Router | 7.x | 路由 |
| ECharts | 6.x | 数据可视化 |

### 测试
| 技术 | 用途 |
|------|------|
| Vitest | 单元测试框架 |
| jsdom | DOM 模拟 |
| @testing-library/react | React 组件测试 |

---

## 项目结构

```
raos/
├── src/                    # 后端源码
│   ├── agents/            # 智能体实现（Simple/ReAct/Team）
│   ├── engine/            # 执行引擎（递归、SAGA、熔断器）
│   ├── llm/               # LLM 提供商封装
│   ├── memory/            # 记忆系统（STM/LTM）
│   ├── skills/            # Skill 定义与实现
│   ├── permissions/       # 权限体系
│   ├── routes/            # API 路由
│   ├── db/                # 数据库层（MySQL + SQLite 双模式）
│   ├── inbox/             # 消息 inbox
│   ├── workflow/          # 工作流引擎
│   └── server.ts          # 入口文件
├── web/                    # 前端源码
│   ├── src/
│   │   ├── pages/         # 页面组件
│   │   ├── components/    # 公共组件
│   │   ├── store/         # Zustand Store
│   │   └── api/           # API 封装
│   └── package.json
├── tests/                  # 后端测试
├── deploy/                 # 部署脚本
│   ├── deploy.sh          # 一键部署
│   ├── upgrade.sh         # 一键升级
│   └── backup.sh          # 全量备份
├── docker/                 # Docker 配置
├── docs/                   # 架构文档
├── scripts/                # 工具脚本
└── package.json
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [AGENTS.md](./AGENTS.md) | Agent 开发规范与约定 |
| [DEPLOY.md](./DEPLOY.md) | 详细部署与运维指南 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系统架构设计 |
| [ROADMAP.md](./ROADMAP.md) | 开发路线图 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更日志 |
| [V1.0.0-RELEASE.md](./V1.0.0-RELEASE.md) | v1.0.0 发布说明 |

---

## 参与贡献

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交代码：`git commit -am 'Add xxx'`
4. 推送分支：`git push origin feature/xxx`
5. 提交 Pull Request

---

## License

MIT License © 2026 RAOS Team
