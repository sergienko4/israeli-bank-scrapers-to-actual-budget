# ADR-0002: Merge safe dependency updates automatically

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** Repository maintainer
- **Amends:** [ADR-0001](ADR-0001-scheduled-lockfile-refresh.md)

## Context

Dependency updates reached `main` only after a person clicked merge. Every
Dependabot pull request, every weekly lockfile refresh and every advisory fix
waited in a queue until someone found time for it. Two open alerts showed what
that queue cost:

- **Dependabot alert #27** — `katex` prototype pollution, a transitive
  development dependency. Its parent `micromark-extension-math` declares
  `^0.16`, so no update inside the declared ranges could reach the patched
  `0.18.2`, and Dependabot could not open a fix.
- **Code-scanning alert #37** — Trivy flagged `postcss-selector-parser`
  bundled inside the npm CLI that shipped in the runtime image. The
  Dockerfile carried a hand-maintained block that self-upgraded npm and
  patched packages inside it. Each new npm advisory needed another edit to
  that block, and the application never runs npm at runtime.

Clearing alerts like these took a manual "bump" pull request built on a
developer machine. That route is not always available: the npm registry
cannot be reached from every workstation, so a lockfile often cannot be
regenerated locally. When `package.json` was edited by hand, the lockfile
was left out of step and `npm ci` failed in CI.

Grouping hid risk as well. A grouped development-dependency pull request
carried an `eslint-plugin-unicorn` 77 → 78 major next to a set of minor
updates. Anything that judged the group by its name — "dev minor and patch" —
would have merged a breaking change.

The weekly lockfile refresh ([ADR-0001](ADR-0001-scheduled-lockfile-refresh.md))
had a timing problem too. The ruleset requires a branch to be strictly up to
date with `main`. A refresh that waited a few days for review fell behind,
could no longer merge, and was then kept open — blocking the next week's
refresh — by the duplicate check.

## Decision

Merge dependency updates that a fixed policy classifies as safe without a
human click, keep every required check as the gate, and stop shipping the
tools that kept producing image alerts.

1. **`scripts/dependabot-automerge-logic.mjs`** plus
   **`.github/workflows/dependabot-auto-merge.yml`.** A pure, unit-tested
   policy module reads the `updated-dependencies` metadata block that
   Dependabot writes into every commit message and returns one of three
   decisions:

   | Decision | When | Effect |
   |---|---|---|
   | `merge` | Every entry is safe for its ecosystem: npm patch or minor, GitHub Actions patch or minor, Docker patch or digest refresh | Approve the head commit, arm squash auto-merge |
   | `label` | Every entry is classified, and at least one is a major or a type the ecosystem is held back from (a Docker minor) | Add `needs-manual-review`, disable auto-merge |
   | `skip` | Anything the policy cannot classify — unknown ecosystem, missing or malformed metadata, an unclassifiable entry (even beside a major), rotated install-script pins | Disable auto-merge, leave for a human |

   The checks run in that reverse order: `skip` wins over `label`, and
   `label` wins over `merge`. An entry the policy cannot classify means the
   metadata was only partly understood, so the pull request is skipped even
   when another entry is a major.

   The workflow runs on `workflow_run` after PR Pipeline completes, so it
   decides only once CI has finished. It acts only on pull requests opened by
   `dependabot[bot]`. It approves with `RELEASE_TOKEN`, pinned to the head
   commit it decided on, and arms with
   `gh pr merge --auto --squash --match-head-commit`.

2. **A rebase nudger in the same workflow.** Auto-merge never updates a
   branch on its own, and Dependabot rebases by itself only on conflicts. The
   `rebase-behind` job therefore finds armed Dependabot pull requests that
   are behind `main`, oldest first, and posts one `@dependabot rebase` per
   run. It waits two hours before nudging the same head again and, after two
   nudges, warns that the pull request needs a manual rebase and moves on.
   It runs after every successful PR Pipeline, on every push to `main`, on
   manual dispatch and every six hours as a safety net.

