# RAOS - Agent Configuration

## 🎯 Auto-Loaded Skills

This project **automatically loads** the following skills on every session start:

### Global Skills (from ~/.kimi/skills/)
- **superpowers** - Core superpowers for all tasks

### Project Skills (from .claude/skills/)
- **superpowers** - RAOS-specific superpowers and guidelines

## 📋 Skill Usage Rules

### 1. Always Check Skills First
**BEFORE any response or action**, check if a skill applies:
- Even 1% chance → Invoke the skill
- Simple questions → Still check
- Quick file checks → Skills guide how to check

### 2. Required Skill Invocations

| Task Type | Must Invoke |
|-----------|-------------|
| Creative work (features, components) | `brainstorming` |
| Bug fixes | `systematic-debugging` |
| Multi-step tasks | `writing-plans` |
| Plan execution | `executing-plans` |
| Implementation | `test-driven-development` |
| Parallel tasks | `dispatching-parallel-agents` |
| Subagent work | `subagent-driven-development` |
| Before completion | `verification-before-completion` |
| Code review needed | `requesting-code-review` |
| Review feedback | `receiving-code-review` |
| Branch completion | `finishing-a-development-branch` |
| Git worktrees | `using-git-worktrees` |

### 3. Skill Priority
1. **Process skills** (brainstorm, debug, plan)
2. **Implementation skills** (TDD, patterns)
3. **Domain skills** (technology-specific)

## 🏗️ Project Structure

```
raos/
├── src/                    # Main source code
│   ├── skills/            # Skill definitions
│   ├── memory/            # Memory system (STM/LTM)
│   ├── agents/            # Agent implementations
│   ├── engine/            # Evolution controller
│   ├── llm/               # LLM providers
│   ├── routes/            # API routes
│   └── ...
├── tests/                 # Test suites (271+ tests)
├── web/                   # Frontend application
├── docs/                  # Documentation
├── .raos/                 # Local data storage
└── AGENTS.md             # This file
```

## 💻 Development Standards

### TypeScript
- Strict mode enabled
- No implicit `any`
- Explicit return types on exports
- Use `types/` folder for shared types

### Testing
- All changes need tests
- Run `npm test` before completion
- Maintain 100% pass rate (271 tests)

### Code Style
- Follow existing patterns
- Modular and maintainable
- Error handling required
- Documentation for public APIs

## 🔒 Security

- All skills check permissions
- Worker sandbox for generated code
- Audit trails maintained
- Human approval for major changes

## 📚 Key Documentation

- `raos.md` - Architecture overview
- `ROADMAP.md` - Development roadmap
- `V1.0.0-RELEASE.md` - Release notes
- `docs/` - Additional documentation

## ✅ Session Start Checklist

On every new Kimi session for this project:

- [ ] Superpowers skill auto-loaded ✓
- [ ] RAOS-specific guidelines active ✓
- [ ] Ready to check for task-specific skills

## 🚀 Quick Commands

```bash
# Development
npm run dev              # Start development server
npm test                 # Run all tests
npx tsc --noEmit         # Type check

# Database
npm run db:migrate       # Run migrations
npm run db:seed          # Seed data

# Build
npm run build            # Production build
```

---

**Note**: This file is automatically read by Kimi on every session start.
