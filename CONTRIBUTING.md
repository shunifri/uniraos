# Contributing to RAOS Community Edition

Thank you for your interest in contributing to RAOS! This document provides guidelines and instructions for contributing.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub with:
- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Docker version, RAOS version)
- Relevant logs or screenshots

### Suggesting Features

Feature suggestions are welcome! Please open a GitHub Discussion or Issue and describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Pull Requests

1. Fork the repository and create your branch from `main`.
2. If you've added code, add tests.
3. Ensure the test suite passes: `npm test`.
4. Make sure your code follows the existing style.
5. Update documentation if needed.
6. Submit your pull request with a clear description.

## Development Setup

```bash
npm install
cd web && npm install && cd ..
docker compose -f docker-compose.local.yml up -d
npm run db:migrate
npm run dev
```

## Code Style

- TypeScript strict mode
- Explicit return types on exports
- Error handling required
- Follow existing patterns in the codebase

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
