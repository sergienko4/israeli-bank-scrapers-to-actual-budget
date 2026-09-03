# CI/CD Pipeline Architecture

This document describes the CI/CD architecture for this project. Source of
truth for all CI values lives in [`.github/config/ci-config.yml`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/.github/config/ci-config.yml).

## Overview

The PR DAG lives **inline in `pr.yml`** as the single source of truth. Other
workflows (`release.yml`, `e2e-schedule.yml`, etc.) compose the same logic via
**composite actions** under `.github/actions/*`. Shared values live in
`.github/config/ci-config.yml`. The only reusable workflow is
`_e2e-suite.yml`, which is shared by `pr.yml` (per-PR) and `e2e-schedule.yml`
(weekly cron).

> **Looking for the release → deploy flow** (merge → `release-please` → tag →
> `release.yml` images + `docs.yml` site)? That end-to-end journey has its own
> page: [Release &amp; Deployment Pipeline](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/release-pipeline.md). This page
> covers the **PR gate** that precedes it.

```mermaid
graph TD
  subgraph Workflows["Workflows (triggers + jobs)"]
    PR[pr.yml<br/>PR + push to main]
    REL[release.yml<br/>tag push v*]
    SCH[release-please.yml<br/>push to main]
    DOCS[docs.yml<br/>tag push v*]
    E2ES[e2e-schedule.yml<br/>weekly]
    LFR[lockfile-refresh.yml<br/>weekly cron]
    DMR[dependabot-meta-render.yml<br/>after PR Pipeline]
  end

  subgraph Reusable["Reusable workflows"]
    E2E[_e2e-suite.yml<br/>shared E2E pipeline]
  end

  subgraph Composites[".github/actions/* composites"]
    SETUP[ci/setup<br/>node + npm ci]
    FREE[ci/free-disk-space]
    CAM[docker/camoufox-cache]
    BUILD[docker/build-image<br/>NEW]
    TRIVY[security/trivy-scan]
  end

  PR --> E2E
  PR -.triggers.-> DMR
  E2ES --> E2E
  LFR -.opens PR.-> PR
  PR -.uses.-> SETUP
  PR -.uses.-> BUILD
  PR -.uses.-> TRIVY
  REL -.uses.-> BUILD
  E2E -.uses.-> SETUP
  E2E -.uses.-> BUILD
  SCH -.uses.-> SETUP
  DOCS -.uses.-> SETUP
  BUILD -.includes.-> FREE
  BUILD -.includes.-> CAM
```

> **Why inline, not a `_ci.yml` reusable workflow?** Reusable workflows
> always prefix nested job check-names with the calling job's name
> (e.g. `ci / Build & Audit`). The branch-protection ruleset on `main`
> requires bare names (e.g. `Build & Audit`), so the PR DAG MUST live
> at the top level of `pr.yml`. DRY across workflows is achieved through
> composites and central config instead.

## The PR DAG (`pr.yml`)

```mermaid
graph LR
  build[Build & Audit]
  validate[Test & Lint]
  docs[Documentation Quality]
  security[CodeQL Security Scan]
  semgrep[Semgrep Security Scan]
  trivy[Container Security Scan]
  licenses[License Compliance]
  sonar[SonarCloud Analysis]
  e2e[E2E Tests]
  pass[CI Pass aggregator]

  build --> validate
  build --> e2e
  validate --> sonar
  build --> pass
  validate --> pass
  docs --> pass
  security --> pass
  semgrep --> pass
  trivy --> pass
  licenses --> pass
  sonar --> pass
  e2e --> pass
```

