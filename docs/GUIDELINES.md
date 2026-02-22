# Development Guidelines

Rules for contributing to this project. All contributors (including AI assistants) must follow these guidelines.

---

## Git Workflow

1. **Fresh branch from main** - Always create a new branch from `main` before starting work
2. **Never commit to main** - All changes must go through Pull Requests
3. **Validate locally** - Run `npm run validate` (build + tests) before committing
4. **PR-only merges** - Keep local development files local, do not commit artifacts to git

---

## Security & Privacy

5. **Security first** - Every task must consider security and privacy implications
6. **Never commit credentials** - No tokens, passwords, or API keys in code or config committed to git
7. **Validate external input** - Sanitize data from banks, APIs, and user config
8. **Minimize dependencies** - Prefer native APIs (e.g., `fetch()`) over third-party packages to reduce attack surface

---

## Quality Standards

9. **Evaluate every change** - Each modification must be checked, measured, and have clear metrics
10. **Explain improvements** - Document how the change improves the project
11. **Justify the change** - Explain why we should do it
12. **Document risks** - Explain why not (tradeoffs, risks, downsides)
13. **Clean code** - Follow clean code principles at all times
14. **SOLID principles** - Follow Open/Closed principle and other SOLID principles
15. **Max 10 lines per method** - Extract longer methods into single-purpose functions
16. **No `any` types** - CI enforces zero `: any` in source (ratchet = 0)
17. **OCP maps over if/else chains** - Use lookup maps for extensible dispatch patterns

---

## Verification Before PR

18. **Build locally** - `npm run build` must pass with zero errors
19. **Run tests** - `npm test` must pass all tests
20. **Run validate** - `npm run validate` (build + tests combined)
21. **Build Docker image** - `docker build -t israeli-bank-importer:test .`
22. **Run E2E tests first** - `npm run test:e2e` with E2E config (mock data, no real bank credentials)
23. **Then run with real config** - Docker run with `config.json` to verify with real bank data (optional, after E2E passes)

---

## Documentation

24. **Always update documentation** - Every code change must include relevant doc updates
25. **Update .md files before work** - Plan and document in task files before implementation begins
26. **CHANGELOG.md is auto-generated** - release-please updates it from conventional commits. Do NOT edit manually.
27. **Remove unused files** - Keep the repository clean, no dead or orphaned files

---

## Development Process

28. **Plan first, then implement** - Create a plan, wait for review and approval before coding

---

## Releases (release-please)

Releases are managed by [release-please](https://github.com/googleapis/release-please).

### Release pipeline

```text
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Code PR    │────▶│  Release PR  │────▶│  Git Tag +   │────▶│ Docker Build │
│  (you)      │     │  (automatic) │     │  GitHub      │     │  + Publish   │
│             │     │              │     │  Release     │     │  (automatic) │
│ feat: ...   │     │ Bumps        │     │  (automatic) │     │              │
│ fix: ...    │     │ package.json │     │              │     │ amd64+arm64  │
│ refactor: . │     │ CHANGELOG.md │     │ v1.9.0 tag   │     │ Docker Hub   │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
   Squash &            Accumulates          Created when         Triggered by
   merge to main       multiple PRs         you merge the        tag push
                       until you're         Release PR
                       ready to ship
```

### Step by step

1. You create a PR with a **conventional commit** title (e.g., `feat: Add health check`)
2. PR passes CI (build, tests, Trivy container scan, markdownlint, lychee, CodeQL) → you **squash & merge**
3. release-please runs automatically and creates/updates a **Release PR**
   - The Release PR bumps `package.json` version and updates `CHANGELOG.md`
   - Multiple code PRs accumulate in the same Release PR
4. When you're ready to ship → **merge the Release PR**
5. release-please creates a **git tag** (e.g., `v1.9.0`) and a **GitHub Release** with notes
6. The tag push triggers the **Docker Build & Publish** workflow
   - Builds multi-platform images (linux/amd64, linux/arm64)
   - Pushes to Docker Hub
   - Generates SBOM (Software Bill of Materials)
   - Enriches the GitHub Release with Docker pull commands and stats

### Commit message format

The PR title (used as squash commit message) determines the version bump:

- `feat: ...` → minor version bump (1.8.x → 1.9.0), appears under "Added"
- `fix: ...` → patch version bump (1.8.2 → 1.8.3), appears under "Fixed"
- `refactor: ...` → patch bump, appears under "Refactored"
- `docs: ...` / `ci: ...` / `test: ...` → patch bump, appears under respective section
- `chore: ...` → patch bump, hidden from CHANGELOG

---

## Task Workflow

When working on tasks from the `tasks/` folder:

1. Read the task `.md` file thoroughly
2. Update task status to `IN PROGRESS` in `tasks/README.md`
3. Create a fresh branch: `git checkout -b task-XX-description`
4. Implement following the steps documented in the task file
5. Run `npm run validate` (build + tests)
6. Build Docker image and run E2E tests first, then optionally with real config
7. Create a Pull Request with a conventional commit title (e.g., `feat: Add health check endpoint`)
8. After merge, update task status to `DONE` in `tasks/README.md`
9. release-please will update CHANGELOG.md and version automatically

---

**Last Updated:** 2026-02-20
