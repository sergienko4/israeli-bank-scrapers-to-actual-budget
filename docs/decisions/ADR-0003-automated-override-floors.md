# ADR-0003: Raise and prune `overrides` floors automatically

- **Status:** Accepted
- **Date:** 2026-10-29
- **Deciders:** Repository maintainer
- **Amends:** [ADR-0001](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0001-scheduled-lockfile-refresh.md),
  [ADR-0002](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0002-dependency-auto-merge.md)

## Context

`GHSA-gg6h-894w-4m9c`, a high-severity advisory against `re2js`
`>=2.2.0 <2.8.7`, was published at 2026-10-28 21:10 UTC. The lockfile
held `re2js@2.8.6`, a development dependency that `markdownlint@0.42.0`
declares **exactly** (`"re2js": "2.8.6"`). That `markdownlint` was, and still
is, its latest release.

`npm run audit` failed on `main` and on every pull request built on it.
Dependabot pull request #825, a development-dependency group bump with nothing
to do with `re2js`, went red in `Build & Audit`. That job gates every other
job, so `CI Pass` failed and auto-merge stayed disarmed.

Nothing the repository ran could clear it:

- **Dependabot** raises declared ranges. `re2js` is declared by no one but
  `markdownlint`, and no `markdownlint` release had moved off the exact pin.
- **The lockfile refresh** ([ADR-0001](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0001-scheduled-lockfile-refresh.md))
  runs `npm update` and a non-forced `npm audit fix`. Both stay inside the
  range a parent declares, and an exact pin leaves no room. It also ran only
  on Thursdays.
- **The rebase nudger** ([ADR-0002](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0002-dependency-auto-merge.md))
  nudged armed pull requests only. A Dependabot pull request that went red
  because `main` was red stayed red and disarmed after `main` was fixed,
  until someone commented `@dependabot rebase` by hand.
- **Nothing notified.** The only signal was red pull requests.

ADR-0002 recorded the gap as a known cost: "An advisory outside the declared
ranges still needs a hand-written `overrides` floor." The fix here was one
line, `"re2js": "^2.8.7"`. It used the same major line, and 2.8.7 had been
published eleven days before the advisory. A fix that mechanical can be
computed, proved and merged by the pipeline, as long as the rules for when it
may do so are explicit and fail closed.

## Decision

Teach the lockfile refresh to raise an `overrides` floor for an advisory that an
exact pin keeps out of reach, and to drop floors that no longer change
anything. Audit `main` every four hours so the refresh starts within hours of
an advisory. Let Dependabot pull requests that an advisory on `main` blocked
recover on their own once `main` is clean.

1. **Audit exit codes.** `config/check-audit.mjs` exits **0** when the tree
   is clean, **1** on a policy violation, and **2** when npm could not
   produce a report: unparseable output, an npm `error` object, or a failed
   spawn. Report parsing lives in `config/audit-report.mjs`. Only 0 and 1 are
   verdicts. Exit 2 never starts a refresh, adds a label or nudges a pull
   request, so an advisory feed that is down remediates nothing.

2. **An override floor planner.** `scripts/override-floor-logic.mjs` is pure:
   it reads no file, clock or network. `scripts/plan-override-floors.mjs`
   gathers its inputs: the audit, `package.json`, the lockfile, and
   `npm view <pkg> time` for each vulnerable package. It returns one floor or
   one rejection per vulnerable package, applying these rules in order:

   | Rule | Check | Rejection | Why |
   | --- | --- | --- | --- |
   | R1 | The package is not declared in `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies`. | `direct-dependency` | A declared range is Dependabot's to raise. An override on a direct dependency fights it. |
   | R2 | The package is in the lockfile, and every locked copy sits on one caret line (`^1.2.0` admits it). | `not-in-lockfile`, `multiple-lines` | One floor across two lines would force one copy over a breaking boundary. |
   | R3 | Every advisory range for the package parses in a narrow comparator grammar (`*`, `>=`, `>`, `<=`, `<`, `=`, `\|\|`); `^`, `~`, `x` and hyphen ranges do not. | `unparseable-range` | A range the planner cannot read cannot prove a version safe. |
   | R4 | npm reported publish times. A failed or timed-out `npm view` counts as none. | `missing-publish-times` | The age rule below needs them. |
   | R5 | Some published stable version at or above the highest locked copy matches no advisory range. | `no-fixed-release` | There is nothing to move to. |
   | R6 | Any existing override is a plain `^x.y.z` or `>=x.y.z` whose minimum is below the floor. It keeps its operator and is only raised. | `unsupported-override`, `override-already-satisfies` | A `>=` floor never gains an upper bound, and a hand-written object override is never rewritten. |
   | R7 | — | — | Anything but an `in-line` floor, and any rejection, needs a human. |

   R5 picks the lowest fixed version from the first non-empty tier. Each tier
   sets the floor's kind:

   | Kind | Candidates | Auto-merge | Excluded from the release-age wait |
   | --- | --- | --- | --- |
   | `in-line` | Same caret line, published at least three days ago | yes | no |
   | `fresh` | Same caret line, younger than three days | no | yes |
   | `breaking-line` | Another line, published at least three days ago | no | no |
   | `breaking-line-fresh` | Another line, younger than three days | no | yes |

   The three days match Dependabot's default cooldown, so an automatic floor
   never adopts a release sooner than Dependabot would.

