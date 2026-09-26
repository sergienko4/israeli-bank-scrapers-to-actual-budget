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
| `otpLongTermToken` | — | Optional (OneZero, Pepper and PayBox). The importer saves and reuses the long-term token by itself; set this only to bring one from another install. See [Long-term token](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md#long-term-token) |

For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

### Long-term token

OneZero, Pepper and PayBox return a long-term token after an SMS login. The
importer saves it and sends it on later logins, so they skip the SMS. You do
not need to set anything.

- **Where it is saved:** `bank-tokens.json` on the data volume (`/app/data`,
  or the absolute path in `BANK_TOKENS_PATH`). The volume must be writable.
  Only the importer's user can read the file.
- **Which token a login sends:** the token saved for this `banks` entry. If
  none is saved yet, the entry's `otpLongTermToken`. Otherwise none, and the
  bank asks for an SMS; the token from that login is saved and used from then
  on.
- **Each token belongs to one login.** The importer records which login
  created each token: the email for OneZero, the phone number for Pepper and
  PayBox. A Pepper or PayBox token logs in by itself, so sending it for
  another login would import another account. A token is never sent for a
  login other than its own:
  - after you change an entry's email or phone number, the next run logs in
    with one SMS and saves a token for the new login;
  - an `otpLongTermToken` that the file saved for another login is not sent.
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
- **With a config password** (`CREDENTIALS_ENCRYPTION_PASSWORD`), each token
  the importer saves is sealed under it, so a copy of the file gives no token
  away. Turning the password on or off, or changing it, makes the saved tokens
  unreadable: each account logs in with one SMS, then uses its new token. An
  encrypted config needs its own password first, or the run stops at startup.
  When you turn it on, delete `bank-tokens.json`: its plain-text tokens can no
  longer be used, and the importer sets the file aside, as
  `bank-tokens.json.quarantined-*`, only when it next saves a token. See
  [Encrypted config](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/encrypted-config.md).
- **How long a token lasts:** upstream measured one OneZero token valid for
  ten years. That is one observation, not a promise, and Pepper and PayBox
  publish none. The bank can refuse a token at any time.
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
| `Using the configured long-term token for <key>` | `otpLongTermToken` was sent, because nothing is saved for the entry yet. |
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

The [token store design](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/bank-token-store.md)
covers the file layout and its protections.

## Global options

These live at the **top level** of `config.json`, not per bank:

| Option | Default | Description |
|--------|---------|-------------|
| `delayBetweenBanks` | `0` | Milliseconds to wait between bank imports — see [Rate limiting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/rate-limiting.md) |
