---
name: raos-guide
description: RAOS Project Development Guide - Project-specific instructions
metadata:
  auto_load: true
---

# RAOS Development Guide

## Project Overview

RAOS (Recursive Agent Operating System) is a self-evolving agent system with:
- 50+ built-in skills
- Multi-level memory system (STM/LTM)
- Multi-agent collaboration
- Self-evolution capabilities

## Quick Reference

### Running Commands
```bash
npm run dev      # Start dev server
npm test         # Run tests (271+ must pass)
npx tsc --noEmit # Type check
```

### Key Directories
- `src/skills/` - Skill implementations
- `src/memory/` - Memory system
- `src/agents/` - Agent types
- `src/engine/` - Evolution controller
- `tests/` - Test suites

### Adding New Skills
1. Define in `src/skills/`
2. Register in `src/skills/index.ts`
3. Add tests
4. Update documentation

### Code Standards
- Strict TypeScript
- Error handling required
- Tests for all changes
- Follow existing patterns

## Architecture

```
User Request → Skill Router → Skill Execution → Result
                    ↓
            Memory System (STM/LTM)
                    ↓
            LLM Provider
```

## Safety

- Permission checks on all skills
- Sandboxed execution
- Audit trails
- Human approval gates

---
Auto-loaded for RAOS project