3. **The refresh applies floors and proves them.** After `npm update` and
   `npm audit fix`, the step "Raise override floors for out-of-range
   advisories" runs `plan-override-floors.mjs --apply`. That command:

   - writes the floors into `overrides`;
   - regenerates only the floored packages with
     `npm update <pkgs> --package-lock-only --ignore-scripts --min-release-age=3 --min-release-age-exclude=@sergienko4/israeli-bank-scrapers`,
     adding one `--min-release-age-exclude` per fresh floor;
   - re-audits;
   - drops any floor whose package still has an advisory, accepted or not, as
     `floor-ineffective` — `npm update` may resolve above the floor into a
     version that is still affected — retrying the rest at most twice;
   - drops every floor in the pass the same way when the regenerated tree
     has a blocking advisory on any other package that the tree before the
     floors did not have: a floored release brought it in, and npm cannot say
     which one;
   - when floors survive, keeps only the rejections whose package still has a
     blocking advisory in the floored tree, since a floored release may have
     relocked or dropped a package the plan rejected.

   Every npm call passes an allow-list (`assertAllowedNpmArgs`): lockfile-only
   `audit`, `view <pkg> time` and `update --ignore-scripts`, through
   `execFileSync` with an argument array. `install`, `ci`, `exec` and `npx`
   cannot run, and no third-party code executes. The step is best effort: a
   failure restores both files and the refresh carries no floor.

   The next step, "Verify only the lockfile and overrides changed", runs
   `--verify-manifest`. It fails the job before anything is committed if
   `package.json` differs anywhere outside the override keys the floor and
   prune steps reported.

   A refresh that changes `overrides` is titled
   `fix(deps): raise override floors for <GHSAs>`, because `overrides` is a
   shipped manifest field and the
   [release signal guard](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/ci-pipeline.md#release-signal-guard)
   requires a releasing type for it. The pull request arms auto-merge only
   when no pin crossed a major and the plan does not require review.
   Otherwise it is labelled `needs-manual-review`.

4. **A four-hourly advisory watch.** A new `advisory` job audits `main` on
   every trigger, plus a new cron, `23 */4 * * *`. On that trigger the
   `refresh` job runs only when the audit exits 1. Exit 2 fails the
   `advisory` job, so GitHub notifies and nothing is regenerated. The job runs
   the same `--apply` in its own throwaway checkout, because only applying
   reveals a `floor-ineffective` floor. When the planner rejects any
   advisory, the job keeps one open issue titled
   "Unresolved dependency advisories", labelled `blocked-by-advisory`, whose
   body is the rejection table. Once every advisory has a floor, the body
   says so instead, including whether a floor holds the refresh for a
   maintainer, and the issue closes once `main` audits
   clean. That issue is the notification for an advisory no pull request can
   carry. The job uses the workflow token (`contents: read`,
   `issues: write`) and never `RELEASE_TOKEN`. The audit and planner steps
   hold no token at all.

5. **One refresh per change on the four-hourly trigger.** While `main` stays
   red, every four-hourly run computes the same change. Before pushing, the
   run looks for an open `chore/lockfile-refresh-*` pull request that meets
   all four conditions:

   - its head carries byte-identical `package.json` and `package-lock.json`;
   - it is not behind `main`;
   - it has the same `needs-manual-review` state as the new run;
   - when the new run would arm, auto-merge is armed on it.

   If one exists, it opens nothing. A refresh whose arming failed is
   replaced, which re-arms it. A fresh floor that ages past three days
   changes the review state, so it is reopened as an armed `in-line` floor
   and supersedes the labelled one. Weekly, push and dispatched runs always
   regenerate, as before.

6. **A weekly prune.** On the weekly and dispatched runs, before the floor
   step, `plan-override-floors.mjs --prune` tries removing each plain floor
   override (`^x.y.z` or `>=x.y.z`) in name order. Any other shape — an exact
   pin, a range with an upper bound, a `$dependency` reference or an object —
   may encode a cap that matters again later, so it is kept as `not-a-floor`.
   The removal stands only when
   `npm update <pkg> --package-lock-only --ignore-scripts` then locks exactly
   the same version of every package in the lockfile. Otherwise both files are
   restored and the override is kept. A floor therefore leaves the manifest
   once its parent catches up, and `overrides` stops growing monotonically. A
   prune changes no locked version, so it never needs review. A prune-only
   refresh is titled `fix(deps): drop <n> redundant overrides`.

7. **Blocked Dependabot pull requests recover.**
   - `pr.yml` names the audit step `Audit dependencies`, inside the
     `Build & Audit` job, so its conclusion can be read from the jobs API.
   - On every PR Pipeline verdict for a Dependabot pull request,
     `dependabot-auto-merge.yml` first removes a `blocked-by-advisory`
     label (best effort).
   - It labels the pull request again only when all three hold:
     - the verdict is a failure;
     - `Audit dependencies` itself failed in that run;
     - auditing the pull request's merge-base `package.json` and
       `package-lock.json` with `main`'s trusted policy exits 1.

     The merge base is the `main` commit the branch was built on, so the
     label marks a pull request whose base was already red: most likely an
     advisory it **inherited**. A pull request whose base audits clean
     introduced its own advisory and is not labelled. Triage does not compare
     advisory sets, so a pull request that fixes the base's advisory but adds
     another is labelled too; its rebase onto a clean `main` fails again,
     which clears the label, so the cost is one nudge.
   - The `rebase-behind` job audits `main` on every run. When the audit
     exits 0, labelled pull requests join the armed ones in its queue, oldest
     first, under the existing two-hour wait, two-nudge cap and one nudge per
     run. The label stays through the nudge; the next verdict on the rebased
     head clears it, then arms or re-labels.

### Supporting decisions

- **Same-line and aged first.** By semver a caret line is non-breaking, and the
  three-day wait is the window in which a compromised or broken release is
  usually caught. A floor that meets both is as safe as a Dependabot patch
  bump, so it auto-merges like one. Anything else is still planned, applied
  and proved, but waits for a human.
- **The planner is pure, and the CLI owns side effects.** Every rule is
  unit-tested against fixed inputs, including the `re2js` incident itself.
  The CLI is covered end to end.
- **The commit stages `package.json` whenever it differs.** That covers floor
  and prune results alike. The verify step bounds what can differ.
- **Fail closed at the verify step, not the floor step.** A floor or prune
  failure restores both files and leaves the refresh as it was before this
  ADR. Only the manifest verification and a malformed plan fail the job,
  because those mean something changed that this workflow has not reasoned
  about. A floor failure or rejection also withholds the "nothing changed"
  close: the supersede step retires open refreshes on an unchanged tree only
  once the planner finished with no rejection, so neither a planner failure
  nor a transient rejection (for example `missing-publish-times`) closes an
  open floor pull request. A run that opens a replacement supersedes only
  when its planner finished, rejections or not: a replacement from a failed
  planner carries no floor and must not retire a refresh that may, so both
  stay open until a run plans again. Gating on rejections too would let
  stale refreshes pile up for as long as an advisory has no fixed release.
- **Merge base, not head or `main`.** Auditing the pull request's head cannot
  tell an inherited advisory from one it introduced. Auditing `main` cannot
  tell whether the pull request was built before or after a fix.
- **Least privilege for the new reads.** Triage reads the jobs, compare and
  contents APIs with the workflow token. The merge-base audit and the
  `rebase-behind` audit hold no token. `RELEASE_TOKEN` appears only on the
  steps that write a label or post the nudge. In `rebase-behind` it moved
  from the job's environment to the nudge step.
- **The workflows create the label.** Both workflows run
  `gh label create blocked-by-advisory --force` with the same colour and
  description before the first use, so no manual repository setting is
  needed.
- **Triage matches the step by name.** A run made before this change names
  the step "Run npm run audit" and is not triaged. Renaming either the job or
  the step disables triage silently, so a gate test pins both names.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Hand-write each floor (the status quo) | Reactive by construction: the trigger is red pull requests. It needs a developer machine that can reach the registry, and it leaves every blocked Dependabot pull request for a manual rebase. |
| Accept the advisory in `config/audit-policy.mjs` | Acceptance exists for advisories with no upstream fix. A fixed release existed. |
| `npm audit fix --force` | It raises declared ranges and crosses majors with no rule for which, and it edits `package.json` beyond `overrides`. |
| Wait for the parent to release | `markdownlint`'s latest release still pins `re2js` 2.8.6, and nothing bounds when it will move. |
| Audit `main` hourly or on every push | A push to `main` already runs `npm run audit` in PR Pipeline. An advisory arrives without a push, and four hours bounds the window at a sixth of the hourly cost. |
| Rebase every red Dependabot pull request once `main` is green | It would also rebase pull requests that failed for their own reasons and burn the two-nudge budget on them. Triage limits recovery to pull requests that inherited an advisory. |
| Close blocked Dependabot pull requests and let Dependabot reopen them | It loses review history and waits for Dependabot's next scheduled scan. |
| Keep every floor forever | `overrides` would only grow. ADR-0001 rejected floors alone for that reason; pruning keeps each floor only while it still shapes the tree. |
| Renovate | Rejected in ADR-0001 and ADR-0002, for a second bot, its configuration language and its write access. The gap here is narrow and closes with the existing tooling. |

## Consequences

**Positive**

- An advisory whose fix sits on the same line, behind an exact pin, and is at
  least three days old is fixed with no human: a pull request within four
  hours, merged once its checks pass.
- Dependabot pull requests that an advisory on `main` blocked recover on
  their own once `main` is clean.
- An advisory the pipeline cannot fix opens one issue that names the reason,
  instead of only red pull requests.
- `overrides` shrinks as parents catch up.
- In `rebase-behind`, `RELEASE_TOKEN` is scoped to the nudge step rather than
  the job, so the new checkout, setup and audit steps never hold it.

**Negative**

- More runs: six `advisory` jobs a day, plus a full refresh while `main` is
  red, and an audit of `main` (about 30 seconds) in every `rebase-behind`
  run.
- Every floor or prune pull request is `fix(deps)` and cuts a patch release,
  even when every floored package is a development dependency.
- Fresh and breaking-line floors still need a human. They arrive planned,
  proved and labelled, not merged.
- The first weekly prune is expected to drop six overrides that no longer
  shape the tree: `brace-expansion`, `find-my-way`, `linkify-it`, `nanoid`,
  `smol-toml` and `uuid`. It arrives as an armed
  `fix(deps): drop 6 redundant overrides` pull request.

**Neutral**

- On a clean `main` the four-hourly run stops after the audit. The weekly,
  push and dispatched refresh behave as before, apart from the floor and
  prune steps.
- A `blocked-by-advisory` label can outlive its cause until the pull
  request's next verdict, which is when it is reconciled.

## Post-merge verification

These depend on scheduled triggers, the registry or a live advisory, and
cannot be exercised before merge. Check each one and record the result here.

1. #825 predates triage: its failing run names the step "Run npm run audit",
   so it is never labelled. Once this lands, comment `@dependabot rebase` on
   it by hand and confirm it goes green and auto-merges.
2. A four-hourly run on a clean `main` shows `advisory` green and `refresh`
   skipped.
3. The first weekly run opens the prune pull request above, armed, and it
   merges.
4. On the next advisory, the pipeline follows the incident timeline: a floor
   pull request within four hours of publication; `blocked-by-advisory` on
   Dependabot pull requests that inherit it; a nudge once the floor merges;
   and the label cleared by the rebased head's verdict.
5. An advisory with no eligible floor opens the "Unresolved dependency
   advisories" issue, and the issue closes once `main` audits clean.
6. An npm registry outage fails the `advisory` job (exit 2) and opens nothing.
