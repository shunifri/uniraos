# RAOS Editions

RAOS is available in two editions:

## Community Edition

- **Repository**: `https://github.com/your-org/raos-community`
- **License**: MIT
- **Backend**: SQLite (single-node)
- **Infrastructure**: Redis + Qdrant
- **Includes**: Skill system, agent loop, memory, knowledge graph, chat, knowledge base, file handling

This edition is designed for individuals, researchers, and small teams.

## Pro / Enterprise Edition

- **Repository**: private / commercial
- **License**: Commercial
- **Backend**: MySQL (scalable, multi-tenant)
- **Infrastructure**: Redis + Qdrant + RabbitMQ + MinIO + Neo4j
- **Adds**: enterprise RBAC, departments, approval workflows, form engine, federation, skill evolution engine, calibration & benchmarking, commercial support

## Relationship

The Community Edition is derived from the Pro codebase by removing Pro-only modules. Bug fixes and security patches are cherry-picked from Pro to Community. New enterprise features remain Pro-only.

For Pro licensing inquiries, please contact: raos-team@example.com
