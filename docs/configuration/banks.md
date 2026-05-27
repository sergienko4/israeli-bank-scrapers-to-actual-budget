# Bank Options

Each entry under `banks` in `config.json` is keyed by a [bank's config key](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) (e.g. `discount`, `hapoalim`, `oneZero`). The value is an object with credentials, date-range, targets, and optional tuning.

## Credentials

Every bank has its own login fields — see [the per-bank pages](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) for the exact list.

Common keys: `id`, `username`, `password`, `num`, `card6Digits`, `userCode`, `email`, `phoneNumber`.

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
| `navigationRetryCount` | `0` | Retries on page-load failure (set `1`–`3` for flaky connections) |
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
| `otpLongTermToken` | — | Persistent token to skip OTP on future runs (oneZero only) |

For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Global options

These live at the **top level** of `config.json`, not per bank:

| Option | Default | Description |
|--------|---------|-------------|
| `delayBetweenBanks` | `0` | Milliseconds to wait between bank imports — see [Rate limiting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/rate-limiting.md) |
