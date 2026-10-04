# Bank token store

`src/Scraper/Tokens/BankTokenStore.ts` keeps the long-term tokens that
OneZero and PayBox mint after an SMS login, and the device state Pepper issues
when an SMS login enrolls the importer, so a later run can log in without
another SMS. Each is a standing bypass of the second factor, and this page
calls both tokens unless it says otherwise. Upstream measured one OneZero token
valid for ten years; that is one observation, not a promise.

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
  collapses them, so the path means one place to the OS and another to any
  code that tidies it;
- a path with a `..` segment. Behind a symlink the OS resolves `..` from the
  link's target, while path joining drops the link lexically, so the path
  names two directories depending on who resolves it;
- a path that can only name a directory: one ending in a separator (`/`, or
  `\` on Windows), a root (including a Windows share root such as
  `\\server\share`), or a final `.` segment. Such a store could never be
  written.

The store does not depend on the first two refusals. It builds its staged
copy, its quarantine name and the paths its sweep lists by appending to the
path as given, never tidying it, so all of them name what the OS names. The
refusals are an independent layer on top of that: a path whose meaning depends
on how it is resolved never reaches the store, so no later code that joins
paths can split a write from its sweep again.

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
  "onezero:oneZero": { "token": "…", "capturedAt": "2026-09-23T15:11:00.000Z", "login": "3f1c…" },
  "pepper-device:pepper": { "token": "…", "capturedAt": "2026-09-24T08:30:00.000Z", "login": "9a07…" }
}
```

The key is `<bankId>:<config entry name>`: the registry's bank id, then the
name of the `banks` entry the scrape came from. The registry trims entry
names and matches them case-insensitively, so `oneZero`, `onezero` and
`oneZero` followed by a space are one bank but three accounts, and get three
keys. Renaming an entry orphans its token, which costs one SMS. A blank or
missing entry name falls back to `bankId` alone.

Pepper's device state is stored under its own bank id, `pepper-device`, so it
never shares a key with the long-term token an earlier release saved under
`pepper:<entry name>`. That legacy entry stays in the file, unsent; see
[Pepper device state](#pepper-device-state).

The entry name is used verbatim, and the key is stored verbatim: normalising
either would put two accounts on one entry, and because each mint revokes the
previous token, both would then need an SMS on every run.

`login` is the fingerprint of the login that minted the token
(`src/Scraper/Tokens/LoginFingerprint.ts`): SHA-256, as 64 lowercase hex
characters, of the bank's company id and its identity fields. The identity
fields are upstream's `loginFields` minus `password`, each in the form the
provider receives it, so OneZero is keyed by email and Pepper and PayBox by
phone number. The password never enters it. A Pepper device state or a PayBox
token logs in by itself, so the binding is what stops one entry from importing
another's account.

**Invariant:** the file binds each token to exactly one login, and that
binding never moves.

## At rest

With `CREDENTIALS_ENCRYPTION_PASSWORD` (or the legacy `CONFIG_PASSWORD`) set,
every file the store writes holds no token, login or capture time in plain
text. Each record is sealed on its own, so a damaged record costs only that
account:

```json
{
  "onezero:oneZero": {
    "encrypted": true, "version": 1,
    "salt": "…", "initVector": "…", "tag": "…", "ciphertext": "…"
  }
}
```

- The whole record `{token, capturedAt, login}` is sealed. The login
  fingerprint is an unsalted hash of a phone number or email, so it would give
  the login away. The store key stays plain, because it addresses the entry.
- The cipher is the config file's: AES-256-GCM, with the key from
  PBKDF2-SHA512 at 100,000 iterations (`src/Config/ConfigEncryption.ts`). The
  salt is 32 bytes and the IV and tag 16 each; a record with any other size is
  unusable.
- The store key is the GCM additional data, so a record copied under another
  key does not open.
- Each write seals every record under one fresh salt, each with its own IV.
  Each read derives at most one key, for the salt of the file's first sealed
  record.
  No key is kept between calls.

`src/Scraper/Tokens/TokenRecordCipher.ts` does the sealing. The store opens
the records before it checks them, and seals them before a write reaches
`SecureJsonStore`, so every rule on this page applies to the opened record. A
seal that fails refuses the write and leaves the file as it was.

A record that does not open is an unusable entry, like any other damage: that
account logs in with one SMS, the file is not intact, and the next write
quarantines it. That covers a changed password, an edited record and a record
moved under another key. A record that does not match the password setting
fails closed in the same way:

| Password | Record on disk | Read as |
|---|---|---|
| Set | Sealed under this password | The opened record |
| Set | Sealed under another password, or edited | Unusable |
| Set | Plain text | Unusable, so no one who can write the file can plant a Pepper device state or a PayBox token |
| None | Sealed | Unusable |
| None | Plain text | The record |

So turning the password on, turning it off or changing it costs one SMS per
account, once. The store rewrites the file only when it saves a token, so a
plain-text file stays at `bank-tokens.json` until then, and after that as
`bank-tokens.json.quarantined-*`, because a quarantine renames the file rather
than rewriting it. Its tokens are unusable under the password either way, so
delete `bank-tokens.json` when turning the password on, or the quarantined copy
later. The store never deletes a quarantined file, since after other damage it
can hold the only copy of a token.

## Reading

`read(storeKey)` returns an `ITokenView`:

- `record`: this key's usable record, or an empty one;
- `isIntact`: false when the file was damaged or held any unusable entry;
- `loginOf(token)`: the login the file binds a token to under any key, or
  `''` when no entry does.

The view carries this account's record and nothing else a caller could send:
another account's token can only be asked about, never listed.

| On disk | `read(storeKey)` returns |
|---|---|
| No file | success, empty record, intact |
| No entry for the key | success, empty record |
| An unusable entry anywhere in the file | success, that entry reads as empty, **not intact** |
| Damaged file (bad JSON, wrong shape, symlink, oversized) | success, empty record, **not intact** |
| A file that could not be read (permission, refused close, hard link others can read) | **failure** |

The last row is a failure rather than an empty record so the caller can say
why a run went cold. Swallowing it would make a broken store
indistinguishable from a first run.

With a password set, an entry is usable only if it opens
([At rest](#at-rest)), and the rules below apply to the opened record. An
entry is usable when `token` is an own string that is non-blank once
trimmed and `login` is a fingerprint. A token bound to two different logins
makes every entry holding it unusable, since none of the bindings can be
trusted over the others. A missing or non-string `capturedAt` reads as `''`.

## Writing

`write(storeKey, token, login)` reads the file afresh, merges one account in,
and replaces the whole file. It writes nothing, and succeeds, when:

- the token is blank — upstream returns `''` when a run mints nothing, and
  storing it would erase a working token;
- the file is intact and already holds that token under this key.

It refuses, with a failure naming the key and never the token, when:

- `login` is not a fingerprint: a login with no identity has nothing to bind
  a token to;
- the file binds the token to another login, under any key. The first binding
  is the one the bank issued, and moving it would break the invariant;
- the file could not be read — replacing what cannot be read would destroy
  every other account's token.

If `SecureJsonStore` reported the file damaged, or stripped of a top-level
`__proto__` key, or an entry it returned is not a usable token, the file is
quarantined before it is replaced, so that copy of a credential is never
overwritten. The usable entries are carried into the new file. A stripped
file also cannot vouch for a configured token: the key it held could hide a
token bound to another login, so the configured token is not sent.

An earlier duplicate of a key never reaches this store, because `JSON.parse`
discards it in favour of the last, so it does not trigger a quarantine and is
not carried over. This store never writes one.

Every record handed to `SecureJsonStore` has no prototype. The store strips
the prototype from the record set, but not from the entries inside it, and an
entry that inherits a `toJSON` planted on `Object.prototype` would let that one
function rewrite every account's token in a write that reports success.

Every token read from the file, and every token about to be written, is
registered with the value masker first, so no output shows one even when a
bank quotes it back with no key in front of it.

## Removing

`remove(storeKey)` deletes one account's entry and keeps every other entry as
it was. Like a write, it reads the file afresh and replaces it whole, so a
damaged file is quarantined first and a file that could not be read is never
replaced. A key with no usable entry writes nothing, and succeeds: there is
nothing that account could send, and the next write sets any damage aside. A
failure names the key and the cause, never the token
(`Could not remove the long-term token for <key>: <cause>`).

Only Pepper's device state is ever removed, and only after Pepper refused it;
see [Pepper device state](#pepper-device-state). A long-term token the bank
refuses is replaced by the next SMS login instead.

## Leftover staging files

A process killed mid-write can leave a staged file holding a live token.
`sweepStagedLeftovers()` removes those older than an hour. Whoever owns the
store's lifecycle should call it on every run, not only after a restart: a
file staged just before a restart is still younger than an hour when the
process comes back, and a warm run that writes nothing never commits. Commits
also sweep afterwards. [Wiring](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/bank-token-store.md#wiring) says where the importer calls it.

## Wiring

`buildScrapeStrategy` in `src/Importer/PipelineComposition.ts` builds one
store per import process and hands it to the live strategy.
`openBankTokenStore` in `src/Importer/BankTokenStoreWiring.ts` reads the
config password once and gives the store a sealing cipher, or the plain-text
one when no password is set. Building it touches no file and derives no key,
so a run that scrapes only browser banks never opens the token file; a
malformed `BANK_TOKENS_PATH` still fails the run at startup.
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
   that field only on success, so the callback is what keeps a token minted
   before a failure. A failure the provider returned is still a result, even
   after the retry policy spent its tries: `ExponentialBackoffRetry` keeps the
   last try's error as the `cause` of the error it throws, and
   `restoreProviderResult` in `AttemptRunner.ts` hands that result back. Only
   an error with no result, such as a timeout, skips this step. The store
   skips a token it already holds, so after the callback stored a token the
   backstop writes nothing. After the callback failed to store it, the
   backstop tries once more, so a store that stays broken warns twice.

`buildTokenCaptureParams` in `src/Scraper/Strategies/Live/ScraperSetup.ts`
builds what all three steps share, so the callback and the backstop use the
same key and login, and all three skip browser banks.

An attempt that captures a token runs a single try. The timeout abandons a
scrape rather than cancelling it, so a retry would log in beside the try it
replaced, and since every login revokes the token before it, the abandoned
try's late callback could store a token the bank no longer honours.
`pickRetryStrategy` in `src/Scraper/Strategies/Live/AttemptRunner.ts` gives
these attempts the single-try policy it gives every 2FA bank, so a timeout
ends the attempt. `runWithOtpRetry` gives them no INVALID_OTP retry either,
so one config entry's scrape makes a single attempt. A login that finishes
after its try timed out is then the only login, and storing its token is
correct; if the process exits first, the token is lost and the next run logs
in cold.

A failed write is logged as a warning naming the store key and the cause,
such as `EROFS` or `ENOSPC`; a failed sweep names the directory and the cause.
The scrape's result and transactions are returned unchanged. Neither the token
nor the session bearer is logged.

### Replay

Before each attempt of an API-direct scrape, `resolveWarmToken` in
`src/Scraper/Tokens/WarmTokenResolver.ts` chooses the token the login sends,
and `warmLogin` in `AttemptLogin.ts` hands `buildCredentials` a copy of
the entry that carries only that token. The store is read on every attempt;
browser banks never read it. The order is:

1. the entry's stored token, when it is bound to this attempt's login (INFO
   `Using the stored long-term token for <key>`). When it is bound to another
   login, the entry's email or phone number changed since it was minted: no
   token is sent, and the configured one is not consulted either, since it is
   at least as old (INFO);
2. when the store holds none for the entry, the configured
   `otpLongTermToken`, only if it is non-blank text, the file is intact, and
   `loginOf` binds it to no other login (INFO
   `Using the configured long-term token for <key>`). Otherwise a WARN and no
   token;
3. otherwise no token, so the provider logs in cold with an SMS.

Every doubt fails closed. No login fingerprint, and a store that cannot be read
or throws, each give a WARN naming the key, and no token. A damaged file warns
whenever it leaves the attempt with no token: when it stops a configured token
from being sent, and when no token is configured and it holds none usable for
the key. The store's view cannot say whose entry was damaged, so that warning
does not claim it was this one. A stored token the store can still read is
sent as usual, with only the INFO line. When
no token is sent and the attempt has no OTP retriever (`twoFactorAuth` off),
a WARN names both fixes. Upstream then fails the cold login with
`TWO_FACTOR_RETRIEVER_MISSING`, which the importer treats as permanent and
does not retry.

Upstream reports a refused token only to its own logger, so
`WarmTokenWatch` in `src/Scraper/Tokens/WarmTokenWatch.ts` watches the two
signs the importer does see. When an attempt sent a token, its OTP retriever
warns once before a cold login asks for a code
(`The long-term token for <key> was not accepted, so this run logs in with an
SMS code`); upstream asks for a code only on a cold login. With no retriever
the attempt fails with `TWO_FACTOR_RETRIEVER_MISSING`, and `settleToken` in
`AttemptRunner.ts` warns with the `twoFactorAuth` fix. The warnings say "not
accepted" rather than naming the bank, because upstream can also set aside a
token it judges stale before it asks the bank. Neither warns when no token was
sent, since the resolver has already said why. A stale token takes neither
path: upstream spends the run's one cold login at once, and when that login
fails its second one is refused, so the attempt fails as `GENERIC` with
`already spent its one cold SMS login`, which the error advice explains.

The attempt's login fingerprint is computed once, in
`buildTokenCaptureParams`, so the resolver and the capture use the same login,
and a token the attempt mints is bound to the login that sent it. The chosen
token is registered with the value masker, and no log line shows it.

### Pepper device state

From scraper 8.7.4 Pepper keeps a login only as an enrolled device: one SMS
login enrolls the importer, and the state Pepper hands back logs later runs in
with no SMS. `attachDeviceAuth` in `src/Scraper/Tokens/PepperDeviceState.ts`
keeps that state in this store under `pepper-device:<entry name>`, bound to
the attempt's login fingerprint like a token, so every rule on this page
covers it. Before each Pepper attempt it reads that key and starts the login
in one of three ways:

- **resume:** a state bound to this login is sent as `persistentAuthState`,
  with the `onPersistentAuthStateUpdate` callback (INFO
  `Using the stored Pepper device state for <key>`). Upstream replays it with
  no SMS, or renews it with no SMS and calls back with the renewed state;
- **enroll:** no usable state, or one bound to another login (INFO), so only
  the callback is attached and upstream enrolls with one SMS. A damaged file
  warns, as it does for tokens;
- **legacy:** no login fingerprint, or a store that cannot be read or throws.
  A WARN names the key and neither option is attached, so Pepper logs in with
  an SMS as before. Upstream fails a run that attaches the callback for an
  entry with no phone number, and a store that cannot be read would refuse
  the state and fail the run after its SMS, so this run still imports.

The callback stores each state with `write` and resolves only once it is
stored (INFO `Stored the Pepper device state for <key>`). Upstream waits for
it, and when it rejects, fails the run as `persistent auth failed: callback`
before using the new state, so the previous one stays stored. With no state
to send and no OTP retriever, a WARN says to turn on `twoFactorAuth`.

Pepper refuses a long-term token next to either option. `deviceLogin` in
`AttemptLogin.ts` drops a configured `otpLongTermToken` with a WARN naming
`pepper:<entry name>`, and never calls `resolveWarmToken`, so a token an
earlier release stored under that key stays in the file unsent.
`onAuthFlowComplete` stays attached, so the attempt keeps the single-try
policy, though upstream does not call it for a device login.

After an attempt that sent the state, `settleToken` calls
`forgetRefusedState` in `src/Scraper/Tokens/PepperStateRefusal.ts`, which
removes the state only when the result is a `GENERIC` failure that says Pepper
refused the state itself:

- `persistent auth state invalid: <category>`; or
- a 401 or 403 from `https://sa.pepper.co.il/api/v2/auth/login`.

Every renewal request is signed with the state's device key, and
`auth/login` goes first, so a device Pepper no longer knows is refused there.
The `/api/v2/auth/assert` step that follows adds the entry's password, so its
4xx other than 408 or 429 keeps the state and warns
`Kept the Pepper device state for <key>; Pepper refused the password, so check the password in the config`.
Removing it would cost an SMS once the password is fixed.

Every other failure keeps it silently, since the next run may succeed with
it: a timeout, a Cloudflare page (`WAF_BLOCKED`), a 5xx, 408 or 429, any
other login status, a network error, a refused data request (the state may
still renew), and a rejected callback. Upstream recognizes only Cloudflare's
page, so a 401 or 403 that another proxy returns for `auth/login` is
`GENERIC` like Pepper's own: it removes the state, and the next run costs one
SMS. A removal warns
`Removed the Pepper device state for <key>; the next run asks for one SMS code`,
so the next run enrolls instead of sending a dead state on every run. A removal
that fails warns with the cause, and the next run sends the state again.
`tests/scraper/PepperStateRefusal.test.ts` checks the wording this rule reads
against the installed upstream bundle, so a bump that rewords it fails the
tests.

## Limits

One writer is assumed. Two importers sharing one file can lose an update: the
losing account keeps its previous token, the bank rejects it, and the next
cold login re-mints it for the cost of one SMS. No lock is taken, because a
lock that could wedge a scheduled scrape would cost more than that.

Keep one config entry per bank login. Entries are scraped one after another
and each is stored under its own key, so a login abandoned by one entry never
overwrites another entry's token. Two entries that log in to the same account
are the exception: each login revokes the token the other stored, with or
without a timeout, so both need an SMS on every run.

Sealing hides the tokens, but it cannot catch every change to the file. GCM
detects an edited record, not a deleted one, nor an older record of the same
key put back. Either leads to one cold login, as deleting the file would: the
store sends that login's older token, which the bank refuses, or none. A read
derives its key from the first sealed record's salt, so changing that salt to
another well-formed one makes every record unusable.

The store can vouch only for the tokens it holds now. A configured token it has
never seen is trusted as the entry's own, which is how a token from another
install is brought in. Once a login change has replaced a record, the old
token is no longer in the file, so pasting it into another entry's
`otpLongTermToken` cannot be recognised as another login's. The same holds
after a `SIGKILL` between the two quarantine renames. The configured token is
input the operator asserts for its own entry; tracking every replaced token
until it expires was judged more machinery than this risk warrants.

Replay is tested end to end for all three banks against a fake bank built from
upstream's published login fields and warm-login rules
(`tests/e2e/WarmStartReplay.e2e.test.ts`,
`tests/scraper/ApiDirectBankContract.test.ts`). Pepper's device login is tested
end to end through the shipped import assembly against a fake Pepper that
follows upstream's persistent-auth flow
(`tests/e2e/PepperDeviceState.e2e.test.ts`). The real transport is not:
Pepper and PayBox call the bank from inside a Camoufox page, and OneZero uses
mutual TLS, so no test can stub their requests.
