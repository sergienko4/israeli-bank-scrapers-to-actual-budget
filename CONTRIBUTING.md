# Contributing to Israeli Bank Importer

Thank you for your interest in contributing!

---

## Getting Started

### Prerequisites

- Node.js 22+ and npm 10+
- Docker and Docker Compose
- Git

### Setup

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
npm install
```

### Development Workflow

1. Create a branch: `git checkout -b feat/your-feature`
2. Make changes
3. Validate: `npm run validate` (build + tests)
4. Build Docker: `docker build -t israeli-bank-importer:test .`
5. Test with real config (if applicable)
6. Commit with conventional message

---

## Development Rules

All contributors must follow [GUIDELINES.md](GUIDELINES.md). Key rules:

- **Max 10 lines per method** — extract helpers
- **Zero `: any` types** — CI enforces this
- **OCP maps over if/else** — use `Record<string, ...>` dispatch
- **SOLID principles** — single responsibility, open/closed
- **Security first** — never commit credentials

---

## Pull Request Process

1. Use a **conventional commit** title (e.g., `feat: Add health check endpoint`)
2. PRs must pass all CI checks:
   - Build (TypeScript strict mode)
   - Tests (80%+ line coverage, 70%+ branch coverage)
   - npm audit (0 vulnerabilities)
   - CodeQL security scan
   - Trivy container image scan (CRITICAL + HIGH)
   - Markdown lint + link check
3. Squash merge only

### Commit Message Format

| Prefix | Version Bump | CHANGELOG Section |
| ------ | ------------ | ----------------- |
| `feat:` | Minor | Added |
| `fix:` | Patch | Fixed |
| `refactor:` | Patch | Refactored |
| `docs:` | Patch | Documentation |
| `ci:` | Patch | CI/CD |
| `chore:` | Patch | Hidden |

---

## Reporting Issues

- **Bugs:** [Open an issue](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/new?template=bug_report.md) with steps to reproduce and sanitized logs
- **Features:** [Request a feature](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/new?template=feature_request.md)
- **Security vulnerabilities:** Do NOT open a public issue. See [SECURITY.md](SECURITY.md)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
