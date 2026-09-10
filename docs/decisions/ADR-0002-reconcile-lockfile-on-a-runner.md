# ADR-0002: Reconcile a branch's lockfile on a hosted runner

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Repository maintainer
- **Relates to:** [ADR-0001](ADR-0001-scheduled-lockfile-refresh.md), whose
  fail-closed integrity rule this decision works within, not around

## Context

ADR-0001 established that a `sha1` integrity or a mirror `resolved` URL fails
the build, and that integrity downgrades **fail closed** because "a weakened
hash cannot be strengthened without re-fetching the tarball from the canonical
registry". That rule is correct and is not revisited here.

Its unstated consequence is that a contributor behind the corporate registry
proxy cannot complete a `package.json` dependency or `overrides` edit at all:

- The proxy is `packagefeedproxy.microsoft.io`, serving tarballs from
  `ms-feed-25.pkgs.visualstudio.com`.
- `npm view <pkg> dist` returns only `shasum` (sha1). The proxy strips the
  canonical `integrity` (sha512) entirely.
- `https://registry.npmjs.org` is unreachable directly — TLS is intercepted.

So every lockfile entry **added** on such a machine arrives with both defects
`lint:lockfile` rejects, and neither is locally repairable by design.

There is an asymmetry worth recording, because it explains why this went
unnoticed: a regeneration that adds **no** entries is byte-identical to the
committed lockfile and ships fine. Only *added* entries are poisoned. An edit
whose resolution does not change is therefore unaffected; an edit that
introduces a new entry is completely blocked.

This is not theoretical. Removing two stale `overrides` caps — `js-yaml`,
which force-downgraded `markdownlint-cli2`'s exact `5.2.2` pin a full major,
and `fast-uri`, whose consumers had moved to `^4.0.0` — added five entries.
All five returned with proxy URLs and `sha1` integrities. Running the
documented local repair (`npm run refresh-lockfile`) rewrote the three
mirror-sourced URLs and left every `sha1` in place, by design: a trustworthy
hash requires a trustworthy tarball. The change is audit-clean and correct,
and could not be committed.

The pre-existing `lockfile-refresh.yml` cannot do this either. It hard-codes
`ref: main`, runs only `npm update` (a transitive refresh, not a re-resolve
against an edited `package.json`), and asserts that nothing but the lockfile
changed — which would reject the very `package.json` edit being reconciled.

## Decision

Add **`.github/workflows/lockfile-reconcile.yml`**: a `workflow_dispatch`-only
workflow taking the target branch as an input. It checks out that branch, runs
`npm install --package-lock-only --ignore-scripts`, verifies the result, and
pushes the reconciled lockfile back to the same branch.

The division of labour is the load-bearing part:

1. **The human edits `package.json` and commits it.** CI never edits it.
2. **CI only ever writes `package-lock.json`.** npm is documented not to
   change `package.json` under `--package-lock-only`, and the workflow asserts
   that with the same `git diff --name-only` guard `lockfile-refresh.yml` uses,
   rather than trusting it.

That split is what lets ADR-0001's guard stay untouched: the workflow runs
`scripts/refresh-lockfile.mjs --check` **before** committing, so the canonical
requirement is enforced at the only place on earth that can satisfy it.

### Supporting decisions

- **A separate workflow, not a second mode of `lockfile-refresh.yml`.** The
  two share only four middle steps. That workflow's tail — the one-open-PR
  dedupe guard, `summarize-refresh.mjs`, the `chore/lockfile-refresh-<run_id>`
  branch and `gh pr create --base main` — is specific to a scheduled job that
  proposes work for review. Reconciling in place proposes nothing. Interleaving
  the two behind `if:` conditions would make both harder to audit, and both are
  security-relevant.

- **`install`, not `update`.** The goal is to make the lockfile agree with the
  committed `package.json`. `npm update` raises transitive pins instead, which
  would smuggle unrelated version movement into the change under review.

