# Contributing

Welcome — contributions are very welcome.

| Document | Purpose |
|----------|---------|
| [Contributing Guide](../CONTRIBUTING.md) | How to fork, branch, and open a PR |
| [Code Guidelines](../GUIDELINES.md) | Strict coding rules (max 10 lines/method, zero `any`, OCP maps over chains, etc.) |
| [Code of Conduct](../CODE_OF_CONDUCT.md) | Behavioral expectations for all contributors |
| [Roadmap](../ROADMAP.md) | What's coming next |
| [Security Policy](../SECURITY.md) | How to report vulnerabilities responsibly |

## At a glance

- **Branch naming:** `feat/<short-desc>`, `fix/<short-desc>`, `docs/<short-desc>`, `chore/<short-desc>`, `refactor/<short-desc>`.
- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`. The squash-merge title becomes the commit message — keep it conventional so [release-please](https://github.com/googleapis/release-please) versions correctly.
- **Pre-commit hook:** the project ships an 18-gate Husky hook. `git commit` runs type-check, lint, build, audit, unit tests, Docker build, Trivy, markdown lint, lychee, and mocked E2E. Plan accordingly — first commit is slow.
- **PRs:** open a draft PR early. CI runs `pr.yml` automatically. Squash-merge after the required checks are green.

## First time?

1. Read the [Contributing Guide](../CONTRIBUTING.md) and [Code Guidelines](../GUIDELINES.md).
2. Pick an issue tagged [`good first issue`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
3. Comment on the issue to claim it.
4. Run `npm ci && npm run validate` locally to confirm everything works.
5. Open a draft PR — early feedback is faster than late rewrites.

Thank you for contributing! 🎉