3. **`.github/workflows/lockfile-sync.yml`.** When a same-repository pull
   request edits `package.json`, a runner regenerates the lockfile with
   `npm install --package-lock-only --ignore-scripts` against the pinned
   public registry. A branch that adds a project `.npmrc` fails before npm
   runs, so the branch cannot redirect resolution or switch lockfile
   writing off. If the committed lockfile no longer matches, the job
   uploads the regenerated one as the `package-lock` artifact and fails;
   the run summary lists the commands that download and commit it. Hand
   edits no longer require a working local registry, only one extra
   commit. The job does not push: a `pull_request` workflow runs the
   branch's own definition, so a secret there would be readable by the
   code under review, and a push made with `GITHUB_TOKEN` starts no CI. It
   holds `contents: read` and no secret. A pull request that touches only
   `package-lock.json` is left alone, so a deliberate lockfile edit is
   never undone. The job refuses to upload anything when any file other
   than the lockfile changed or appeared, and skips Dependabot,
   release-please and lockfile-refresh branches. Dependabot pull requests
   stay fully automatic.

4. **`.github/workflows/lockfile-refresh.yml`** gains three behaviours:
   - It closes older open refresh pull requests (with their branches), so
     the newest refresh always wins. The close runs last and only once a
     replacement is open or the run proved `main` already carries every
     pin, so a failed run never leaves the week without a refresh.
   - It runs `npm audit fix --package-lock-only --ignore-scripts` after the
     transitive refresh. The step is non-fatal, never uses `--force`, and
     discards every change if the fix tries to edit `package.json`.
   - It arms squash auto-merge on the exact commit it pushed. A refresh
     that moved any pin across a major is labelled `needs-manual-review`
     instead, matching the Dependabot policy. A missing or non-numeric
     majors count stops the run before anything is pushed, as does a
     summary without a title, a body or a `majorBumps` list. Arming pins
     only the commit it saw. A later push to the branch is blocked by a
     "Restrict updates" ruleset on `chore/lockfile-refresh-*`, a manual
     repository setting described in
     [Lockfile refresh guard](../architecture/ci-pipeline.md#lockfile-refresh-guard).
     The run arms only after the API shows that ruleset active with no
     bypass actor; otherwise a refresh that would arm is labelled
     `needs-manual-review` and the run fails red, so a missing setting is
     visible instead of silently trusted.
     As best-effort defence in depth, `lockfile-refresh-guard.yml` withdraws
     auto-merge and applies the same label after any push that gets
     through. It reacts after the push, so a merge can win the race.

5. **`.github/dependabot.yml`** splits majors out of every group. The
   development-dependency group, the pino group and each GitHub Actions group
   are limited to minor and patch updates. Their majors land in a matching
   major group (`dev-dependencies-major`, `pino-major`, `actions-major`),
   which the policy always labels. Other production packages stay ungrouped,
   so each major arrives in its own pull request. npm now scans daily rather
   than weekly. The codeql group now names `github/codeql-action` exactly,
   because Dependabot matches the `owner/repo` name and the old
   `github/codeql-action/*` pattern never matched.

6. **`Dockerfile`** removes npm, npx, corepack and yarn from the runtime
   image after `npm prune --omit=dev`, and drops the block that patched
   packages inside npm. Advisories against the npm CLI's bundled packages
   no longer apply to the image. The build still upgrades to npm 12,
   pinned to an exact version through the `NPM_VERSION` build argument,
   because npm 12 enforces the `allowScripts` allowlist during `npm ci`.
   Dependabot does not track that argument, so bumping it is a manual,
   reviewed change. The npm 11 bundled with the base image runs every
   install script, including a default `node-gyp rebuild` for
   better-sqlite3 v13. That package ships prebuilt binaries and needs no
   build, but the rebuild still runs and fails without Python.

7. **`package.json`** pins `"katex": "^0.18.2"` in `overrides`. A floor in
   `overrides` is the only way to lift a transitive package whose parent
   pins an older range.

### Supporting decisions

- **Fail closed.** Every unexpected or unvetted commit, untrusted branch,
  unsupported ecosystem or policy failure ends in `skip` with auto-merge
  disabled, and so does any PR Pipeline conclusion other than success —
  failure, cancellation or time-out — for the current head. A lookup error
  never approves or arms. Once the run has confirmed it judges the current
  head of an open Dependabot pull request, a later lookup error also
  withdraws any earlier arming. A failure before that point, or a cancelled
  run, touches nothing: the newest head's run or a manual dispatch decides.
  No path ends in a merge by default.
- **Commits are proven, not trusted.** A commit's author login comes from
  its e-mail, and its subject is free text; anyone with push access can set
  both. So the first commit must be Dependabot's, and every Dependabot
  commit must carry a valid signature from GitHub's `web-flow` key and
  Dependabot's exact author e-mail. GitHub signs every commit made through
  its web UI or API with that key, so this proves GitHub made the commit,
  not that Dependabot did; anyone with write access could still mint one.
  Write access stays the trust boundary. `dependabot-meta-render.yml`
  commits are unsigned, so each `github-actions[bot]` commit is vetted by
  content instead: one parent, one of the three subjects that workflow
  writes, and a diff limited to the two rendered READMEs plus, for a prune
  or a rotation only, the `allowScripts` block of `package.json` with every
  other key unchanged. A prune may only drop pins. More than 20 commits, any
  other author, a failed vet or an API error withdraws auto-merge. The
  install-script rotation marker is read only from comments posted by the
  token's own account, because the marker is plain text anyone can paste.
- **Stale is not unsafe.** A run that finds its pull request closed, not
  opened by Dependabot, or already moved past the head CI tested makes no
  write at all. Disarming there could undo an arming made for a newer head;
  the run for that head decides instead.
- **Classify per entry, never per group.** The decision reads every entry in
  the metadata block. A group name says nothing about what the group
  contains, which is how the `eslint-plugin-unicorn` major was nearly missed.
- **Docker minors stay manual.** A base-image minor can change the Node.js
  runtime or system libraries under the application. Only patch updates and
  digest refreshes merge on their own.
- **Docker tags are classified from the bump line.** Dependabot writes no
  `update-type` for Docker, so the policy compares the old and new tag in
  the `Bumps <image> from <old> to <new>` line. A higher major is labelled,
  a higher minor is labelled, a higher patch merges, and two digests merge
  as a refresh. A changed variant suffix (`-slim` to `-alpine`), a changed
  precision (`26` to `26.1`), a downgrade, an unchanged tag or a named tag
  such as `latest` is skipped.
- **Install-script pin rotations need a human.** When
  `dependabot-meta-render.yml` pushes a commit that changes the pinned
  install scripts, the push dismisses the earlier approval and the policy
  skips the new head. Approving install-script execution stays a human read.
- **Overrides are the runbook for out-of-range advisories.** When a parent
  declares a range that excludes the patched release, add a floor to
  `overrides`. The next lockfile regeneration applies it.
- **`dependency-bump.yml` stays the human fallback.** Pull requests opened by
  the manual bump workflow are never auto-merged.
- **Security updates stay individual.** Dependabot groups apply to version
  updates only, so security pull requests keep one dependency each and the
  policy classifies them like any other update.
- **`workflow_run`, not `pull_request_target`.** The workflow checks out only
  the default branch and never runs pull-request code. Pull-request data
  reaches the shell through `env:` only.
- **The `main` ruleset needs no bypass.** The ruleset requires a code-owner
  review and zero other approvals, and `CODEOWNERS` names the owner of
  `RELEASE_TOKEN`. Every past Dependabot merge carried that owner's
  approval, which the workflow now supplies with `RELEASE_TOKEN`. Refresh
  pull requests are opened by the same owner and have merged without any
  approval: refresh PR #783 merged with no approving review, and the
  ruleset's `pull_request` rule evaluated as pass, not as bypassed.
- **Agent pull requests are unaffected.** The rule in `CLAUDE.md` that an
  agent must not merge its own pull request still applies. This decision
  covers Dependabot and lockfile-refresh pull requests only.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Replace Dependabot with Renovate | Renovate has richer auto-merge rules, but it adds a third-party app with write access and a second configuration language. The gap was the merge policy, which a small, tested module closes. |
| Auto-merge majors after CI | CI does not prove a major is safe. A major can change behaviour that the tests do not cover, and the release notes need a human read. |
| One pull request per major update | A busy week would open many pull requests at once and hit Dependabot's open-pull-request limit. Grouping development, pino and Actions majors keeps the review queue short. Other production majors stay one per package so each one can be reviewed and reverted on its own. |
| Rely on `dependabot/fetch-metadata` alone | It reports the highest update type for a group, not every entry. A per-entry check was needed anyway, and an extra action adds a supply-chain pin. |
| Merge with `GITHUB_TOKEN` | A `GITHUB_TOKEN` approval does not satisfy the code-owner rule, and its merges raise no `push` event, so release-please would never see the change. |
| Use GitHub's "update branch" for stale pull requests | It adds a merge commit to the Dependabot branch, and Dependabot then stops maintaining that pull request. `@dependabot rebase` is the supported route. |
| Keep npm in the image and keep patching it | Each npm release can bundle a new vulnerable package, so the patch list never stays done. The application does not use npm at runtime. |
| `pull_request_target` trigger | It runs with secrets in the context of an untrusted pull request, and merging has to wait for CI anyway. |
| Have `lockfile-sync.yml` push the regenerated lockfile back with `RELEASE_TOKEN` | A `pull_request` workflow runs the branch's own definition, so the secret would be readable by the code under review. A `GITHUB_TOKEN` push starts no CI, so the pull request would sit without checks. One download and commit by the maintainer is the smaller cost. |

## Consequences

**Positive**

- Safe updates and advisory fixes reach `main` without waiting for a person.
  Every required check still gates the merge — auto-merge removes the click,
  never a gate.
- Majors and unknown updates cannot slip through inside a group.
- A hand edit to `package.json` needs no local registry; one download and
  commit of the runner's lockfile completes it.
- The runtime image no longer carries npm, so npm's bundled packages stop
  raising image alerts.
- Only the newest refresh stays open, so one stuck refresh cannot block the
  next.

**Negative**

- `RELEASE_TOKEN` now approves and merges as well as releasing. Its scope
  and expiry matter more, and a leaked token could approve a pull request.
- More workflow runs: the auto-merge workflow runs after every PR Pipeline,
  on every push to `main` and every six hours.
- A pull request that needs more than two rebase nudges stops moving until
  someone rebases it by hand.
- An advisory outside the declared ranges still needs a hand-written
  `overrides` floor, and that pull request needs one extra commit: the
  lockfile the runner regenerates.

**Neutral**

- Merges now arrive at any time of day rather than in review sessions.
  release-please batches them into the next release as before.
- Majors still need a human, as they did before. They now arrive labelled,
  and most arrive grouped.

## Post-merge verification

These behaviours depend on GitHub settings and services that cannot be
exercised before merge. Check each one on the first real pull requests and
record the result here.

1. A `RELEASE_TOKEN` approval satisfies the code-owner rule on a Dependabot
   pull request, and the first automated refresh pull request merges
   through auto-merge with no approval.
2. Auto-merge stays armed after Dependabot force-pushes a rebase.
3. A Dependabot rebase updates the head commit's committer date, which the
   nudger uses to count its own earlier nudges.
4. `gh pr merge --auto` can fail on a pull request seconds old. The refresh
   workflow retries three times to cover it.
5. The exit code of `npm audit fix --package-lock-only` when advisories
   remain unresolved.
6. A group's `update-types` and `dependency-type` filters combine with AND.
7. Majors of actions named in a specific group fall through to
   `actions-major`, and pino majors land in `pino-major`.
8. The next CodeQL action bump arrives in the `codeql` group rather than
   as a lone pull request.
9. Dependabot's commits report, through the commits API, a valid signature
   (`reason` `valid`), the `web-flow` committer and Dependabot's author
   e-mail, so the auto-merge workflow trusts them. If any of these changes,
   every Dependabot pull request is skipped and the check needs revisiting.
10. A refresh that crosses a major opens labelled `needs-manual-review` and
    is not armed.
11. A push to an open refresh branch fires `lockfile-refresh-guard.yml`,
    which tries to withdraw auto-merge and labels the PR
    `needs-manual-review`. If it cannot confirm auto-merge is off, the run
    fails red. The refresh run's own push, made before the pull request
    opens, does not fire it. With the "Restrict updates" ruleset in place,
    no push can move the branch at all; the ruleset has no bypass.
12. The refresh run's lock check reads that ruleset through
    `RELEASE_TOKEN`: the bypass list is returned and empty, and the first
    refresh arms. If the token cannot see the bypass list, every refresh
    that would arm opens labelled `needs-manual-review` with a red run
    until the token gains write access to the ruleset.