- **`RELEASE_TOKEN`, not `GITHUB_TOKEN`** — for the reason ADR-0001 already
  records: a push made with the workflow token raises no `pull_request` event,
  so every gate in `pr.yml` would be skipped and the branch would look green
  without having been tested. `pr.yml` triggers on `pull_request`, whose
  default activity types include `synchronize`, so a PAT-authored push to an
  open pull request's head branch does re-run the full pipeline.

- **Refuses to target the default branch.** `main` is protected, so a direct
  push would be rejected regardless; failing early states why instead of
  surfacing an opaque git error after the work is done.

- **No `${{ }}` interpolation inside `run:`.** Every value reaches the shell
  through `env:`. The dispatch input is attacker-influenceable in principle,
  and this is the standard mitigation for Actions script injection. A test
  asserts it for the whole file, not just the input.

- **Tested structurally, not by regex.** `tests/lockfile-reconcile-workflow.test.ts`
  parses the YAML with the `yaml` package and asserts the safety properties:
  dispatch-only, no persisted credentials, never an install without
  `--package-lock-only --ignore-scripts`, the only-the-lockfile guard, the
  canonical check ordered before the push, staging by name, and the token
  confined to the pushing step. Each assertion was mutation-tested — the
  workflow was deliberately broken to confirm the test fails.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| **Extend `lockfile-refresh.yml` with a dispatch mode** | The first design, abandoned after reading its tail. Only four steps are shared; the dedupe guard, summary, refresh branch and `gh pr create --base main` are all specific to a scheduled proposal job. Two interleaved modes in one security-relevant workflow is worse than two single-purpose files. |
| **Relax `lint:lockfile` to accept `sha1`** | Reverses ADR-0001 for the convenience of one network. SHA-1 is collision-broken, and in this repository a `sha1` integrity has only ever appeared as a symptom of mirror substitution. Rejected outright. |
| **Commit the `sha1` entries and repair later** | Same objection, plus it normalises a weakened hash in `main`'s history. There is no "later" that can strengthen it without re-fetching from the canonical registry. |
| **A Codespace or any clean-network machine** | Works, and is the right answer for a one-off. Rejected as *the* answer because it is manual, unreproducible, leaves no audit trail, and depends on individual access. It does not make the repository self-sufficient. |
| **Upload the lockfile as an artifact for a human to commit** | Needs no write permission, which is genuinely attractive. Rejected as clunky: it inserts a download-and-commit step into every dependency change, and the committing human cannot verify the artifact came from an unmodified run any more easily than they can read the workflow. |
| **Vendor a registry mirror or self-host a runner** | Solves it, at the cost of infrastructure this repository does not otherwise need, plus the ongoing burden of keeping a mirror trustworthy. Disproportionate to the problem. |

## Consequences

**Positive**

- A dependency or `overrides` edit is completable from any machine. The
  constraint moves from "impossible" to "dispatch a workflow".
- ADR-0001's fail-closed guard is preserved exactly; nothing is weakened to
  make this work.
- The workflow installs and executes **no** third-party code —
  `--package-lock-only` downloads no tarball, so no install script runs. That
  is what makes holding a PAT in the same job safe.
- Stale `overrides` become removable, so the floors ADR-0001 warned "grow
  monotonically… every floor is a hand-maintained entry that no process ever
  removes" now have a removal path.

**Negative**

- The branch is red between pushing the `package.json` edit and the reconcile
  landing, because `npm ci` rejects a lockfile that disagrees with
  `package.json`. Transient, and harmless on a feature branch, but surprising
  if unexpected.
- A manual step in a flow that is otherwise automatic. Deliberate: the
  alternative is a workflow that rewrites lockfiles unprompted.
- Another workflow holding `RELEASE_TOKEN`. Mitigated by confining the token to
  the single pushing step, refusing the default branch, and running no
  third-party code in the job.

**Neutral**

- Nothing detects an `overrides` entry that has become stale; it is still found
  by hand. A drift gate comparing each override against its consumers' declared
  ranges is the obvious follow-up, and is deliberately not bundled here.
