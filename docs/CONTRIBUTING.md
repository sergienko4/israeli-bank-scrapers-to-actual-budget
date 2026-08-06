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

## Dependency install scripts (`allowScripts`)

`package.json` contains an `allowScripts` block. **Do not delete it** — it is
live configuration read by npm itself, not by any code in this repository. A
plain text search finds no consumer, which makes it look like dead config; the
consumer is the npm CLI.

Since npm v12, dependency install scripts do **not** run by default.
`allowScripts` is npm's allowlist of the four dependencies that legitimately
need one:

| Package | Why it needs an install script |
| --- | --- |
| `better-sqlite3` | `prebuild-install` downloads the prebuilt native binary |
| `tesseract.js` | OCR asset setup |
| `unrs-resolver` | native resolver binary |
| `@sergienko4/israeli-bank-scrapers` | scraper postinstall |

If `better-sqlite3` is not built, `@actual-app/api` cannot open the budget and
every E2E import fails.

### Why each entry is pinned to an exact version

Entries are written as `<name>@<version>`, not bare names. A bare name would
trust the install script of **every future version**, so a dependency bump
could execute an unreviewed install script during `npm ci`. Pinning means a new
version is not pre-approved.

The pins are therefore **expected to change on every bump of these four
packages** — that is the control working, not drift.

### The `lint:allow-scripts` gate

A stale pin does not fail `npm ci`. npm simply skips the blocked script, so the
break surfaces much later and in a shape that points nowhere near the cause —
in [#585] it was a `Could not locate the bindings file` error roughly fourteen
minutes into E2E, two bumps after the pin went stale.

```bash
npm run lint:allow-scripts
```

`scripts/check-allow-scripts.mjs` derives the pins the tree actually requires
from `package-lock.json` — a package needs one exactly when it declares
`hasInstallScript` and is not `optional` — and compares them against
`allowScripts`. It names every stale, missing, or orphaned pin and prints the
remedy for each: the `npm approve-scripts` command for a stale or missing pin,
and the entry to delete for an orphaned one. It runs as a commit-stage gate in
`.husky/pre-commit` and again in the `Build & Audit` CI job, so the failure is
now immediate and actionable rather than delayed and opaque.

[#585]: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/pull/585

### Re-approving a bumped package

```bash
npm approve-scripts <pkg>
```

Pass the **bare package name**. npm resolves the installed version itself, so
this form works on every npm version. A `<pkg>@<version>` argument is only
understood by **npm 11.17.0+**
([npm/cli#9541](https://github.com/npm/cli/pull/9541)); on older npm it fails
with `ENOMATCH`. Either way the command swaps the pin in place, reporting
`removed-stale <pkg>@<old>` and `added <pkg>@<new>`.

Then commit the updated `allowScripts` entry alongside the bump.

### Dependabot pull requests rotate their own pins

Dependabot cannot run either command, so `.github/workflows/dependabot-meta-render.yml`
rotates the pins for it and commits the result onto the Dependabot branch.

This is a deliberate, narrow exception to the rule above, and it does not
delete the review the pin exists to force — it moves it. Whenever the workflow
rotates a pin it comments on the pull request naming every package it
re-approved and asks for that release diff to be reviewed before merge. **A
Dependabot pull request being green does not mean anyone has vetted the new
install script.** Read the comment.

The exception is deliberately narrow in two directions:

- **Only Dependabot branches.** It applies only to pull requests authored by
  `dependabot[bot]` that change nothing but the manifest, the lockfile, and the
  rendered READMEs. On any human-authored branch the pins are never rotated
  automatically and `lint:allow-scripts` still fails the commit.
- **Only packages that are already approved.** `--fix` rotates the *version* of
  a package someone already approved, and removes entries the tree no longer
  needs. It never adds a package that is missing from `allowScripts`. A
  dependency that has newly gained an install script is a new decision rather
  than a rotation of an existing one, so it is reported as
  `needs human approval` and left to fail the gate until someone runs
  `npm approve-scripts` themselves.

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
