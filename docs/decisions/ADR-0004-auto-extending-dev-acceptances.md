# ADR-0004: Let a development-tree acceptance outlive its expiry while its fix is blocked

- **Status:** Accepted
- **Date:** 2026-11-06
- **Deciders:** Repository maintainer
- **Amends:** [ADR-0003](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0003-automated-override-floors.md)

## Context

In November 2026 two moderate advisories turned `npm run audit` red on
`main`, and with it every pull request built on `main`: Dependabot pull
requests #853 and #854 and lockfile refresh #857 all failed `Build & Audit`
and `CI Pass` for reasons unrelated to their own changes.

- `GHSA-3g3m-2fjr-6pw4` against `glob` `>=9.0.0 <=14.0.1`. The copy in the
  production tree was fixed with an `overrides` floor, `"glob": "^14.0.2"`.
- `GHSA-g3hv-75wg-m249` against `minimatch` `>=7.0.0 <11.0.1`. `glob` 14
  depends on `minimatch` 11, so the production copy went with the floor
  above. Six locked development tools still declare ranges that stop below
  11: `eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree`,
  `eslint-plugin-import-x`, `eslint-plugin-sonarjs` and `typedoc`.

The first fixed `minimatch` is 11.0.1, and `minimatch` 11 changes API those
tools call: it removes `makeRe`, which `eslint-plugin-import-x` 4.17.1 imports,
and makes `matchOne` private, which `typedoc` 0.28.20 calls. A global floor
would break `npm run lint` and `npm run docs`, so no floor
[ADR-0003](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/decisions/ADR-0003-automated-override-floors.md)
could plan would help: the fix crosses a major line that the locked versions
of these tools exclude. The development copies were accepted in
`config/audit-policy.mjs`, a deferral that never reaches the published image.

Every acceptance has a hard `expires` date. That is the point of one: a
deferral that nobody revisits expires into a build failure. But here the
failure carries no information. If the tools still exclude the fix on the
expiry date, the build goes red on `main` and on every pull request, the
incident above repeats, and the only remedy is a pull request that moves a
date. Picking a far-off date instead removes the forcing function entirely,
including on the day the fix becomes installable.

## Decision

Let a development-tree acceptance opt into running past its expiry for exactly
as long as the committed lockfile proves its fix cannot be installed, and make
every such extension visible on every audit run.

1. **Opt-in, development tree only.** An entry in `ACCEPTED_ADVISORIES` may set
   `autoExtend: { fixedIn }`, the first version that fixes the advisory, as a
   plain `MAJOR.MINOR.PATCH`. Any other value fails the gate with
   `exception has an invalid autoExtend.fixedIn version`. When the advisory
   reaches the production tree, an auto-extending entry is refused outright,
   with `an auto-extending exception is development-only`: shipping a known
   vulnerability stays capped at 30 days and dated.

2. **Blockers come from the committed lockfile.** `config/audit-blockers.mjs`
   lists every installed package under `node_modules/` whose declared range
   for the vulnerable package cannot reach `fixedIn` while the copy it loads is
   still affected. The root, workspace folders and links are skipped: this
   repository controls their manifests and can always take the fix. The
   declared range is read in npm's precedence, `optionalDependencies` over
   `dependencies` over `peerDependencies`, and every `||` alternative must stay
   below the fix. The copy is the nearest `node_modules/<package>` on the
   package's install path, as Node resolves it. It is affected only while it is
   installed, below `fixedIn`, inside the vulnerable range `npm audit` reports
   for the advisory, and inside the range the package declares; a copy that
   fails any of these, such as one an override placed, blocks nothing, even
   when the range would. A missing or unreadable advisory range, or an
   advisory the audit no longer reports, blocks nothing. It reads only
   comparators made of an optional operator and a plain version; an x-range,
   hyphen range, prerelease, `*` or dist-tag counts as not blocking. A range or
   version it cannot read therefore fails closed into a build failure, never
   into a longer waiver. The module is pure and reads no registry, so the
   verdict is reproducible from the commit and its audit report alone.

3. **An expired entry stands only while something blocks the fix.** Before
   `expires` an auto-extending entry is an ordinary deferral. From `expires`
   on, it stands only while the blocker list is non-empty. Once the list is
   empty, no locked package provably blocks the fix, and the gate fails with
   `exception expired on <date>; it auto-extends only while a locked package blocks <package> <fixedIn>, and none does`:
   take the fix and remove the entry. The blocker list lives under a `Symbol`
   key that only `resolveAutoExtensions` writes, so a `blockers` field typed
   into the policy file cannot vouch for an entry.

