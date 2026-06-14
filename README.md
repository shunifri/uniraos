# RAOS Pro — Recursive Agent Operating System

<p align="center">
  <strong>Recursive Agent Operating System</strong> — An adaptive agent platform built on a unified Skill abstraction
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#editions">Editions</a> •
  <a href="#license">License</a>
</p>

---

## What is RAOS?

RAOS (Recursive Agent Operating System) is a **production-grade recursive agent operating system**. It unifies all system capabilities — business logic, orchestration, memory, tools, and self-evolution — behind a single abstraction called **Skill**.

- 🧬 **Self-evolution** — Generate, test, and deploy new Skills from natural language descriptions
- 🔗 **Recursive composition** — Skills call other Skills, forming arbitrarily deep execution chains
- 📊 **Self-analysis** — Continuous optimization through execution metrics and performance data
- 🛡️ **Reliability** — DAG validation, SAGA compensation, circuit breakers, and error propagation control

> 📖 This repository is the **Pro / Enterprise Edition** of RAOS. For the open-source Community Edition, see [raos-community](https://github.com/your-org/raos-community).

---

## Features

### 🤖 Agent System
- **Three agent levels**: Simple, ReAct, and Team — Orchestrator auto-selects strategy by task complexity
- **Seven collaboration protocols**: HIERARCHICAL, SEQUENTIAL, SWARM, A2A, CONTRACT_NET, MARKET_BASED, BLACKBOARD
- **ReAct loop**: Reason → Act → Observe, with Tool-use bridging and automatic memory extraction

### 🧬 Skill Self-Evolution
- `skill_from_description` — Turn a natural language description into executable code
- Skill combinator — Declaratively compose multiple Skills into complex workflows
- `skill_test` — Auto-generate test cases for newly created Skills
- `skill_optimizer` — Analyze execution data and recommend optimizations

### 🧠 Memory System
- **STM (Short-Term Memory)**: In-memory LRU + TTL + keyword search
- **LTM (Long-Term Memory)**: File persistence + semantic search + auto-archival + conflict detection
- **Knowledge Graph**: Native graph storage with community detection, hub-node identification, and path finding

### 🏢 Enterprise-Grade Capabilities
- **MySQL backend** for scalable multi-tenant deployments
- **RBAC + departments** for fine-grained access control
- **Approval workflows** with visual designer
- **Form engine** with schema-driven dynamic forms
- **Federation** for cross-instance Skill collaboration
- **Calibration & benchmarking** tooling

### 🔌 Multimodal & Integrations
- **LLM providers**: OpenAI, Claude, OpenAI-Compatible
- **Multimodal**: Text, image, voice understanding and generation
- **Data connectors**: SQLite, MySQL, PostgreSQL, MongoDB external data sources
- **File processing**: DOCX/PPTX/XLSX/PDF parsing and generation

---

## Quick Start

### Requirements

- Docker 24.0+ & Docker Compose v2+
- 4C8G+ server (8C16G recommended for production)
- 20GB+ free disk space

### Run with Docker (recommended)

```bash
# 1. Clone the repo
git clone <repo> && cd raos

# 2. Start the interactive deployment wizard
./deploy/deploy.sh
```

The wizard will:
1. Check Docker / Docker Compose environment
2. Generate `.env` with random passwords (you can confirm or override)
3. Choose deployment mode (local build / pull images / quick mode)
4. Build or pull images
5. Start all services and run health checks

> 💡 You do **not** need an LLM API Key for the first deployment. After login, configure it in "System Settings → LLM Configuration".

After deployment:
- **Frontend**: http://localhost
- **API**: http://localhost:3000
- **Health**: http://localhost:3000/health

> ⚠️ Change the default `admin / admin` password immediately after first login.

### Other deployment options

```bash
# Local build (development / testing)
./deploy/deploy.sh --build

# Non-interactive mode (CI/CD automation)
./deploy/deploy.sh --non-interactive --build

# Quick mode: pull pre-built config and images
./deploy/deploy.sh --quick
```

### Enable monitoring (optional)

```bash
docker compose --profile monitoring up -d
```

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001

---

## Development

```bash
# 1. Install dependencies
npm install
cd web && npm install && cd ..

# 2. Start infrastructure (MySQL, Redis, Qdrant, RabbitMQ)
docker compose -f docker-compose.local.yml up -d

# 3. Run database migrations
npm run db:migrate

# 4. Start dev servers (hot reload for both frontend and backend)
npm run dev
```

Dev endpoints:
- Frontend: http://localhost:9002
- Backend API: http://localhost:3000

### Common commands

```bash
# Database migration
npm run db:migrate

# Seed data
npm run db:seed

# Production build
npm run build:full

# Start production server
npm start

# Start worker
npm run worker:start

# Type check
npx tsc --noEmit

# Run tests
npm test
```

---

## Architecture

RAOS is built around the idea that **orchestration is just another Skill**. All capabilities are registered in a `SkillRegistry`, validated as a DAG, and executed recursively by the `ExecutionEngine`.

```
┌─────────────────────────────────────────┐
│  User Interface (React 18 + Vite)       │
├─────────────────────────────────────────┤
│  API Gateway (Express + Auth/RBAC)      │
├─────────────────────────────────────────┤
│  Core Engine                            │
│  ├── Execution Engine (recursive, DAG)  │
│  ├── Skill Registry                     │
│  ├── Agent Loop (ReAct)                 │
│  └── Workflow Engine                    │
├─────────────────────────────────────────┤
│  Skills (Memory, Web, Data, Graph...)   │
├─────────────────────────────────────────┤
│  Infrastructure                         │
│  ├── STM / LTM                          │
│  ├── Vector Store (Qdrant)              │
│  ├── Graph Store (Neo4j / MySQL)        │
│  └── Database (MySQL / SQLite)          │
└─────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design.

---

## Editions

RAOS is available in two editions:

| Capability | Community Edition | Pro / Enterprise Edition |
|-----------|-------------------|--------------------------|
| Skill system & Agent loop | ✅ | ✅ |
| STM / LTM memory | ✅ | ✅ |
| Knowledge graph (Neo4j / SQLite) | ✅ | ✅ |
| SQLite single-node backend | ✅ | ✅ |
| **MySQL scalable backend** | — | ✅ |
| **Enterprise RBAC + departments** | — | ✅ |
| **Approval workflows** | — | ✅ |
| **Form engine & visual designer** | — | ✅ |
| **Federation (multi-instance)** | — | ✅ |
| **Skill self-evolution engine** | — | ✅ |
| **Calibration & benchmarking** | — | ✅ |
| **Commercial support** | — | ✅ |

- **Community Edition** is open-sourced under MIT and maintained in a separate public repository: [raos-community](https://github.com/your-org/raos-community).
- **Pro Edition** (this repository) adds MySQL-backed scalability, enterprise permissions, visual workflow designer, form engine, and federation. It is commercially licensed.

See [EDITIONS.md](./EDITIONS.md) for details.

---

## Project Structure

```
raos/
├── src/                    # Backend source
│   ├── agents/            # Agent implementations (Simple/ReAct/Team)
│   ├── engine/            # Execution engine (recursive, SAGA, circuit breaker)
│   ├── llm/               # LLM provider wrappers
│   ├── memory/            # Memory system (STM/LTM/KG)
│   ├── skills/            # Skill definitions and implementations
│   ├── permissions/       # Permission system
│   ├── routes/            # API routes
│   ├── db/                # Database layer (MySQL + SQLite adapters)
│   └── server.ts          # Entry point
├── web/                    # Frontend source
│   └── src/
├── tests/                  # Backend tests
├── deploy/                 # Deployment scripts
├── docker/                 # Docker configurations
├── docs/                   # Architecture and design docs
└── package.json
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](./AGENTS.md) | Agent development conventions |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture |
| [docs/DEPLOY-TROUBLESHOOT.md](./docs/DEPLOY-TROUBLESHOOT.md) | Deployment troubleshooting |
| [ROADMAP.md](./ROADMAP.md) | Development roadmap |
| [CHANGELOG.md](./CHANGELOG.md) | Changelog |

---

## License

RAOS Pro / Enterprise Edition is commercially licensed. See [EDITIONS.md](./EDITIONS.md) for details.

The open-source Community Edition is available under the MIT License at [raos-community](https://github.com/your-org/raos-community).

---

<p align="center">
  Built with ❤️ by the RAOS Team
</p>
