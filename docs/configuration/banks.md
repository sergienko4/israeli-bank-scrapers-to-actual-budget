# Bank Options

Each entry under `banks` in `config.json` is keyed by a [bank's config key](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) (e.g. `discount`, `hapoalim`, `oneZero`). The value is an object with credentials, date-range, targets, and optional tuning.

## Credentials

Every bank has its own login fields — see [the per-bank pages](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) for the exact list.

Common keys: `id`, `username`, `password`, `num`, `card6Digits`, `userCode`, `email`, `phoneNumber`.

Phone-based providers require an Israeli number. The importer accepts canonical
`972XXXXXXXXX`, `+972`-prefixed, dashed, spaced, and local `0XXXXXXXXX` forms,
then normalises the value before login. Other country codes fail configuration
validation without being written to logs.

## Date range — pick one

Choose **either** `daysBack` (relative) or `startDate` (absolute). You cannot use both on the same bank.

```json
"daysBack": 14
```

Recalculated on each run. Range: `1`–`30`.

```json
"startDate": "2026-02-01"
```

Fixed `YYYY-MM-DD`. Maximum one year back.

Some API-direct scrapers can verify whether they reached the requested start
date. If a provider reports an incomplete or unproven window, the importer logs
one aggregate warning for that bank and still imports the available
transactions. The warning contains coverage-state counts only, never account
numbers or transaction data.

## Targets — map bank accounts to Actual Budget accounts

`targets` is **required**.

```json
"targets": [
  {
    "actualAccountId": "uuid-from-actual",
    "accountName": "Savings",
    "reconcile": true,
    "accounts": "all"
  }
]
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `actualAccountId` | Yes | — | UUID copied from the Actual Budget account URL |
| `accountName` | No | bank account number | Friendly label used in logs and Telegram |
| `reconcile` | No | `false` | `true` = auto-create reconciliation transaction to match bank balance |
| `accounts` | No | `"all"` | `"all"` or array of bank account numbers, e.g. `["8538", "7697"]` |

**Tip:** run with `"accounts": "all"` first, check the logs to see which account numbers your bank exposes, then configure specific accounts.

## Multiple cards into separate Actual accounts

```json
"visaCal": {
  "username": "myusername",
  "password": "mypassword",
  "daysBack": 14,
  "targets": [
    { "actualAccountId": "card-1-uuid", "reconcile": true, "accounts": ["8538"] },
    { "actualAccountId": "card-2-uuid", "reconcile": true, "accounts": ["7697"] }
  ]
}
```

## Scraper tuning

Pass through to the scraper library for banks that timeout on slow connections:

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `30000` | Navigation timeout in ms — increase to `60000` for slow networks (Oracle Cloud) |
| `navigationRetryCount` | — | **Ignored since scrapers 8.7.0.** Still accepted so existing configs keep loading, but no longer offered in the web portal. Scrape retries are handled by the importer itself (`maxRetryAttempts`, default `3`), for browser banks without `twoFactorAuth`. A bank with `twoFactorAuth`, and OneZero, Pepper and PayBox always, get a single try. |
| `clearSession` | `false` | Force-clear browser session before scraping |

## 2FA / OTP

Any bank that shows an SMS verification screen supports `twoFactorAuth`. The Telegram bot prompts for the OTP code.

```json
"beinleumi": {
  "username": "...",
  "password": "...",
  "twoFactorAuth": true,
  "twoFactorTimeout": 300,
  "targets": [...]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `twoFactorAuth` | `false` | Enable 2FA flow for this bank |
| `twoFactorTimeout` | `300` | Seconds to wait for OTP reply before failing |
| `otpLongTermToken` | — | Optional (OneZero and PayBox; Pepper ignores it and warns, see [Pepper](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/pepper.md#2fa--otp)). The importer saves and reuses the long-term token by itself; set this only to bring one from another install. See [Long-term token](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md#long-term-token) |

For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

### Long-term token

OneZero and PayBox return a long-term token after an SMS login. The
importer saves it and sends it on later logins, so they skip the SMS. You do
not need to set anything.

Pepper keeps its login another way: one SMS enrolls the importer as a device,
and the importer saves that device's state in the same file, under
`pepper-device:<entry name>`. It never sends Pepper a long-term token. See
[Pepper](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/pepper.md#2fa--otp).

- **Where it is saved:** `bank-tokens.json` on the data volume (`/app/data`,
  or the absolute path in `BANK_TOKENS_PATH`). The volume must be writable.
  Only the importer's user can read the file.
- **Which token a login sends:** the token saved for this `banks` entry. If
  none is saved yet, or the saved one was retired, the entry's
  `otpLongTermToken`. Otherwise none, and the bank asks for an SMS; the token
  from that login is saved and used from then on. While
  `bank-tokens.refused.json` can be read, a retired token is not sent, by
  this entry or any other.
- **Each token belongs to one login.** The importer records which login
  created each token: the email for OneZero, the phone number for PayBox. A
  PayBox token logs in by itself, so sending it for another login would
  import another account. A token is never sent for a
  login other than its own:
  - after you change an entry's email or phone number, the next run logs in
    with one SMS and saves a token for the new login;
  - an `otpLongTermToken` that the file saved for another login is not sent;
  - an `otpLongTermToken` that any entry retired is not sent. Retiring a saved
    token removes its record, so the retired list is what still stops another
    entry from sending it.
- **Renaming a `banks` entry** also costs one SMS. Tokens are saved per entry,
  under `<bank id>:<entry name>`, such as `onezero:oneZero`.
- **Keep `twoFactorAuth: true`.** Each SMS login creates a new token, and the
  bank stops accepting the one before it. When the bank refuses a token, the
  importer logs in with an SMS and saves the new one. With `twoFactorAuth:
  false` it cannot ask for a code: a run with no usable token, or whose token
  the bank refuses, fails with `TWO_FACTOR_RETRIEVER_MISSING` and logs how to
  fix it.
- **If the file is damaged or cannot be read**, the configured
  `otpLongTermToken` is not sent, because the file cannot say whose it is.
  Tokens the importer can still read from a damaged file keep working;
  otherwise the run warns and logs in with an SMS. A damaged file is set aside
  before the next token is saved.
- **A token that ends a run with the one-SMS-login error is retired.** When a
  run sends a token and fails with `already spent its one cold SMS login`, the
  bank library has hidden the real reason, and the same token may fail the
  same way on every run. So the importer records the token as not accepted,
  removes it from `bank-tokens.json` if it was the saved one, and skips it
  from then on. The next run may still send `otpLongTermToken`, if it holds a
  different token that passes the checks above; otherwise it logs in with
  one SMS, or shows the real error. A token that was still valid can be
  retired too, which may cost one SMS login. See
  [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md#the-scraper-hid-the-real-reason-behind-its-one-sms-login-limit).
  - The record is `bank-tokens.refused.json`, beside the token file. It holds
    a one-way digest of each retired token, never the token, and keeps the
    last 8 per entry.
  - Deleting it lets retired tokens be sent again, by any entry. A run that
    cannot read it in full warns, and does not send an `otpLongTermToken`
    that `bank-tokens.json` has not saved for the entry's login; a saved token
    may still be sent again. Back it up and restore it together with
    `bank-tokens.json`.
- **With a config password** (`CREDENTIALS_ENCRYPTION_PASSWORD`, or the
  legacy `CONFIG_PASSWORD`), each token the importer saves is sealed under it,
  so a copy of the file gives no token away. Turning the password on or off,
  or changing it, makes the saved tokens unreadable: each account logs in with
  one SMS, then uses its new token. An encrypted config needs its own password
  first, or the run stops at startup.
  When you turn it on, delete `bank-tokens.json`: its plain-text tokens can no
  longer be used, and the importer sets the file aside, as
  `bank-tokens.json.quarantined-*`, only when it next saves a token. See
  [Encrypted config](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/encrypted-config.md).
- **How long a token lasts:** upstream measured one OneZero token valid for
  ten years. That is one observation, not a promise, and PayBox publishes
  none. The bank can refuse a token at any time.
- **Setting `otpLongTermToken` by hand** is only for bringing a token from
  another install. Until the importer has saved a token, it cannot tell whose
  it is, so it trusts a configured token to belong to the entry's own login.
  Paste only a token that the same login created.
- The logs never show the token: log lines and alerts mask it. The file holds
  live login tokens, in plain text unless a config password is set. Do not
  paste its contents into issues or chats.

To see what a run did with the token, look for these log lines (`<key>` is
the `<bank id>:<entry name>` above):

| Log line | Meaning |
|---|---|
| `Using the stored long-term token for <key>` | The saved token was sent. |
| `Using the configured long-term token for <key>` | `otpLongTermToken` was sent, because nothing is saved for the entry yet, or the saved token was retired. |
| `Stored the long-term token for <key>` | A new token was saved. |
| `The stored long-term token for <key> belongs to another login` | The email or phone number changed; the run logs in with one SMS. |
| `The configured long-term token for <key> belongs to another login` | `otpLongTermToken` was not sent. |
| `The long-term token for <key> was not accepted, so this run logs in with an SMS code` | The token was sent and refused, most often because a newer SMS login replaced it. The run logs in with one SMS and saves the new token. |
| `The long-term token for <key> was not accepted, and this run cannot ask for an SMS code` | As above, but `twoFactorAuth` is off, so the run fails. Turn it on for one SMS login. |
| `The token file is damaged, so the configured long-term token for <key> is not sent` | Nothing usable is saved for the entry, and the damaged file cannot say whose `otpLongTermToken` is, so it was not sent. A saved token the importer can still read from a damaged file is sent as usual, without this warning. A config password turned on, off or changed reads as damage too, once. |
| `The token file is damaged and holds no usable long-term token for <key>` | No `otpLongTermToken` is configured and nothing usable is saved for the entry, so no token was sent and the run logs in with an SMS. A config password turned on, off or changed reads as damage too, once. |
| `Could not read the long-term token for <key>` | The file could not be read, so no token was sent; the warning names the cause. |
| `No usable long-term token for <key>, and this run cannot ask for an SMS code` | Turn on `twoFactorAuth` for one SMS login, or restore the token file. |
| `Could not store the long-term token for <key>` | The next run needs an SMS; check that `/app/data` is writable. |
| `The stored long-term token for <key> was not accepted; it is retired, so the next run logs in without it` | The run failed with `already spent its one cold SMS login` after sending the saved token. The token was recorded as retired, and its saved copy removed unless a warning before this one says otherwise; later runs skip it. The next run may still send `otpLongTermToken`, if it holds a different usable token; otherwise it asks for one SMS code, or shows the real error. |
| `The configured long-term token for <key> was not accepted; it is retired, so the next run logs in without it` | As above, for `otpLongTermToken`. Later runs skip it, so remove or replace it. |
| `The <stored or configured> long-term token for <key> was not accepted and could not be retired, so the next run may repeat this — remove otpLongTermToken` | The run could not record the token as retired; a warning before it names the cause. Check that `/app/data` is writable, and remove `otpLongTermToken`. |
| `Could not record the refused long-term token for <key>` / `Could not remove the long-term token for <key>` | A step of retiring a token failed; the warning names the cause. The `was not accepted` warning that follows says whether the token is retired. A token that is retired but could not be removed stays in the file and is skipped. |
| `The stored long-term token for <key> was not accepted before, so it is not sent` | The saved token was retired earlier, but it is still in the file, for example after `bank-tokens.json` was restored from a backup. The run tries `otpLongTermToken` instead, or logs in with an SMS. |
| `The configured long-term token for <key> was not accepted before, so it is not sent — remove or replace otpLongTermToken` | `otpLongTermToken` was retired earlier. The run logs in with an SMS and saves a new token, which later runs send instead. |
| `Could not read which long-term tokens for <key> were not accepted before, so none is skipped` | `bank-tokens.refused.json` could not be read, so a retired token saved for this login may be sent again; the warning names the cause. An `otpLongTermToken` not saved for this login is not sent. |
| `The list of long-term tokens that were not accepted is damaged, so only the ones it still holds are skipped` | `bank-tokens.refused.json` is damaged. It is set aside the next time a token is retired. An `otpLongTermToken` not saved for this login is not sent. |
| `The configured long-term token for <key> is not saved for this login, and the list of tokens that were not accepted could not be fully read, so it is not sent` | Follows one of the two lines above. `otpLongTermToken` may be a token another entry retired, and only that list could tell, so the run logs in with an SMS and saves a token for this login. |
| `Removed <n> abandoned staged files beside the token store` / `… beside the refused-token store` | A run was stopped, or could not clean up, while saving `bank-tokens.json` or `bank-tokens.refused.json`, and left a staged copy. Each run deletes those over an hour old. |
| `Could not sweep staged token files` / `Could not sweep staged refused-token files` | The folder holding that file could not be listed, so its staged copies were not checked; the warning names the cause. The run goes on. Check that `/app/data` is readable and writable. |

The [token store design](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/bank-token-store.md)
covers the file layout and its protections.

## Global options

These live at the **top level** of `config.json`, not per bank:

| Option | Default | Description |
|--------|---------|-------------|
| `delayBetweenBanks` | `0` | Milliseconds to wait between bank imports — see [Rate limiting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/rate-limiting.md) |
