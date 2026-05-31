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
3. Validate: `npm run validate:all` (6 gates: type-check + unit tests + E2E + lint + markdown + config-structure)
4. Build Docker: `docker build -t israeli-bank-importer:test .`
5. Test with real config (if applicable)
6. Commit with conventional message

### API Documentation

Generate browseable HTML API docs locally with:

```bash
npm run docs
# → docs/api/index.html
```

After each release, the docs are automatically published to GitHub Pages:
[https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/](https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/)

---

## Development Rules

All contributors must follow [GUIDELINES.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/GUIDELINES.md). Key rules:

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

---

## Code Review

This project uses [CodeRabbit](https://coderabbit.ai) for automated PR review. The repository is **MIT-licensed and public**, so it qualifies for the free [CodeRabbit OSS plan](https://coderabbit.ai/oss) which lifts the default free-tier rate limit (1 review per repository per hour).

### Maintainer enrollment

Maintainers should ensure the repository is enrolled in the OSS plan via the [CodeRabbit dashboard](https://app.coderabbit.ai/) — this is a one-time action and removes the rate limit that blocks rapid iteration when fixing review findings.

### Contributor expectations

- CodeRabbit posts a single review when a PR opens. Subsequent pushes do **not** auto-trigger new reviews (config: `auto_incremental_review: false`).
- After pushing fixes, comment `@coderabbitai review` on the PR to request a re-review.
- Reviews are skipped for PR titles starting with `chore(main): release`, `WIP`, `docs:`, `ci:`, `chore(deps):`, or `chore(deps-dev):`.
- Address all actionable CodeRabbit findings before requesting human review. See [`CLAUDE.md`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/CLAUDE.md) for the full review workflow.

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
- **Security vulnerabilities:** Do NOT open a public issue. See [SECURITY.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/SECURITY.md)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CODE_OF_CONDUCT.md).

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/LICENSE).
