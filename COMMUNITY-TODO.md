# Community Edition Migration TODO

This branch (`community-prep`) is a work-in-progress extraction of the Community Edition from the Pro codebase.

## Completed

- [x] Removed federation module (`src/federation/`)
- [x] Removed scheduler module (`src/scheduler/`)
- [x] Removed workflow engine (`src/workflow/`)
- [x] Removed form engine (`src/services/form-*`, `src/routes/form-*`, `src/skills/form-skills.ts`)
- [x] Removed calibration tooling (`src/services/calibration-control.ts`, `src/services/score-candidates.ts`, related routes/tests)
- [x] Removed Document Mind parsing queue (`src/services/docmind-parser.ts`, `src/services/parsing-queue.ts`)
- [x] Removed enterprise/integration/advanced/app-designer skills
- [x] Removed Pro frontend pages and components
- [x] Simplified `docker-compose.yml` to SQLite + Redis + Qdrant
- [x] Backend TypeScript compiles (`npx tsc --noEmit`)
- [x] Frontend TypeScript compiles (`cd web && npx tsc --noEmit`)
- [x] Frontend tests pass (`cd web && npm test`)

## Remaining

- [ ] **MySQL backend removal**: `src/db/mysql-database.ts`, `src/db/mysql-adapter.ts`, `src/db/mysql-conversation-repository.ts` still exist. They should be removed and `src/db/database.ts` made SQLite-only.
- [ ] **Knowledge Graph test migration**: Many KG tests in `tests/memory/knowledge-graph/` still use `getMySQLAdapter()` directly. They need to be rewritten for SQLite or removed.
- [ ] **Enterprise permissions cleanup**: `src/permissions/` contains department/RBAC code that is Pro-only. Simplify to basic auth for Community Edition.
- [ ] **Environment files**: Review `.env.local`, `.env.example`, and `vitest.config.ts` to remove MySQL references and point everything to SQLite/Redis/Qdrant.
- [ ] **Deployment scripts**: Simplify `deploy/deploy.sh`, `deploy/upgrade.sh`, `deploy/backup.sh` for Community Edition infrastructure.
- [ ] **Documentation**: Update `docs/` to reflect Community Edition capabilities.
- [ ] **CI**: Create GitHub Actions workflow for Community Edition tests.
- [ ] **Full test suite**: Get `npm test` passing against SQLite.

## Notes

- The current branch compiles and the core engine/memory/skills work.
- Some Pro-only code paths remain (e.g., evolution routes are still mounted but may throw at runtime if invoked).
- This is intentionally an incremental extraction; the goal is a runnable Community Edition first, then further hardening.
