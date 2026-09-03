# ADR-0001: Refresh transitive lockfile pins on a schedule

- **Status:** Accepted
- **Date:** 2026-02-27
- **Deciders:** Repository maintainer
- **Supersedes:** the retired `dependency-check.yml` workflow

## Context

Dependabot raises the versions **declared** in `package.json`. Nothing raised
the transitive versions recorded **inside** `package-lock.json` once their
parents' ranges already allowed a newer release. npm only re-resolves those
entries when something regenerates the lockfile, and no routine job did.

This is not a theoretical gap. It stopped work:

- `browserslist` was pinned at `4.28.2` in the committed lockfile.
- Its parent, `header-generator`, declares `browserslist: ^4.21.1` — a range
  that **already allowed** the patched `4.28.8`.
- The chain is entirely transitive: `browserslist` ← `header-generator` ←
  `fingerprint-generator` ← `@hieutran094/camoufox-js` ←
  `@sergienko4/israeli-bank-scrapers`. No file in this repository names it.
- A CVE against `4.28.2` then failed **both** `npm audit` and Trivy against the
  production tree, and blocked four unrelated Dependabot pull requests at once
  — none of which had anything to do with `browserslist`.

Two escape hatches were considered and neither existed. `classifyAdvisories()`
in `config/check-audit.mjs` deliberately forces production-tree advisories into
violations, so no waiver entry could clear it, and Trivy does not read that
policy file at all. The advisory could only be cleared by moving the pin.

The decisive detail is that **the fix was already inside the allowed range**.
Regeneration alone would have produced `4.28.8`. The lockfile had simply never
been refreshed. Adding `overrides` cleared that one advisory, but an
`overrides` floor is inert on its own — it is applied only when the lockfile is
regenerated. Shipping only the floor would have left the mechanism that caused
the outage completely untouched, and the next stale pin would again be
discovered by a CVE landing on unrelated work.

A second, independent problem surfaced while fixing the first. Running `npm`
behind the corporate proxy rewrote `resolved` URLs to
`*.pkgs.visualstudio.com` and substituted `sha1-` integrities for `sha512-`.
Both are invisible in review — a lockfile diff is thousands of lines — and a
`sha1` integrity is a genuine downgrade, since SHA-1 is collision-broken.

## Decision

Regenerate the lockfile on a schedule, and verify in CI that what lands is
canonical.

1. **`.github/workflows/lockfile-refresh.yml`** runs `npm update
   --package-lock-only --ignore-scripts` every Thursday at 05:00 UTC (plus
   `workflow_dispatch`), and opens a pull request when anything moved.

2. **`npm run lint:lockfile`** (`scripts/refresh-lockfile.mjs --check`) runs
   inside `validate:ci`, failing the build on a foreign registry host or a
   `sha1` integrity. `npm run refresh-lockfile` repairs foreign hosts in place;
   integrity downgrades **fail closed**, because a weakened hash cannot be
   strengthened without re-fetching the tarball from the canonical registry.

3. **The commit type is derived from the lockfile**, not hard-coded.
   `summarizeRefresh()` marks the change `fix(deps)` when any non-`dev` entry
   moved and `chore(deps)` otherwise.

Point 3 is load-bearing and easy to get wrong. `npm update` is documented not
to change `package.json`:

> by default `npm update` will not update the semver values of direct
> dependencies in your project `package.json`
> — <https://docs.npmjs.com/cli/v11/commands/npm-update>

The release-signal guard (`scripts/release-signal-logic.mjs`) compares
`package.json` and the `Dockerfile`. A lockfile-only change is therefore
invisible to it. Hard-coding `chore` would ship a transitive **runtime** change
to users with no release — precisely the failure that guard exists to prevent
— so the type is computed from which entries moved instead.

Scope is deliberately narrow: **transitive refresh within ranges parents
already permit**. `npm update` cannot cross a major version, and raising a
declared range remains Dependabot's job. This is not a Dependabot replacement.

### Supporting decisions

- **Thursday, not Monday.** GitHub evaluates `schedule` in UTC only; unlike
  Dependabot, it has no `timezone` key. Monday is already crowded — Dependabot
  batches at 06:00 Asia/Jerusalem, and `e2e-schedule.yml` and `stale.yml` both
  fire that morning. Mid-week keeps this pull request out of that pile-up and
  leaves working days to react.

