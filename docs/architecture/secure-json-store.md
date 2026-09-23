# SecureJsonStore threat model

`src/Storage/SecureJsonStore.ts` persists bank authentication tokens. A token
is a bearer credential: anything that can read it can act as the account
holder until it expires, and one of them is valid for ten years. The store is
therefore written defensively, and this page records what each guard is for.

Read it before deleting a check. Several of the guards below look redundant
until you know the attack they answer, and the unit tests are named after the
row numbers here (`threat 7: ...`) so a failure points straight at the
guarantee it removed.

## Trust boundary

The store assumes the **directory is not writable by an untrusted user**. It
cannot enforce that: Node exposes no directory-relative `renameat`, so the
staging, quarantine and publish steps act on names rather than descriptors.
In the shipped image `/app/data` is created `node`-owned and mode `0755`. A
bind mount replaces those bits with the host's, so whoever mounts the volume
owns that invariant.

Within that boundary the store is written to survive a hostile *local*
process racing it, a hostile *filesystem* misreporting a write, and a hostile
*caller* handing it an adversarial object graph.

## Threats and mitigations

STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nformation
disclosure, **D**enial of service, **E**levation of privilege.

| # | Threat | STRIDE | Attack | Mitigation | Test layer |
|---|--------|--------|--------|------------|------------|
| 1 | Symlink at store path | S, I | Planted link makes us read or write another file | `O_NOFOLLOW` on every open; the link is quarantined, never followed | integration |
| 2 | Symlink at the staging path | I | Predictable temp name plus the default `w` flag writes the token through the link | `wx` exclusive create; random UUID suffix | integration |
| 3 | Path swapped between check and use | S, T | `lstat`-then-`open` lets a different file be parsed | One lookup only: absence is learned from the open's errno | unit (fake) |
| 4 | Non-regular file at path | S, D | Directory or device served as JSON | `fstat` and `isFile()` on the descriptor | unit + integration |
| 5 | FIFO at store path | D | Blocking `open` hangs the whole process | `O_NONBLOCK` | integration (child process) |
| 6 | Hard link to a victim file | E | `fchmod` re-permissions a file we do not own | Skip the chmod when `nlink > 1`, and withhold the records | integration |
| 7 | World-readable store | I | Secrets readable by any local user | Exclusive create with mode `0600`; `fchmod` on read, and a refusal withholds the records | both |
| 8 | Oversized file | D | Multi-GB file exhausts memory on read | Reject above 8 MiB, size taken from `fstat` | unit (fake) |
| 9 | Malformed JSON | D | Parse failure aborts the run | Classified as damage: quarantine, then a cold login | unit (fake) |
| 10 | Prototype pollution | T | `__proto__` or `constructor` keys in the file | Null-prototype parse target; non-plain records refused | unit (fake) |
| 11 | Secret in error text or logs | I | Token surfaces in a log line or a typed error | Errors carry path and errno only, never values; asserted | unit (fake) |
| 12 | Quarantine name collision | T | Two failures in the same millisecond, the second clobbering the first salvage | Timestamp plus a random UUID | unit (fake) |
| 13 | Crash between quarantine and commit | T | Canonical path left absent, siblings stranded | Stage first, quarantine second, then rename. Partial: a *failure* between the two renames rolls the predecessor back (threat 16); a `SIGKILL` between them cannot be undone and leaves a cold start with the damaged bytes preserved under the quarantine name | unit (fake) |
| 14 | Staged secret left on disk | I | A failed commit leaves a readable token at the temp path | Best-effort removal in its own `try`/`catch`; the original error is preserved | unit (fake) |
| 15 | Short write reported as success | T, D | A filesystem stages fewer bytes than it was given; truncated JSON is published and reads back as a damaged store, losing every credential it held | Compare `bytesWritten` against the measured payload and abandon the stage on any mismatch | unit (fake) |
| 16 | Publish fails after quarantine | D | The predecessor is already moved aside, the replacement never lands, the store is left absent | Rename the predecessor back; if that also fails, the failure names the quarantine path so it can be recovered by hand | unit (fake) |
| 17 | Irregular entry quarantined | T | A directory at the store path is relocated whole, taking unrelated files with it | Quarantine only an entry established as a regular file or a symlink; refuse anything else | unit (fake) |
| 18 | Record dropped by custom serialisation | T, D | A value whose `toJSON` returns `undefined` is counted by `Object.keys` but omitted by `JSON.stringify`, so the report claims a credential was stored that the file never held | Verify the serialised text against the expected key set, and refuse text that is not a keyed object at all | unit (fake) |
| 19 | Malformed UTF-8 in the store | T, I | `Buffer.toString('utf8')` substitutes U+FFFD for bad bytes, so a corrupted file becomes valid JSON holding a silently altered credential and is served as healthy | Decode with `TextDecoder('utf-8', { fatal: true })`, report `EILSEQ`, classify as damage | integration (real fs) |
| 20 | `__proto__` accepted on write | T, D | An own `__proto__` survives the copy, `JSON.stringify` and the dropped-key check, so the commit reports success while the read path strips it — a credential written that no read can return | Refuse the key at serialisation, matching the read path that strips it | unit (fake) |
| 21 | Record set substituted during serialisation | T, D | An own `toJSON` on the record set runs before anything can inspect it and may delete itself, so keys read afterwards no longer describe what the caller handed over; it can drop records and inject records, and a subset check calls both a faithful write | Read the key set *before* serialising and require the serialised text to hold exactly that set. Missing keys are named (they are the caller's own); invented keys are only counted, because such a record set can promote a credential into a key name and naming it would print the secret into the error an operator logs | unit (fake) |
| 22 | Store path and listing disagree | I | A relative or double-slashed store path makes the sweep's prefix disagree with the joined paths a directory listing returns, so abandoned staging files holding live tokens are never collected and the sweep still reports success | Match on file name, not on the whole path. Normalising the store path instead would be worse: collapsing `..` lexically can select a different file when a symlink precedes it, and the candidate already comes from the listed directory | integration (real fs) |
| 23 | Staged data not durable before rename | T, D | `close` surfaces deferred write errors but does not flush; a crash can persist the rename while the contents are still in page cache, leaving the canonical path pointing at an empty file | `fsync` the staged descriptor before the call returns | not unit-testable |
| 24 | Record set is behaviour, not data | T, D | Threats 18-21 are each a different way for a caller's object to disagree with the bytes written: a getter that deletes a sibling mid-copy, a `toJSON` that erases itself, one that injects a record, one that keeps the key set and swaps every value, keys held on symbols that JSON drops without a word, an array whose entries reappear as `"0"` and `"1"`. Detecting each mechanism after the fact is an endless list, and the value-swap variant is undetectable in principle | Refuse behaviour at the door. A record set must be a plain object of plain data: no array or class instance at the root, no symbol keys, no `__proto__`, no accessors, no function values. With no code to run, copying, serialising and re-reading are guaranteed to agree, and the descriptor check never invokes a getter | unit (fake) |
| 25 | Caller's object lies to reflection | T, D | A `Proxy` can satisfy every shape check and still misbehave: `ownKeys` can throw, turning a commit that promises a result into one that throws; a key can be listed and then not described, so a helper that skips it would drop a credential and report success | Read keys once and describe each once, refusing a key that will not describe itself, with the whole pass inside one `try` | unit (fake) |
| 26 | Input re-read after it was checked | T, D | Validating the caller's object and then reading it again to copy it leaves a gap a proxy can drive through: the checked read returned `CLEAN`, the copying read returned `EVIL`, and the store wrote the second. The same applies to the request itself — `shouldQuarantine` was read *after* a credential had been staged, so a getter throwing there left that credential on disk with nothing left running to remove it | Read everything exactly once, up front, into a value the store owns. Values are lifted out of property descriptors rather than fetched again, so there is no second read to disagree with the first | unit (fake) |
| 27 | `toJSON` inherited rather than owned | T, D | Refusing an own `toJSON` does nothing about one inherited from `Object.prototype`. Any prototype pollution elsewhere in the process rewrites every commit: a store of real credentials serialises as `{"hijacked":true}` and reports success | Copy into a `null`-prototype object. There is no prototype left to inherit from, so the question cannot arise rather than being checked for | unit (fake) |
| 28 | Sibling property edits the records after handover | T, D | Reading `records` and then `shouldQuarantine` takes a reference to the caller's object and *then* runs caller code. A getter on `shouldQuarantine` can delete every key of the object `records` just handed over and add its own, so the set copied afterwards is not the set supplied — a commit of `{token}` wrote `{injected}` and reported success | Copy the records before reading the second property. Nothing the caller controls runs between the reference being taken and the copy being made; `shouldQuarantine` is still read before the filesystem is touched, so a getter that throws there still cannot orphan a staged credential | unit (fake) |

Threats 18 through 28 are one bug wearing eleven masks, and the fix for the
eleventh is what should have been the fix for the first. The store kept
*re-reading* an object it did not own — check it, read it again to copy it,
read the request again to decide about quarantine — and each read was a fresh
opportunity for the caller's object to answer differently. No amount of
checking closes that, because every new check is one more read.

Threat 28 is the same bug caught one step further out, and worth stating
plainly: *taking a reference is not taking a copy*. Reading `records` only
borrows the caller's object, so any caller code invited to run afterwards -
including a sibling getter on the request - is still running before the copy
exists. Ordering is therefore part of the contract, not an implementation
detail: copy first, read the rest of the request second.

`OwnedRecords` reads everything once and returns a value the store owns:
keys and values lifted straight out of property descriptors, copied into a
frozen object with no prototype, behind a type only that module can produce.
Values cannot change after validation because nothing reads them twice; no
accessor can run during serialisation because none survived the copy; no
inherited `toJSON` can intercept `JSON.stringify` because the copy has no
prototype. These are properties of the construction, not assertions checked
afterwards.

The unexpected-key half of the round-trip check consequently has no way to
fire. It is kept because it costs one comparison and it is what would notice
if serialisation were ever pointed back at a caller's object. The missing-key
half stays live: a *nested* value may define its own `toJSON` and return
`undefined`. Nested values are still not byte-for-byte — a `Date` is meant to
serialise as a string. The caller owns values; the store owns the set.

Threat 23 has no automated test. Proving it needs a real power loss or a
filesystem fault injector, and faking it would mean mocking `node:fs` — the
one thing this design exists to avoid. Flushing the *directory entry* after
the rename is deliberately not done: an unpersisted rename leaves the previous
store in place, which is already one of the two outcomes `commit` promises.

## Test layers

| Layer | Target | Mechanism | Covers |
|-------|--------|-----------|--------|
| Unit | `SecureJsonStore` | `FakeFileSystem` | All policy and every errno path, deterministic, no I/O |
| Integration | `NodeFileSystem` | Real temp directory | Only what a fake cannot prove: `O_NOFOLLOW`, `O_NONBLOCK`, `nlink`, mode bits, strict decoding, rename atomicity |
| Integration | `SecureJsonStore` on `NodeFileSystem` | Real temp directory | Path handling, where the fake's stored-key listing cannot model a real `join` |

The fake and the real adapter are held together by one shared contract suite,
`tests/storage/FileSystemContract.ts`. It has caught five divergences so far.
It cannot catch everything: the fake holds JavaScript strings and cannot
represent an invalid byte sequence at all, so threat 19's decoding is proved
against the real adapter while the store's *classification* of `EILSEQ` is
proved through the fake's forced failures.
