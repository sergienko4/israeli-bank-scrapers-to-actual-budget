# CLAUDE.md — Hard Rules for Israeli Bank Importer

These instructions are MANDATORY. They OVERRIDE any default behavior. NEVER violate them.

## ABSOLUTE PROHIBITIONS (zero exceptions)

- **NEVER** use `git commit --no-verify` — if the pre-commit hook fails, STOP and tell the user
- **NEVER** use `git push --force` or `--force-with-lease` — always create new commits
- **NEVER** skip, bypass, or disable pre-commit hooks for any reason
- **NEVER** use `--no-verify`, `--no-gpg-sign`, or any flag that skips safety checks
- **NEVER** commit credentials, tokens, passwords, or secrets
- **NEVER** modify `eslint.config.mjs` unless explicitly asked by the user
- If Docker isn't running and the hook fails at gate 9+: STOP and tell the user. Do NOT bypass.
- If `git push` is rejected: pull and create a new commit. Do NOT force-push.
- There are ZERO exceptions. If you think you need one, ASK the user first.

## MANDATORY SELF-REVIEW BEFORE EVERY COMMIT

Before running `git commit`, for EVERY changed function:

1. **Re-read the entire function** after your edits — not just the changed line
2. **Trace edge cases**: what happens with `undefined`, `null`, `0`, `''`, empty arrays?
3. **Check template literals**: `null` becomes `"null"`, `undefined` becomes `"undefined"` — NEVER interpolate nullable values without a guard
4. **Dead code check**: after adding guard clauses/early returns, simplify code below that now has narrower types
5. **Cross-file consistency**: if the same logic exists elsewhere (e.g., formatter + metrics), diff them to ensure they match
6. **Check surrounding context**: read 5 lines above and below each change — do callers or siblings have assumptions that break?
7. **Implicit returns**: `.forEach()` callbacks must not return values — use block-body arrows or `for...of`

This is NOT optional. If you skip this checklist you WILL introduce bugs that CodeRabbit catches, creating avoidable back-and-forth.

## MANDATORY WORKFLOW (every task, no exceptions)

1. Read `docs/GUIDELINES.md` + `tasks/README.md` + task file BEFORE any work
2. Plan first → explain approach → wait for user approval
3. Fresh branch: `git checkout main && git pull origin refs/heads/main && git checkout -b task-XX-desc`
4. **FULL pre-commit cycle (NEVER skip):** just `git commit` — the 14-gate hook runs everything:
   - Gates 1-8 (incl. 6b): type-check, audit, build, TypeDoc, unit tests, ESLint, Biome, markdownlint, config-structure
   - Gate 9: Docker build + browser smoke test (`israeli-bank-importer:pre-commit`)
   - Gates 10-11: Lychee + Trivy via Docker
   - Gate 12: mocked E2E tests
   - Gate 13: Telegram E2E
5. `docker build -t israeli-bank-importer:test .`
6. Write E2E tests for every new feature — unit tests + E2E tests are BOTH required
7. Update docs: README.md, task files, config.json.example (CHANGELOG is auto-generated)
8. Verify: `grep -rn ": any" src/ --include="*.ts" | grep -v "node_modules\|\[key: string\]: any"` = 0
9. Create PR with conventional commit title, squash merge only
10. NEVER skip Docker local testing or E2E tests — `validate:ci` is NOT sufficient for commits
11. Monitor every PR until all CI checks pass — do not consider the task done until green
11b. ALWAYS read CodeRabbit review comments after PR creation — address findings before task is done
12. NEVER commit credentials, tokens, passwords, or secrets — use `.env.e2e` (gitignored) for local secrets, GitHub Secrets for CI

## CodeRabbit Review Workflow

After creating every PR:
1. Wait ~1-2 minutes for CodeRabbit to post
2. `gh api repos/{owner}/{repo}/pulls/{number}/comments` to read review comments
3. Address any actionable findings (fix code, push new commit)
4. If rate-limited, use `@coderabbitai review` comment to trigger later

## Project Location