4. **One entry point.** `classifyCommittedAudit(audit, lockPackages)` resolves
   the blockers and classifies the audit in one call. `config/check-audit.mjs`
   and `scripts/plan-override-floors.mjs` both pass the committed lockfile, so
   the gate and the floor planner cannot disagree about an entry. A missing or
   unreadable lockfile yields no packages, so nothing extends.

5. **Warnings, never verdicts.** The gate prints GitHub Actions `::warning::`
   annotations, in this order: each acceptance running past its expiry, naming
   the packages that block its fix; each acceptance that expires within 21 days
   (`EXPIRY_WARNING_DAYS`) and is not still blocked; and each entry whose
   advisory `npm audit` no longer reports at any severity. Every workflow reads
   only the gate's exit code (ADR-0003, Decision 1), so a warning never changes
   a verdict.

6. **The shipped data is tested, not only the rules.** The unit suite pins the
   list of opted-in entries, so opting another entry in, or moving its
   `fixedIn`, is a reviewed change to that test. It classifies each shipped
   entry against the committed lockfile and the vulnerable range npm reports
   for it, which the test pins too, so once an auto-extending entry is
   past its expiry and the last blocker is gone, the suite fails and forces the
   entry's removal. A frozen clock exercises each entry past its expiry in the
   gate and the planner as child processes, before the calendar gets there.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Renew the date by hand when it lapses | The trigger is a red `main` and red pull requests, and the remedy is a pull request that carries no information. |
| Set a far-off expiry | It removes the forcing function, including on the day the fix becomes installable. Auto-extension ends as soon as no locked package provably blocks the fix. |
| Override `minimatch` to `^11.0.1` everywhere | It breaks `npm run lint` and `npm run docs`, as described above. |
| Audit with `--omit=dev`, or raise `AUDIT_LEVEL` | Both suppress a scope or a severity rather than one advisory, and hide every future development-tree advisory with it. |
| Patch or fork the tools | A patch per tool release to maintain, for code that never ships. |
| Let production entries auto-extend too | A shipped vulnerability must stay a deliberate, dated risk with a 30-day cap. |
| Ask the registry who blocks the fix | It puts the network into the gate's verdict. The committed lockfile is versioned, reviewed and reproducible. |

## Consequences

**Positive**

- An expiry no longer turns `main` and every pull request red while the fix
  still cannot be installed.
- The day no locked package provably blocks the fix, the gate and the unit
  suite fail and ask for the entry's removal, instead of a date someone picked
  months before.
- Every audit run names the packages that hold an extended acceptance open,
  warns three weeks before an ordinary expiry, and flags entries that have
  outlived their advisory.

**Negative**

- An extended acceptance has no end date while upstream does not move. Only
  the warnings keep it visible, and the pinned opt-in list keeps each one a
  reviewed decision.
- A blocker is whatever the committed lockfile says a package declares and
  loads, so a hand-edited lockfile could invent one. Dependabot, the lockfile
  refresh and the `Lockfile sync` job all resolve against the registry; a hand
  edit has to get past review.
- Blockers trust the vulnerable range `npm audit` reports.
  `config/audit-report.mjs` keeps one range per package and advisory, so if
  npm ever reports several, an entry can lapse early. That fails closed into a
  red build, never into a longer waiver.
- Past the expiry there is no grace period: the first audit run that finds no
  blocker fails the gate. That run is usually the Dependabot or lockfile
  refresh pull request that removed the last blocker, so a bump can turn red
  for a package it does not name. The remedy is to remove the entry, and take
  the fix, in that same pull request.

**Neutral**

- Production acceptances keep their evidence rules, their 30-day cap and their
  hard expiry.
- The warnings add lines to the audit step's log and annotations to the run
  summary, and change no workflow's behaviour.

## Post-merge verification

These depend on the calendar and on upstream releases. Check each one and
record the result here.

1. If a development tool still pins `minimatch` below 11.0.1 on 2027-01-29,
   `Audit dependencies` on `main` stays green and prints
   `::warning::GHSA-g3hv-75wg-m249 (minimatch) acceptance expired on 2027-01-29; auto-extended while …`,
   naming the tools.
2. When the last of those tools takes `minimatch` 11 and the advisory leaves
   the tree, the gate warns that the entry is no longer reported; remove it.
   If, after 2027-01-29, a `minimatch` 10 copy lingers although nothing blocks
   the fix, the gate fails with `… and none does`; `npm update minimatch` or a
   floor clears it.
