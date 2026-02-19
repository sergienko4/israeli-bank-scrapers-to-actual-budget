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
22. **Run Docker locally** - Run the container with `config.json` and verify it works with real bank data

---

## Documentation

23. **Always update documentation** - Every code change must include relevant doc updates
24. **Update .md files before work** - Plan and document in task files before implementation begins
25. **Update CHANGELOG.md** - Add entry for every change
26. **Remove unused files** - Keep the repository clean, no dead or orphaned files

---

## Development Process

27. **Plan first, then implement** - Create a plan, wait for review and approval before coding

---

## Task Workflow

When working on tasks from the `tasks/` folder:

1. Read the task `.md` file thoroughly
2. Update task status to `IN PROGRESS` in `tasks/README.md`
3. Create a fresh branch: `git checkout -b task-XX-description`
4. Implement following the steps documented in the task file
5. Run `npm run validate` (build + tests)
6. Build and run Docker image locally with real config
7. Update `CHANGELOG.md` with the change
8. Create a Pull Request linking to the task file
9. After merge, update task status to `DONE` in `tasks/README.md`

---

**Last Updated:** 2026-02-19