- **`RELEASE_TOKEN`, not `GITHUB_TOKEN`.** GitHub does not raise events for
  work pushed with the workflow token:

  > if a workflow run pushes code using the repository's `GITHUB_TOKEN`, a new
  > workflow will not run
  > — <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow>

  Every gate in `pr.yml` would be skipped, and the refresh would look green
  without having been tested at all. The token is confined to the single step
  that pushes and opens the pull request.

- **One open refresh at a time.** Without the duplicate check the workflow
  stacks a near-identical pull request weekly, and the oldest — the one whose
  CI has already run — looks the stalest.

- **`sha1` rejection is policy, not format.** The lockfile format permits
  "a `sha512` or `sha1` … string". Rejecting `sha1` is a deliberate choice: in
  this repository it has only ever appeared as a symptom of mirror
  substitution, and SHA-1 is collision-broken.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| **`overrides` floors alone** | What was shipped first, and insufficient by itself. A floor is only applied when the lockfile is regenerated, so with no scheduled regeneration it is inert — it fixes today's advisory and nothing else. It also grows monotonically: every floor is a hand-maintained entry that no process ever removes. |
| **Dependabot alone** | Cannot close this gap. Dependabot raises *declared* ranges; the failure was a transitive entry already inside its parent's range, which Dependabot has no reason to touch. `header-generator`'s `^4.21.1` was never wrong. |
| **Revive `dependency-check.yml`** | Retired for two recorded reasons. Its inability to cross majors is unchanged — but now explicitly out of scope rather than an unstated limitation. Its crash on the scraper's `patch-package` postinstall cannot recur, because `--package-lock-only` ignores `node_modules` and downloads nothing, so no install script exists to run. Restoring it as-is would restore the confusion about what it was for. |
| **Renovate's lockfile maintenance** | Does exactly this, and well. Rejected because it adds a second dependency bot alongside Dependabot, with its own configuration, permissions and failure modes, to solve one narrow problem that a small workflow already solves using tooling the repository has. Worth revisiting if lockfile maintenance ever stops being the only thing missing. |
| **Pin every transitive dependency exactly** | Converts an occasional stale pin into permanent manual maintenance of hundreds of entries, and guarantees the staleness this ADR exists to prevent. |
| **Repair the lockfile by hand when audit fails** | The status quo that failed. It is reactive by construction — the trigger is a CVE blocking unrelated work — and hand-editing integrity hashes is exactly how a `sha1` downgrade gets committed unnoticed. |

## Consequences

**Positive**

- Stale transitive pins surface on a schedule instead of via a CVE that blocks
  unrelated pull requests.
- The refresh arrives as a reviewable pull request listing every version
  change, split into runtime and development, rather than an opaque diff.
- A runtime bump is correctly typed `fix(deps)`, so release-please cuts a
  release and the change actually reaches users.
- Mirror-rewritten `resolved` URLs and `sha1` downgrades now fail CI rather
  than merging invisibly.
- The workflow installs and executes **no** third-party code:
  `--package-lock-only` "will only use the `package-lock.json`, ignoring
  `node_modules`", so no tarball is downloaded and no install script runs.
  That makes it strictly safer than `dependency-bump.yml`, whose header records
  an unresolved token-exposure concern from running a script with
  `node_modules/.bin` on `PATH`.

**Negative**

- A recurring pull request to review. Mitigated by the duplicate check (never
  more than one open) and by the body naming every changed package.
- Weekly cadence means a window of up to seven days between a fix being
  published and being picked up. `workflow_dispatch` covers the urgent case.
- GitHub disables scheduled workflows after 60 days of repository inactivity.
  Silent by design; the repository is active enough that this is unlikely, but
  a long quiet period would stop the refresh without an error.
- A runtime refresh now produces a release that would previously not have
  happened. That is the intent, not a side effect, but it does raise release
  frequency.

**Neutral**

- `scripts/*.mjs` sits outside the coverage `include` (`src/**`), so the
  90/95/90/90 thresholds do not apply. The logic is covered by 43 tests in
  `tests/refresh-lockfile-logic.test.ts` regardless.