- Root: `c:\Users\esergienko\Downloads\actual-budget\israeli-bank-importer`
- Git repo is inside `israeli-bank-importer/` (not the parent `actual-budget/`)
- Remote: `https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git`
- git push on main: use `git push origin refs/heads/main` — a tag named `main` exists and causes ambiguity

## Code Quality Rules

- Max 10 lines per method (intent); ESLint enforces max: 20 (skipBlankLines+skipComments)
- Zero `: any` types — CI ratchet = 0
- No `as never[]` or `as any` — use specific types
- `error: unknown` + `errorMessage()` utility in catch blocks
- OCP maps over if/else chains — `Record<string, ...>` dispatch
- SRP: each function does ONE thing, named by WHAT
- PascalCase enforced on ALL `src/` filenames and folders
- JSDoc required on ALL functions/methods/classes/arrows with `@param`, `@returns`, descriptions
- `no-warning-comments` bans ALL eslint-disable/todo/fixme comments — must fix root cause
- Coverage thresholds: branches 90%, functions 95%, statements/lines 90%
- max-params: 3 — if a function needs >3 params, extract a helper or pass an options object

## Release System (release-please)

- CHANGELOG.md is AUTO-GENERATED — do NOT edit manually
- Commit format: `feat:` (minor), `fix:` (patch), `refactor:` (patch), `chore:` (hidden)
- Repo: squash merge only, admin bypass for release-please PRs
- `include-component-in-tag: false` — tags are `v1.12.3`
- Release config: `config/release-please/config.json` + `config/release-please/manifest.json`

## Common Mistakes

- `tasks/` is in .gitignore — can't `git add tasks/`
- `.gitignore` has `config.json` + `config.*.json` pattern — new `config/*.json` files need explicit exceptions
- MSYS_NO_PATHCONV=1 required for Docker on Windows
- Use `git add -A` ONLY after checking `git status` — it can stage unintended files
- Squash merges mean local branches won't be detected as merged by `git branch -d` — use `git branch -D`
- E2E Docker: use `execFileSync`/`execFile` with arg arrays, NEVER `execSync` with string (CodeQL shell injection)
- Docker browser binary UID: anything installed as root during build must be accessible to `node` user at runtime
- Lychee local vs CI: locally use explicit globs + `--exclude-path CHANGELOG.md`
- PR workflow: create PR, monitor CI, do NOT auto-merge — user must review and approve first

## Tech Stack

- Node.js 22+, TypeScript 5.9.3 (strict), ES2022 modules
- Vitest for testing, v8 coverage provider
- Dependencies: @actual-app/api, @sergienko4/israeli-bank-scrapers (fork), cron-parser, pino, pino-pretty
- devDependency: `@faker-js/faker` v10.3 — typed test factories
- Camoufox (Firefox anti-detect) replaces Chromium+Stealth (scraper v7.9.0+)

## Test Factories

- `tests/helpers/factories.ts` — central typed factory module using `@faker-js/faker`
- `tests/helpers/testCredentials.ts` — shared test credential constants (avoids S2068)
- Rule: use factories for tests that don't care about specific values; keep pinned literals only where tests assert on exact strings
- Use factories with pinned overrides when tests need deterministic values

## CI/CD

- `pr.yml`: build+audit, validate:ci, Docker build, Trivy, CodeQL, SonarCloud, License Compliance, markdownlint+lychee, E2E
- `.husky/pre-commit`: 14-gate hook; gate 12 runs mocked E2E (`test:e2e:mock`); CI `e2e.yml` also includes Dockerized import runs
- `release-please.yml`: on push to main → release PR + test count badge
- `release.yml`: on tag push `v*` → multi-arch build+push → SBOM → enriched notes
- Ruleset: squash only, required checks: Build+Test, Container Scan, CodeQL Security Scan, Docs Quality, E2E Tests, SonarCloud Analysis, License Compliance

## Docker Desktop Camoufox Issue

Real bank scraping hangs on Docker Desktop for Windows with Camoufox (Firefox). Zombie `RDD Process` children. Don't waste time debugging — use mock scraper data for local E2E. Real scraping works on native Linux Docker.
