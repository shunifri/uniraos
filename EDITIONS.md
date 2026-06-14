# RAOS Editions

RAOS is available in two editions, maintained in separate repositories:

- **Community Edition** — open-source, lightweight, suitable for individuals and small teams
- **Pro / Enterprise Edition** — this repository, commercially licensed, with enterprise-grade capabilities

## Repositories

| Edition | Repository | License |
|---------|-----------|---------|
| Community | `https://github.com/your-org/raos-community` | MIT |
| Pro / Enterprise | `https://github.com/your-org/raos` (this repo) | Commercial |

## Community Edition

The Community Edition is a stripped-down version of RAOS that includes the core capabilities:

- Skill system and recursive execution engine
- Agent loop (Simple / ReAct / Team)
- STM / LTM memory system
- Knowledge graph (SQLite-backed)
- SQLite single-node database
- Redis + Qdrant infrastructure
- Basic file handling and multimodal support

It is designed for developers, researchers, and small teams who want to build and experiment with RAOS without enterprise dependencies.

## Pro / Enterprise Edition

The Pro Edition (this repository) includes everything in the Community Edition, plus:

- **MySQL backend** for scalable multi-tenant deployments
- **Neo4j graph store** option for knowledge graph
- **RabbitMQ + Worker processes** for async job processing
- **MinIO** for object storage
- **Enterprise RBAC** with users, roles, and departments
- **Approval workflows** with visual designer
- **Form engine** with schema-driven dynamic forms
- **Federation** for cross-instance Skill collaboration
- **Skill self-evolution** engine
- **Calibration & benchmarking** tooling
- **Commercial support** and custom SLAs

## How the Two Editions Relate

The Community Edition is derived from the Pro codebase by removing Pro-only modules. It is maintained as a separate public repository.

- Bug fixes and security patches are cherry-picked from the Pro repository to the Community repository.
- New enterprise features remain Pro-only and are not merged into the Community Edition.
- The two repositories share the same core architecture and API conventions, making migration from Community to Pro straightforward.

## Licensing

- **Community Edition**: MIT License
- **Pro / Enterprise Edition**: Commercial license — contact us for details

## Contact

For Pro edition inquiries, please email: raos-team@example.com