9 parallel jobs at peak (well under GitHub Free's 20-concurrent limit).

## Required check-name preservation

Branch protection requires these 8 exact names. Every `name:` in `pr.yml`
matches this list verbatim:

| Required name              | Emitter                                |
|----------------------------|----------------------------------------|
| `Build & Audit`            | `pr.yml` → `build` job                 |
| `Test & Lint`              | `pr.yml` → `validate` job              |
| `Documentation Quality`    | `pr.yml` → `docs` job                  |
| `CodeQL Security Scan`     | `pr.yml` → `security` job              |
| `Container Security Scan`  | `pr.yml` → `trivy` job                 |
| `License Compliance`       | `pr.yml` → `licenses` job              |
| `SonarCloud Analysis`      | `pr.yml` → `sonar` job                 |
| `E2E Tests / E2E Tests`    | `pr.yml` → `e2e` job → `_e2e-suite.yml`|

Optional new checks (not required — adding a name to the ruleset is a
maintainer action, so new jobs gate merges through `ci-pass` instead):

| Optional name            | Emitter                          |
|--------------------------|----------------------------------|
| `CI Pass`                | `pr.yml` → `ci-pass` aggregator  |
| `Semgrep Security Scan`  | `pr.yml` → `semgrep` job         |

## Release signal guard

`Build & Audit` runs a `Release signal guard` step on pull requests. It fails
the PR when `package.json` `dependencies` or `overrides` change, or when the
Dockerfile `FROM` base image changes, under a title release-please will not
release on — so a bump that ships inside the image can never merge silently.
The Dockerfile is watched because Dependabot's `docker` ecosystem edits only
that file, which a manifest-only comparison cannot see. The step lives inside
an already-required job deliberately — a new top-level job would need a
branch-protection ruleset change to be enforced. Policy:
`scripts/release-signal-logic.mjs`; see
[release-pipeline.md](release-pipeline.md).

## Central config: `.github/config/ci-config.yml`

Holds all CI-only constants in one file:

| Section    | Contents                                            |
|------------|-----------------------------------------------------|
| `project`  | name, owner, repo, repo_url, dockerhub_repo, license|
| `runtime`  | node version, npm version, python version           |
| `docker`   | image name, tag aliases, platforms                  |
| `ci`       | runner OS, timeouts, trivy severity list            |
| `paths`    | config file locations                               |
| `badges`   | shields.io / gist endpoints                         |
| `actions`  | pinned action major versions (single allow-list)    |
| `readme`   | marker allow-list + supported-banks data            |

## Marker fragments

`scripts/render-readme-meta.mjs` reads `.github/config/ci-config.yml` +
`package.json` and rewrites only the content between markers like:

```markdown
<!-- meta:badges:start -->
... rendered content ...
<!-- meta:badges:end -->
```

| Marker name        | Rendered in                                   |
|--------------------|-----------------------------------------------|
| `badges`           | README.md, README.docker-hub.md               |
| `supported-banks`  | README.md, README.docker-hub.md               |
| `tech-stack`       | README.md                                     |
| `docker-image`     | README.md                                     |
| `dockerhub-tags`   | README.docker-hub.md                          |

Run modes:

```bash
npm run meta:render   # write changes
npm run meta:check    # exit 1 on drift (used in CI)
npm run meta:markers  # bash-validate marker pair structure
```

The renderer is **idempotent** (running twice produces identical bytes) and
**refuses** to run on malformed markers or unknown marker names.

### Dependabot auto-render

`tech-stack` embeds versions Dependabot bumps
(`@sergienko4/israeli-bank-scrapers`, `@actual-app/api`, `typescript`,
`vitest`, `engines.node`), and Dependabot cannot run `meta:render` itself, so
every such bump used to fail `Documentation Quality` on drift.

`dependabot-meta-render.yml` closes that gap: after `PR Pipeline` finishes on a
Dependabot pull request, it re-renders the fragments and commits them onto the
Dependabot branch, keeping the gate strict rather than relaxing it. It also
accepts a `workflow_dispatch` with a PR number, for pull requests opened before
the workflow existed.

Two constraints shape the trigger and the token:

- **`workflow_run`, not `pull_request`/`pull_request_target`.** A workflow
  initiated by Dependabot through `pull_request` gets a read-only
  `GITHUB_TOKEN` and no Actions secrets, and `pull_request_target` is
  restricted identically when the PR was *created by* Dependabot. `workflow_run`
  is GitHub's documented two-step handoff: it runs from the default branch,
  outside Dependabot's context, with normal secret access.
- **`RELEASE_TOKEN`, not `GITHUB_TOKEN`, for the push.** A `GITHUB_TOKEN` push
  does not start new workflow runs, which would leave the PR head with no
  status checks at all.

The commit subject carries `[dependabot skip]` so Dependabot keeps rebasing the
branch.

Privilege containment — the job is privileged, so **no head-supplied code
executes**. It checks out the default branch, installs from the default
branch's lockfile with `--ignore-scripts`, overlays only data files
(`package.json`, `README.md`, `README.docker-hub.md`) from the head, and invokes
the renderer through `node` rather than `npm run`. The head tree is restored
only after the last step that executes anything, purely to parent the commit.
The job skips (successfully, without rendering) unless the PR is open, authored
by `dependabot[bot]`, headed in this repository, changes `package.json`, and
changes nothing outside the manifest and the two rendered documents. The push
is never forced, so a concurrent Dependabot rebase rejects it and the next run
renders the newer head.

## Pinning policy

- **GitHub Actions:** pinned to the **major tag** (e.g., `actions/checkout@v7`).
  See the `actions.pinned_versions` array in `ci-config.yml` for the
  authoritative list. Workflows MUST use a tag from that list and MUST NOT
  inline a different version.
- **Dockerfile base image:** pinned to a **SHA digest** (supply-chain
  hardening for the runtime image).
- **SHA pinning of actions** is **deferred**. Tradeoff: at current scale the
  maintenance burden (manually bumping ~25 SHAs every minor) outweighs the
  supply-chain marginal benefit on top of Dependabot's grouped weekly
  updates. Revisit when the repo reaches > 50 actions or after a supply-chain
  incident in this ecosystem.

## Composite: `docker/build-image`

Consolidates the Docker build sequence used by `pr.yml` (trivy), `release.yml`
(smoke + push), and `_e2e-suite.yml`. Wraps:

1. `ci/free-disk-space` composite
2. `docker/camoufox-cache` composite
3. `docker/setup-buildx-action`
4. `docker/build-push-action`

Inputs (5 max — see plan §R6): `tag`, `platforms`, `push`, `load`,
`cache-suffix`, `labels`.

## Secrets matrix

NO `secrets: inherit` anywhere. Every reusable workflow call lists explicit
mappings.

| Secret                  | Used by                                  |
|-------------------------|------------------------------------------|
| `GITHUB_TOKEN` (built-in) | many                                   |
| `RELEASE_TOKEN`         | release.yml, release-please.yml, dependabot-meta-render.yml |
| `SONAR_TOKEN`           | `pr.yml` → sonar job                     |
| `SONAR_ORG`             | `pr.yml` → sonar job                     |
| `SONAR_PROJECT_KEY`     | `pr.yml` → sonar job                     |
| `DOCKERHUB_USERNAME`    | release.yml                              |
| `DOCKERHUB_TOKEN`       | release.yml                              |
| `GIST_SECRET`           | release-please.yml (badge job)           |
| `E2E_TELEGRAM_BOT_TOKEN`| `pr.yml` → e2e → `_e2e-suite.yml`        |
| `E2E_TELEGRAM_CHAT_ID`  | `pr.yml` → e2e → `_e2e-suite.yml`        |

## Dependabot grouping

`.github/dependabot.yml` batches related updates into per-group PRs
(Monday 06:00 Asia/Jerusalem), bounded by each ecosystem’s
`open-pull-requests-limit`:

- **npm** — 2 groups (`dev-dependencies` covering every development
  dependency, and `pino` covering the `pino` + `pino-pretty` production pair);
  all other production dependencies stay individually reviewable. Dependabot
  owns ALL npm deps, including the critical `@actual-app/api` and
  `@sergienko4/israeli-bank-scrapers` packages.
- **docker** — base image bumps only.
- **github-actions** — 4 groups (actions-core, docker-actions, codeql,
  security-actions).

## Lockfile refresh (`lockfile-refresh.yml`)

Dependabot raises versions **declared** in `package.json`. It does not raise
transitive versions recorded **inside** `package-lock.json` once their parents'
ranges already allow a newer release — npm only re-resolves those when
something regenerates the lockfile.

That gap blocked four unrelated Dependabot PRs at once: `browserslist` sat at
`4.28.2` while its parent `header-generator` declared `^4.21.1`, a range that
already allowed the patched `4.28.8`. A CVE against `4.28.2` then failed both
`npm audit` and Trivy on the production tree.

`lockfile-refresh.yml` closes it. Every Thursday 05:00 UTC (and on
`workflow_dispatch`) it runs `npm update --package-lock-only --ignore-scripts`,
and opens a PR when anything moved:

- **Scope is transitive refresh only**, within ranges parents already permit.
  `npm update` cannot cross a major, and raising a declared range stays
  Dependabot's job. This is **not** a Dependabot replacement.
- **No third-party code executes.** `--package-lock-only` ignores
  `node_modules` and downloads nothing, so no install script exists to run.
- **The commit type is computed, not hard-coded** —
  `scripts/summarize-refresh.mjs` emits `fix(deps)` when a non-`dev` entry
  moved, `chore(deps)` otherwise. `npm update` never edits `package.json`, so
  the [release signal guard](#release-signal-guard) cannot see a runtime bump
  made here; a hard-coded `chore` would ship it to users with no release.
- **Pushes with `RELEASE_TOKEN`**, because a PR opened with `GITHUB_TOKEN`
  raises no `pull_request` event — every gate in `pr.yml` would be skipped.
- **At most one open refresh PR**, enforced by a branch-name check before any
  work is done.

A companion gate, `npm run lint:lockfile` (in `validate:ci`), fails the build
on a `resolved` URL pointing anywhere but `registry.npmjs.org` or on a `sha1-`
integrity — both symptoms of a proxy or mirror rewriting the lockfile.
`npm run refresh-lockfile` repairs foreign hosts in place; integrity
downgrades fail closed, since a weakened hash cannot be strengthened without
re-fetching the tarball. Rationale and rejected alternatives:
[ADR-0001](../decisions/ADR-0001-scheduled-lockfile-refresh.md).

## Git hooks

Local verification is split across two stages so the cost lands where it
belongs. Nothing was dropped or weakened when the stages were separated —
every gate below still runs before any commit reaches the remote.

### Commit stage — `.husky/pre-commit`

Answers **"is the snapshot I am recording internally correct?"** — 5 gates:
`type-check` (src), ESLint (cached), Biome, config-structure, PII scan.

### Push stage — `.husky/pre-push`

Answers **"is what leaves this machine correct as a whole?"** — 9 gates:
`type-check:test`, `type-check:e2e`, `npm run audit`, build, TypeDoc, ESLint
(uncached), markdownlint, circular deps, coupling.

A push that only deletes a remote branch ships no code, so the hook detects
the all-zero local SHA and exits without running anything.

ESLint appears in both stages deliberately. The commit stage lints against
`.eslintcache` for speed; a cache is only ever as trustworthy as its
invalidation, so the push stage re-runs it with no cache at all and that
uncached run is what the branch is judged on.

TypeDoc is a push gate rather than a CI-only one because it fails on a class
of error nothing else catches: an interface referenced by an exported
signature but not itself exported. That is a real API-surface defect, and
finding it in CI costs a full round-trip to learn something a local 23s gate
already knew.

### Why this split

The gates run in parallel, so a stage costs its slowest gate plus the
contention between them, not the sum. Measured on this repo (minimum of
three alternating runs, to discount ambient load): the previous single
twelve-gate hook took **35s**, the commit stage now takes **24s** — a 31%
cut on the operation performed most often — and the push stage adds **40s**
once per push rather than once per commit.

The win is 31% rather than 60% because the two tall poles, `type-check` and
ESLint, both stay in the commit stage: each must build the TypeScript
program before it can report anything, and that build is the floor for the
stage. Gates cheaper than that floor were free to keep, so they were kept.

### Acceptance stage — CI only

Every acceptance-stage gate runs in CI and **only** in CI:

| Gate | Owning CI job |
| --- | --- |
| unit tests + coverage thresholds | `validate` (`validate:ci`) |
| ESLint canary fixtures | `validate` (`validate:ci`) |
| lockfile canonicality (`lint:lockfile`) | `validate` (`validate:ci`) |
| config manifest SSoT | `validate` |
| markdown link check (lychee) | `docs` |
| Semgrep | `semgrep` |
| CodeQL | `security` |
| Trivy + Docker image build | `trivy` |
| mocked + Telegram E2E | `e2e` (`_e2e-suite.yml`) |

Those gates left the hooks because they are slow, need Docker or the
network, and already have to pass before merge — running them twice
bought no safety. The unit-test gate was also actively harmful locally:
vitest spawns one fork per CPU, and on a busy workstation a fork that
misses vitest's hardcoded 60-second startup budget is killed. Its tests
then silently never run, and the resulting coverage shortfall fails the
commit for a defect that does not exist. CI runs it on a quiet,
right-sized machine.

Neither hook shells out to Docker, so a stopped Docker Desktop cannot
block a commit or a push.

Nothing is unguarded: `ci-pass` aggregates every job above, so a gate
that is missing locally still blocks the merge.

## Adding a new check

1. Add the job to `pr.yml` with a clear `name:`.
2. If it needs new secrets, reference them via `${{ secrets.X }}` in the
   job's `env:` block; secret presence checks belong in steps (job-level
   `if:` cannot access the `secrets` context).
3. If it needs a new central value, add it to `.github/config/ci-config.yml`
   under the appropriate section.
4. If it's branch-protection-required, add the exact `name:` to the ruleset.
5. Update the table in this document.

## Rollback plan

If `pr.yml` breaks post-merge (e.g., required check name not emitting):

1. Revert the squash-merge commit.
2. Restore the pre-PR state of: `pr.yml`, `release.yml`, `release-please.yml`,
   `docs.yml`, `_e2e-suite.yml`, `package.json`.
3. Delete the new infra: `.github/config/`,
   `.github/actions/docker/build-image/`, `scripts/render-readme-meta.mjs`,
   `scripts/check-readme-markers.sh`, `tests/render-readme-meta.test.ts`,
   `.github/dependabot.yml` (revert to previous form), this file.

No data involved.
