# Bank token store

`src/Scraper/Tokens/BankTokenStore.ts` keeps the long-term tokens that
API-direct banks (OneZero, Pepper, PayBox) mint after an SMS login, so a
later run can log in without another SMS. A token is a standing bypass of the
second factor, and OneZero's is valid for ten years.

The store is a thin adapter over [`SecureJsonStore`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/secure-json-store.md),
which owns every filesystem guarantee: no-follow reads, owner-only files,
exclusive staging, atomic publish, quarantine and the size cap. Read that
page's threat model before changing how the file is touched. This page covers
only what the adapter adds.

## Location

`/app/data/bank-tokens.json` on the writable data volume, or the absolute
path in `BANK_TOKENS_PATH`. These overrides are refused at startup with a
`ConfigurationError`:

- a relative path, which would resolve against whatever directory the process
  started in, so a restart from elsewhere would silently use a different file.
  On Windows a path with no drive or share, such as `\data\x.json`, is refused
  for the same reason: it follows the current drive;
- on Windows, a `\\?\` or `\\.\` device prefix. After `\\?\` Windows passes
  `.` and empty segments to the disk as literal names, while path joining
  collapses them, so the store would stage and sweep in different places;
- a path with a `..` segment. Behind a symlink the OS resolves `..` from the
  link's target, while path joining drops the link lexically, so the store
  would write in one directory and sweep leftover staged tokens in another;
- a path that can only name a directory: one ending in a separator (`/`, or
  `\` on Windows), a root (including a Windows share root such as
  `\\server\share`), or a final `.` segment. Such a store could never be
  written.

An accepted override is used as written. With the cases above refused,
repeated separators and `.` segments resolve the same lexically and on disk,
so they are not normalised away.

The store never creates a directory. The image provisions `/app/data`; an
override pointing into a directory that does not exist makes every write fail
with `ENOENT`, and the run logs in cold.

## File layout

One flat record per bank account, keyed by the store key:

```json
{
  "onezero:oneZero": { "token": "…", "capturedAt": "2026-09-23T15:11:00.000Z" },
  "pepper:pepper": { "token": "…", "capturedAt": "2026-09-24T08:30:00.000Z" }
}
```

The key is `<bankId>:<config entry name>`: the registry's bank id, then the
name of the `banks` entry the scrape came from. The registry trims entry
names and matches them case-insensitively, so `oneZero`, `onezero` and
`oneZero` followed by a space are one bank but three accounts, and get three
keys. Renaming an entry orphans its token, which costs one SMS. A blank or
missing entry name falls back to `bankId` alone.

The entry name is used verbatim, and the key is stored verbatim: normalising
either would put two accounts on one entry, and because each mint revokes the
previous token, both would then need an SMS on every run.

## Reading

| On disk | `read(storeKey)` returns |
|---|---|
| No file | success, `''` |
| No entry for the key, or an unusable entry | success, `''` |
| Damaged file (bad JSON, wrong shape, symlink, oversized) | success, `''` |
| A file that could not be read (permission, refused close, hard link) | **failure** |

The last row is a failure rather than `''` so the caller can say why a run
went cold. Swallowing it would make a broken store indistinguishable from a
first run.

An entry is usable when `token` is an own string that is non-blank once
trimmed. A missing or non-string `capturedAt` reads as `''`.

## Writing

`write(storeKey, token)` reads the file afresh, merges one account in, and
replaces the whole file. It writes nothing when:

- the token is blank — upstream returns `''` when a run mints nothing, and
  storing it would erase a working token;
- the file is intact and already holds that token;
- the file could not be read — replacing what cannot be read would destroy
  every other account's token.

If `SecureJsonStore` reported the file damaged, or an entry it returned is not
a usable token, the file is quarantined before it is replaced, so that copy of
a credential is never overwritten. The usable entries are carried into the new
file.

Two things are removed before this store sees the records, so they do not
trigger a quarantine and are not carried over: a `__proto__` key, which
`SecureJsonStore` strips on read, and an earlier duplicate of a key, which
`JSON.parse` discards in favour of the last. This store never writes either.

Every record handed to `SecureJsonStore` has no prototype. The store strips
the prototype from the record set, but not from the entries inside it, and an
entry that inherits a `toJSON` planted on `Object.prototype` would let that one
function rewrite every account's token in a write that reports success.

Failures name the store key and never the token.

## Leftover staging files

A process killed mid-write can leave a staged file holding a live token.
`sweepStagedLeftovers()` removes those older than an hour. Whoever owns the
store's lifecycle should call it on every run, not only after a restart: a
file staged just before a restart is still younger than an hour when the
process comes back, and a warm run that writes nothing never commits. Commits
also sweep afterwards. [Wiring](#wiring) says where the importer calls it.

## Wiring

`buildScrapeStrategy` in `src/Importer/PipelineComposition.ts` builds one
store per import process and hands it to the live strategy. Building it
touches no file, so a run that scrapes only browser banks never opens the
token file; a malformed `BANK_TOKENS_PATH` still fails the run at startup.
Mock runs (`E2E_MOCK_SCRAPER_DIR` or `E2E_MOCK_SCRAPER_FILE`) build no store.

For each API-direct scrape, `src/Scraper/Tokens/AuthFlowCapture.ts`:

1. sweeps leftover staging files before the first attempt. Every import,
   scheduled or on demand, is its own child process, so this runs on every
   run that can stage a token;
2. attaches `onAuthFlowComplete` to the provider options. The provider calls
   it as soon as a login completes, including a login it repeats mid-run
   because the bank rejected the session, so the new token is stored even if
   the scrape then fails;
3. when an attempt returns a result, stores its `persistentOtpToken` as
   well, in case a path fills it without calling back. The provider fills
   that field only on success, and a failure the retry policy turns into an
   error returns no result, so the callback is what keeps a token minted
   before a failure. The store skips a token it already holds, so after the
   callback stored a token the backstop writes nothing. After the callback
   failed to store it, the backstop tries once more, so a store that stays
   broken warns twice.

`buildTokenCaptureParams` in `src/Scraper/Strategies/Live/ScraperSetup.ts`
builds what all three steps share, so the callback and the backstop use the
same key and all three skip browser banks.

A failed write is logged as a warning naming the store key and the cause,
such as `EROFS` or `ENOSPC`; a failed sweep names the directory and the cause.
The scrape's result and transactions are returned unchanged. Neither the token
nor the session bearer is logged.

Nothing reads this store back yet. A config entry with `otpLongTermToken`
set still logs in with that token, and its login reports the token like any
other, so it is copied into the store; every other run logs in with an SMS.

## Limits

One writer is assumed. Two importers sharing one file can lose an update: the
losing account keeps its previous token, the bank rejects it, and the next
cold login re-mints it for the cost of one SMS. No lock is taken, because a
lock that could wedge a scheduled scrape would cost more than that.
