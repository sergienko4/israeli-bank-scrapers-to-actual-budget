# Contributing

Welcome — contributions are very welcome.

| Document | Purpose |
|----------|---------|
| [Contributing Guide](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md) | How to fork, branch, and open a PR |
| [Code Guidelines](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/GUIDELINES.md) | Strict coding rules (max 10 lines/method, zero `any`, OCP maps over chains, etc.) |
| [Code of Conduct](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CODE_OF_CONDUCT.md) | Behavioral expectations for all contributors |
| [Roadmap](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/ROADMAP.md) | What's coming next |
| [Security Policy](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/SECURITY.md) | How to report vulnerabilities responsibly |

## At a glance

- **Branch naming:** `feat/<short-desc>`, `fix/<short-desc>`, `docs/<short-desc>`, `chore/<short-desc>`, `refactor/<short-desc>`.
- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`. The squash-merge title becomes the commit message — keep it conventional so [release-please](https://github.com/googleapis/release-please) versions correctly.
- **Git hooks:** verification is split across two stages. `git commit` runs 5 fast gates (type-check on `src/`, cached ESLint, Biome, config-structure, PII scan, ~24s). `git push` runs 9 whole-repo gates (`type-check:test`, `type-check:e2e`, audit, build, TypeDoc, uncached ESLint, markdownlint, circular-dependency, coupling regression, ~40s). Neither hook needs Docker, so a stopped Docker Desktop cannot block you. The heavier unit-test, manifest, Semgrep, link-check, ESLint-canary, Docker image build, Trivy, mocked + Telegram E2E, and CodeQL gates run in CI, not the hooks. See [CI pipeline](../architecture/ci-pipeline.md#git-hooks).
- **PRs:** open a draft PR early. CI runs `pr.yml` automatically. Squash-merge after the required checks are green.

## First time?

1. Read the [Contributing Guide](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md) and [Code Guidelines](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/GUIDELINES.md).
2. Pick an issue tagged [`good first issue`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
3. Comment on the issue to claim it.
4. Run `npm ci && npm run validate` locally to confirm everything works.
5. Open a draft PR — early feedback is faster than late rewrites.

Thank you for contributing! 🎉
