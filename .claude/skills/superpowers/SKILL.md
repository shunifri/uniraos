---
name: superpowers
description: RAOS Project-Specific Superpowers - Auto-loaded for this project
license: MIT
compatibility: opencode
metadata:
  audience: all
  workflow: all
  auto_load: true
  project: raos
---

## ⚡ RAOS PROJECT SUPERPOWERS

This skill is **automatically loaded** for all work in the RAOS project.

## 🎯 RAOS-Specific Guidelines

### Architecture Understanding
RAOS is a **Recursive Agent Operating System** with:
- **Skill System**: 50+ built-in skills for various operations
- **Memory System**: STM/LTM with version chains and forgetting
- **Multi-Agent**: 3 levels (Simple/ReAct/Team) with 7 protocols
- **Self-Evolution**: Skills can generate and evolve other skills
- **WAL**: Write-ahead logging for crash recovery

### Code Organization
```
src/
├── skills/          # Skill definitions and handlers
├── memory/          # Memory management (STM/LTM)
├── agents/          # Agent implementations
├── engine/          # Evolution controller
├── llm/             # LLM providers and routing
├── routes/          # API endpoints
└── ...
```

### Development Standards

#### 1. TypeScript Requirements
- Always use strict types
- No `any` without justification
- Export types from `types/` folder
- Use enums for constants

#### 2. Skill Development
```typescript
// Template for new skills
{
  name: 'my_skill',
  description: 'Clear description here',
  handler: async (params) => {
    // Implementation
    return { success: true, data: result };
  },
}
```

#### 3. Testing Requirements
- Unit tests for all skills
- Integration tests for APIs
- Run `npm test` before completion

#### 4. Database Changes
- Add migrations for schema changes
- Support both SQLite and MySQL
- Test with both backends

### Common Operations

#### Running Tests
```bash
npm test                    # Run all tests
npm test -- tests/skills/   # Run specific folder
```

#### Type Checking
```bash
npx tsc --noEmit           # Check TypeScript
```

#### Development Server
```bash
npm run dev                # Start with hot reload
```

### Key Files to Know
- `src/server.ts` - Main server entry
- `src/skills/index.ts` - Skill registry
- `src/memory/` - Memory implementations
- `tests/` - Test suites
- `.raos/` - Local data storage

### Security Considerations
- All skills check permissions
- Worker sandbox for generated code
- Audit trails for all operations
- Human approval for major changes

## 🔍 RAOS-Specific Skill Checks

When working on RAOS, always check these skill areas:

1. **Skill Development** → Check `skill-creator` skill
2. **Memory Features** → Check project-specific patterns
3. **API Changes** → Check routing conventions
4. **Database** → Check migration requirements
5. **Testing** → Must maintain 271+ test coverage

## ⚠️ RAOS Red Flags

| Anti-Pattern | Correct Approach |
|-------------|------------------|
| Breaking existing skills | Maintain backward compatibility |
| Skipping tests | All tests must pass (271+) |
| Direct DB access | Use skills or service layer |
| Ignoring WAL | Always log state changes |
| Hardcoding config | Use config system |

## 📝 RAOS-Specific Checklist

Before completing any RAOS task:

- [ ] TypeScript compiles without errors
- [ ] All tests pass
- [ ] No breaking changes to existing skills
- [ ] Documentation updated if needed
- [ ] Security implications considered

---

**Status**: ✅ ACTIVE for RAOS project
