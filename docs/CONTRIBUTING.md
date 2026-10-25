# Contributing to Israeli Bank Importer

Thank you for your interest in contributing!

---

## Getting Started

### Prerequisites

- Node.js 26, the version in `.nvmrc` that CI and the Docker image run
  (`nvm install && nvm use`). `package.json` accepts 22.14 and later.
- npm 12.2.1, the version the Docker image pins:
  `npm install -g npm@12.2.1`. Earlier npm runs every dependency install
  script, including a source build of `better-sqlite3` that needs a C++
  toolchain — on macOS, the multi-gigabyte Xcode Command Line Tools. npm 12
  runs only the scripts listed in [`allowScripts`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md#dependency-install-scripts-allowscripts),
  and the `better-sqlite3` that `@actual-app/api` loads ships prebuilt
  binaries, so no compiler is needed.
- Docker and Docker Compose
- Git

### Setup

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
nvm use
npm ci
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

- **Aim for 10 lines per method** — extract helpers; ESLint enforces 20 (10 in some folders)
- **Zero `: any` types** — CI enforces this
- **OCP maps over if/else** — use `Record<string, ...>` dispatch
- **SOLID principles** — single responsibility, open/closed
- **Security first** — never commit credentials
- **Absolute links in `docs/`** — link with full GitHub URLs, same-page anchors included, as the `docs/**/*.md` review rule in `.coderabbit.yaml` asks. `tests/docs-links.test.ts` parses every page and fails on a relative link, and on a `blob/main` or `tree/main` link into this repository whose file or heading does not exist

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
| `better-sqlite3` | the 12.x copy under `@hieutran094/camoufox-js` runs `prebuild-install` to download its native binary; the 13.x copy `@actual-app/api` loads ships its binaries in the package and needs no script |
| `tesseract.js` | OCR asset setup |
| `unrs-resolver` | native resolver binary |
| `@sergienko4/israeli-bank-scrapers` | scraper postinstall |

If the `better-sqlite3` binary that `@actual-app/api` loads is missing, it
cannot open the budget and every E2E import fails.

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
from `package-lock.json` — every `<name>@<version>` that declares
`hasInstallScript` and is not `optional` needs its own pin, so the two
`better-sqlite3` copies are checked separately — and compares them against
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
re-approves a version it comments on the pull request naming every package it
re-approved and asks for that release diff to be reviewed before merge. **A
Dependabot pull request being green does not mean anyone has vetted the new
install script.** Read the comment. Dropping an entry the tree no longer needs
withdraws an approval rather than granting one, so that alone is committed
without a comment.

The exception is deliberately narrow in two directions:

- **Only automated bump branches.** It applies only to pull requests authored by
  `dependabot[bot]` that change nothing but the manifest, the lockfile, and the
  rendered READMEs. The on-demand workflow described below rotates pins on its
  own branches for the same reason. On any hand-written branch the pins are
  never rotated automatically and `lint:allow-scripts` still fails the commit.
- **Only packages that are already approved.** `--fix` rotates the *version* of
  a package someone already approved, and removes entries the tree no longer
  needs. It never adds a package that is missing from `allowScripts`. A
  dependency that has newly gained an install script is a new decision rather
  than a rotation of an existing one, so it is reported as
  `needs human approval` and left to fail the gate until someone runs
  `npm approve-scripts` themselves. The same holds for a second version of an
  approved package: a pin rotates only when one approved version left the tree
  and exactly one new version replaced it, so a copy that appears *beside* an
  approved one is never approved by moving that pin onto it.

### Dependabot pull requests merge themselves

`.github/workflows/dependabot-auto-merge.yml` judges every Dependabot pull
request once its PR Pipeline run finishes, and sorts it into one of three
outcomes:

- **Merged without a click.** npm patch and minor updates, alone or grouped,
  GitHub Actions patch and minor updates, and Docker digest refreshes and patch
  updates. The workflow approves with `RELEASE_TOKEN` and arms squash
  auto-merge pinned to the exact head commit it judged. Every required check
  on `main` still gates the merge — auto-merge removes the click, never a gate.
  A CI run that does not pass disarms the pull request; a green re-run arms
  it again.
- **Labelled `needs-manual-review`.** Major updates and Docker minor updates.
  Dependabot keeps majors out of every safe group: development and pino
  majors arrive in `dev-dependencies-major` and `pino-major`, Actions majors
  in `actions-major`, and any other production major in its own pull
  request. Auto-merge is disarmed; review and merge them yourself.
- **Disarmed and left for a human.** A pull request whose install-script pins
  were rotated, as described above, is never merged automatically: the
  rotation comment asks for a review, and merging by hand is how that review
  is recorded. The same applies when the workflow cannot read Dependabot's
  update metadata, cannot classify one of the updates, or finds a commit it
  cannot prove came from Dependabot or the meta-render job — it fails closed
  rather than guessing.

Auto-merge never updates a branch on its own, so the same workflow posts
`@dependabot rebase` on the oldest armed pull request that has fallen behind
`main`, one at a time.

If one package in a major group breaks the build, drop it instead of holding
the rest of the group back. Comment on the pull request and Dependabot
regenerates the group without it:

```text
@dependabot ignore <dependency> major version
```

A security fix for a transitive package that no parent range reaches yet is
the one case that still needs a hand edit: add or raise its entry in the
`overrides` block of `package.json` and open a pull request with only that
change. A local registry is not needed:
`.github/workflows/lockfile-sync.yml` regenerates `package-lock.json` on a
runner, uploads it as the `package-lock` artifact and fails the check. It
resolves against the public registry with the npm version the Docker image
pins, and refuses a branch that adds a
project `.npmrc`. The run summary lists the commands; from a checkout of
your branch they are:

```bash
gh run download <run-id> -R sergienko4/israeli-bank-scrapers-to-actual-budget -n package-lock -D lockfile-sync-artifact
cp lockfile-sync-artifact/package-lock.json package-lock.json
rm -r lockfile-sync-artifact
git add package-lock.json
git commit -m "chore(deps): sync package-lock.json"
git push
```

The push re-runs the check, which then passes.

Fixes that already fit inside existing ranges arrive on their own:
the Thursday `lockfile-refresh.yml` run applies `npm audit fix` and merges
itself once CI is green. If that fix moves a pin across a major, the pull
request is labelled `needs-manual-review` and waits for you instead. A
refresh that `main` moves past is regenerated on the next push to `main`,
which closes the stale pull request. Do not push to a refresh branch: the "Restrict updates" ruleset described in the
[lockfile refresh guard][ci-refresh-guard] blocks it, and the refresh arms
only once it has confirmed that ruleset is in force. If a push gets
through anyway, a guard labels the pull request and tries to withdraw
auto-merge (best effort).

Pull requests opened by `dependency-bump.yml`, described next, are never
merged automatically — they carry your identity, not Dependabot's. The full
policy is in the [CI pipeline reference][ci-automerge] and
[ADR-0002][adr-0002].

[ci-automerge]: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/ci-pipeline.md#dependabot-auto-merge
[ci-refresh-guard]: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/ci-pipeline.md#lockfile-refresh-guard
[adr-0002]: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0002-dependency-auto-merge.md

### Bumping a package on demand

Dependabot scans once a day, which is slower than
`@sergienko4/israeli-bank-scrapers` sometimes needs to move: that package is
what breaks when a bank changes its site, so an upstream fix is often wanted in
a release the same evening. A version published shortly before a scan can also
be missed, because the registry index Dependabot reads has not caught up yet.

`.github/workflows/dependency-bump.yml` covers those cases. It takes the
package and the version, installs it on a runner, then repairs the two things a
bump invalidates — the `allowScripts` pin and the README marker fragments,
which carry dependency versions read out of `package.json`. It re-runs those
gates before opening the pull request, so a bump cannot arrive with generated
files out of sync:

```bash
# newest published version of the scraper
gh workflow run dependency-bump.yml

# a specific version, when you do not want whatever is newest
gh workflow run dependency-bump.yml -f version=8.6.5

# a devDependency; chore keeps it out of the release notes
gh workflow run dependency-bump.yml -f package=vitest -f type=chore
```

`chore` is only for packages that do not ship inside the image, and the workflow
decides that from `package-lock.json` rather than from the manifest section.
`npm prune --omit=dev` keeps whatever the production graph reaches, so
`playwright-core` and `@hieutran094/camoufox-js` ship despite being declared as
devDependencies — the scraper pulls them in. The workflow refuses a `chore` bump
of anything that survives that prune, and it decides before installing anything,
because the [release-signal guard][release-pipeline] on the pull request
compares `package.json`: a bump that lands inside the range already declared
there moves only the lockfile, which that comparison cannot see.

[release-pipeline]: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/release-pipeline.md

Running it on a runner is also what makes the lockfile trustworthy when your
own network cannot reach the npm registry: npm resolves it from registry
metadata with `--package-lock-only`, exactly as Dependabot does, then `npm ci`
fetches every tarball and checks it against the lockfile, so no hash is typed in
by hand. A full `npm install` is avoided on purpose: it re-derives
`hasInstallScript` from the unpacked tarball and flags `better-sqlite3` 13, whose
`binding.gyp` ships beside prebuilt binaries, as needing a native build.

The result is an ordinary pull request with the full CI suite attached. The
workflow only bumps a package that is already in `dependencies` or
`devDependencies`, and it re-saves the new version using the same operator it
found — `^`, `~`, or an exact pin — so it cannot introduce a dependency, and
cannot turn an exact pin or a `~` range into a `^` one. It will still let you
name an older version: keeping `^` while lowering the floor accepts a wider
range than before, which the diff shows. A range it cannot reproduce exactly,
such as a compound range or a `git:` specifier, is refused rather than guessed
at, and a package that appears only in `overrides` has to be edited by hand
(see [the hand-edit case above](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md#dependabot-pull-requests-merge-themselves)
for how its lockfile is regenerated).

If the new version introduces an install script that has never been approved,
`lint:allow-scripts` fails inside the workflow and the run stops without
opening a pull request — that approval is a human decision, so run
`npm approve-scripts` locally and raise the bump as an ordinary pull request
instead.

Only the deterministic repairs belong to the workflow. Audit findings, licence
changes and test failures cannot be fixed by regenerating a file, so they are
left to CI on the pull request, which reports them accurately.

### When a dependency pull request is red

Read the failing check before changing anything. Each kind of red has its own
fix, and none of them is a push to the bot's branch.

| What you see | Cause | Fix |
| --- | --- | --- |
| A Dependabot pull request is behind `main` or conflicting | `main` moved | Comment `@dependabot rebase`. Armed pull requests are rebased automatically, oldest first. |
| A `chore/lockfile-refresh-*` pull request is conflicting | `main` changed `package-lock.json` | Run `gh workflow run lockfile-refresh.yml` unless a newer refresh has already replaced it. The new run starts from `main` and closes the stale pull request. |
| A gate fails on files the pull request did not touch (a lint rule, an ESLint canary, a type-check) | A tool's new major changed what it reports | Fix it forward on `main`, as described below. |
| `npm run audit` reports an unaddressed advisory | A new advisory reached the tree | Fix it in its own pull request: a lockfile refresh, an `overrides` floor, or a justified entry in `config/audit-policy.mjs`. Then comment `@dependabot rebase` on a Dependabot pull request, or run `gh workflow run lockfile-refresh.yml` for a refresh unless a newer one has already replaced it. |
| Tests fail in code that uses the package | A real breaking change | Fix it forward when the code can work on both versions. Otherwise run `dependency-bump.yml` for that version (see [Bumping a package on demand](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md#bumping-a-package-on-demand)) and push the code change to its `deps/…` branch. Dependabot drops the update once `main` carries that version. |
| A test fails with `The provider no longer ships …` | The scraper renamed or reworded an error the importer matches on | Update the matching code and its test to the new wording. Read the scraper's bundle (`lib/index.mjs`) for the new form; never relax the match. |

Never push to a bot branch, and never press **Update branch** on one.
Refresh branches are push-locked. Dependabot stops rebasing a branch
someone else pushed to, and auto-merge fails closed on a commit it cannot
prove came from Dependabot or the meta-render workflow.

To fix forward:

1. Reproduce on the bot's branch: `gh pr checkout <number>`, then
   `npm ci --ignore-scripts`. Its `allowScripts` pins may already approve a
   new install script nobody has reviewed (see
   [Dependabot pull requests rotate their own pins](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md#dependabot-pull-requests-rotate-their-own-pins)),
   so run scripts only after reviewing that release, or in a disposable
   environment with no secrets. Then run the failing script and read the
   package's release notes for the change that explains it.
2. On a branch from `main`, make the change work on both versions. When an
   ESLint canary goes dead, move it to a pattern the new version still
   reports. Never delete the canary or disable the rule to turn the build
   green.
3. Prove both versions: the gate passes on your branch, and again with your
   change copied onto the bot's checkout (locally only, never pushed).
4. Once the fix is merged, comment `@dependabot rebase` on a Dependabot pull
   request. For a refresh, run `gh workflow run lockfile-refresh.yml` unless
   a newer refresh has already replaced it.

A refresh labelled `needs-manual-review` is left for a human. Its run summary
says which case it is:

- **It crossed a major.** Review the moved pins and merge it yourself.
- **Its branch was not proven push-locked** (the run is red). Restore the
  ruleset described in the
  [lockfile refresh guard](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/ci-pipeline.md#lockfile-refresh-guard)
  first, then review and merge it.
- **Its branch moved after it was opened.** Do not merge it: its head is no
  longer the commit the workflow produced. The guard tries to turn
  auto-merge off and fails red when it cannot confirm it; if auto-merge is
  still on, run `gh pr merge <number> --disable-auto`. Then run
  `gh workflow run lockfile-refresh.yml` to replace it.

---

## Bumping the Camoufox browser

The scraper drives Camoufox, a Firefox build that is downloaded separately from
`@hieutran094/camoufox-js`, the npm package that launches it. Every install
site used to download whichever build upstream published last, so an upstream
release could break the image without any change here: v156.0.1-beta.34
dropped config properties that camoufox-js 0.11.2 still sets on every launch,
and every browser launch failed with `UnknownProperty`.

`config/camoufox-pin.json` now decides the build. It names one version and
release, and for each platform the release asset URL and its SHA-256.
`scripts/camoufox-fetch.mjs` is the only installer: the Dockerfile, the
`docker/camoufox-cache` CI action and `npm run camoufox:install` all run it. It
downloads the pinned URL directly, refuses an archive whose digest differs, and
records the installed asset and its digest in `pinned-asset.json` beside
`version.json`. It skips the download only when `version.json` names the pinned
build, that record names this platform's asset and digest, and the executable
camoufox-js launches is a regular file the current user can run. `--verify`
applies the same test without installing, and the image build runs it on both
of its paths.
`tests/deployment/CamoufoxPin.test.ts` fails if any build file goes back to
fetching an unpinned build.

To move to another build:

1. Find the release that carries the new build and read its asset URLs and
   digests, for example
   `gh api repos/daijro/camoufox/releases/tags/<tag> --jq '.assets[] | "\(.name) \(.digest)"'`.
2. Update `version`, `release` and every entry in `assets` together. The schema
   requires the same version and release in every asset file name, a canonical
   `https://github.com/daijro/camoufox/releases/download/` URL and a 64-digit
   lowercase SHA-256, without the API's `sha256:` prefix.
3. Run `npm run camoufox:install`, then `npm run test:e2e:portal`, which drives
   the real browser.
4. Open a pull request. The CI cache key includes the hashes of the pin file and
   the installer scripts, so CI downloads the new build instead of reusing the
   old one, the image build
   verifies it, and the E2E suite launches it. Pull requests build only the
   amd64 image, so the arm64 asset is first installed by the release build;
   its digest check is what guards it.

A camoufox-js upgrade is a separate change that needs the same E2E proof: it
installs into the same directory and launches whatever build is there.

To roll back, set the pin to the previous build. Reverting the pin commit
instead would restore the unpinned download.

---

## Pull Request Process

1. Use a **conventional commit** title (e.g., `feat: Add health check endpoint`)
2. PRs must pass all CI checks:
   - Build (TypeScript strict mode)
   - Tests (80%+ line coverage, 70%+ branch coverage)
   - `npm run audit` (no unaddressed advisories at MODERATE+)
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
