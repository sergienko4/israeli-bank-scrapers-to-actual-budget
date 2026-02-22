# Israeli Bank Scrapers to Actual Budget

[![PR Validation](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/pr-validation.yml/badge.svg)](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/pr-validation.yml) [![Release](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/release.yml/badge.svg)](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/release.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Docker Pulls](https://img.shields.io/docker/pulls/sergienko4/israeli-bank-importer)](https://hub.docker.com/r/sergienko4/israeli-bank-importer) [![Node.js](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/) [![Tests](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/sergienko4/2860e2ffec3d5919e4b658fed5ce4e5e/raw/actual-budget-importer-test-count.json)](#testing)

**Automatically import transactions from 18 Israeli banks and credit cards into [Actual Budget](https://actualbudget.org/).**

Powered by [**israeli-bank-scrapers**](https://github.com/eshaham/israeli-bank-scrapers) by eshaham.

---

## What Does This Do?

```text
Your Bank → israeli-bank-scrapers → This Tool → Actual Budget
```

1. You provide bank credentials in a config file
2. israeli-bank-scrapers logs into your bank and fetches transactions
3. This tool imports them into Actual Budget
4. All your transactions appear automatically

**No manual CSV downloads. Everything automated.**

---

## Quick Start

### 1. Install Docker

- **Windows/Mac**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**: `sudo apt install docker.io docker-compose`

### 2. Create config.json

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
cp config.json.example config.json
```

Edit `config.json` with your credentials. Here is a full example showing all available options:

```json
{
  "actual": {
    "init": {
      "serverURL": "http://localhost:5006",
      "password": "your_actual_password",
      "dataDir": "./data"
    },
    "budget": {
      "syncId": "your_sync_id_uuid",
      "password": null
    }
  },

  "delayBetweenBanks": 5000,

  "banks": {
    "discount": {
      "id": "123456789",
      "password": "bank_password",
      "num": "ABC123",
      "daysBack": 14,
      "targets": [{
        "actualAccountId": "uuid-from-actual",
        "reconcile": true,
        "accounts": "all"
      }]
    },
    "oneZero": {
      "email": "your@email.com",
      "password": "your_password",
      "phoneNumber": "+972501234567",
      "twoFactorAuth": true,
      "twoFactorTimeout": 300,
      "otpLongTermToken": "",
      "daysBack": 14,
      "targets": [{ "actualAccountId": "uuid", "reconcile": false, "accounts": "all" }]
    }
  },

  "logConfig": {
    "format": "words",
    "maxBufferSize": 150
  },

  "categorization": {
    "mode": "none"
  },

  "notifications": {
    "enabled": true,
    "maxTransactions": 5,
    "telegram": {
      "botToken": "123456789:ABCDefGHijKlMnOpQrStUvWxYz",
      "chatId": "-1001234567890",
      "messageFormat": "compact",
      "showTransactions": "new",
      "listenForCommands": true
    },
    "webhook": {
      "url": "https://hooks.slack.com/services/T.../B.../...",
      "format": "slack"
    }
  }
}
```

**Where to find values:**

| Value | How to Find |
|-------|-------------|
| `serverURL` | Your Actual Budget server URL |
| `password` | Your Actual Budget server password |
| `syncId` | Settings → Show Advanced Settings → Sync ID |
| `actualAccountId` | Click account in Actual Budget → copy ID from URL |
| Bank credentials | Same as you use on bank website |

### 3. Run with Docker

**Option A: Docker Compose (recommended)**

```bash
docker compose up -d          # Start in background
docker compose logs -f        # View logs
docker compose pull && docker compose up -d   # Update
docker compose down           # Stop
```

**Option B: Pre-built image**

```bash
docker pull sergienko4/israeli-bank-importer

docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  sergienko4/israeli-bank-importer
```

**Option C: Build from source**

```bash
docker build -t israeli-bank-importer:latest .

docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  israeli-bank-importer:latest
```

**Windows users:** Replace `$(pwd)` with full path: `-v "C:\path\to\config.json:/app/config.json"`

See [Releases](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases) for all available versions.

---

## Supported Institutions

| Institution | Config key | Login fields |
|-------------|-----------|-------------|
| Bank Hapoalim | `hapoalim` | userCode, password |
| Bank Leumi | `leumi` | username, password |
| Discount Bank | `discount` | id, password, num |
| Mizrahi Tefahot | `mizrahi` | username, password |
| Mercantile | `mercantile` | id, password, num |
| Otsar Hahayal | `otsarHahayal` | username, password |
| Union | `union` | username, password |
| Beinleumi | `beinleumi` | username, password |
| Massad | `massad` | username, password |
| Yahav | `yahav` | username, nationalID, password |
| Beyahad Bishvilha | `beyahadBishvilha` | id, password |
| Behatsdaa | `behatsdaa` | id, password |
| Pagi | `pagi` | username, password |
| One Zero | `oneZero` | email, password, phoneNumber |
| Visa Cal | `visaCal` | username, password |
| Max | `max` | username, password |
| Isracard | `isracard` | id, card6Digits, password |
| Amex | `amex` | id, card6Digits, password |

Use the **Config key** as the bank name in your `config.json`. See [BANKS.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md) for per-institution config examples.

---

## Configuration Reference

### Actual Budget Connection

```json
"actual": {
  "init": {
    "serverURL": "http://localhost:5006",
    "password": "your_server_password",
    "dataDir": "./data"
  },
  "budget": {
    "syncId": "uuid-from-settings",
    "password": null
  }
}
```

### Bank Options (per bank)

**Date range** — choose one:

```json
"daysBack": 14
```

Import last 14 days. Recalculated on every run. Range: 1-30.

```json
"startDate": "2026-02-01"
```

Fixed date. Max: 1 year back. Cannot use both on the same bank.

**Targets** — map bank accounts to Actual Budget accounts:

```json
"targets": [
  {
    "actualAccountId": "uuid-from-actual",
    "reconcile": true,
    "accounts": "all"
  }
]
```

- `actualAccountId` — UUID from Actual Budget (click account → copy ID from URL)
- `reconcile` — `true` or `false` (default). Auto-adjust balance to match bank
- `accounts` — `"all"` or array of specific account numbers: `["8538", "7697"]`

**Tip:** Run with `"accounts": "all"` first, check logs to see card/account numbers, then configure specific accounts.

**Multiple cards → separate Actual accounts:**

```json
"visaCal": {
  "username": "myusername",
  "password": "mypassword",
  "targets": [
    { "actualAccountId": "card-1-uuid", "reconcile": true, "accounts": ["8538"] },
    { "actualAccountId": "card-2-uuid", "reconcile": true, "accounts": ["7697"] }
  ]
}
```

### 2FA (OneZero)

OneZero requires SMS verification. The Telegram bot asks for the OTP code:

```json
"oneZero": {
  "email": "...",
  "password": "...",
  "phoneNumber": "+972...",
  "twoFactorAuth": true,
  "twoFactorTimeout": 300,
  "targets": [...]
}
```

Flow: login → SMS sent → bot asks "Enter OTP code" → you reply → import completes.

After first login, add `"otpLongTermToken": "..."` to skip OTP on future runs.

### Scheduling

Set via environment variables in `docker-compose.yml` or `docker run -e`:

| Schedule | Expression | When |
|----------|-----------|------|
| Every 8 hours | `SCHEDULE=0 */8 * * *` | Midnight, 8am, 4pm |
| Daily at 2am | `SCHEDULE=0 2 * * *` | Once per day |
| Twice daily | `SCHEDULE=0 6,18 * * *` | 6am and 6pm |
| Run once | _(don't set SCHEDULE)_ | No schedule, exit after run |

Set timezone: `TZ=Asia/Jerusalem`

### Logging

Configure log output format via `logConfig` in config.json:

```json
"logConfig": {
  "format": "words",
  "maxBufferSize": 150
}
```

| Format | Output | Best for |
|--------|--------|----------|
| `words` | Emoji-rich console output (default) | Development, human reading |
| `json` | Structured JSON, one object per line | Docker log aggregators (Loki, ELK) |
| `table` | `[HH:MM:SS] LEVEL message` | Timestamped production logs |
| `phone` | `> compact message` (no emojis) | Mobile viewing, minimal output |

`maxBufferSize` controls the ring buffer for the `/logs` bot command (default: 150, max: 500).

### Auto-Categorization

Automatically categorize imported transactions. Three modes are available:

```json
"categorization": {
  "mode": "none"
}
```

| Mode | Description |
|------|-------------|
| `none` | Default. No auto-categorization — Actual Budget's own rules handle everything |
| `history` | Finds the most recent transaction (by date) across all accounts with the same payee that has a category, and applies it |
| `translate` | Renames Hebrew payees to English using translation rules, so Actual Budget's English rules can match |

**Mode: history** — learns from your past categorizations:

```json
"categorization": {
  "mode": "history"
}
```

New transaction arrives with payee "שופרסל דיזנגוף". The tool queries all accounts for the most recent transaction where the payee contains "שופרסל" and has a category. If found (e.g., "Groceries"), it sets the same category. No match leaves the transaction uncategorized.

**Mode: translate** — maps Hebrew payees to English names:

```json
"categorization": {
  "mode": "translate",
  "translations": [
    { "fromPayee": "סופר",   "toPayee": "Supermarket" },
    { "fromPayee": "שופרסל", "toPayee": "Shufersal" },
    { "fromPayee": "דלק",    "toPayee": "Gas Station" }
  ]
}
```

Transaction with payee "סופר כל הטעמים" matches "סופר" and is imported as "Supermarket". The original Hebrew name is preserved in `imported_payee`. Longest match wins — "שופרסל" matches before "סופר".

**Important:** Actual Budget's rules always run after import. Our category is a first-pass suggestion; Actual's rules are the final word. They work together — no conflict.

### Spending Watch

Monitor spending patterns and get alerts when thresholds are exceeded. Define an array of rules — each watches a time window for spending over a limit.

```json
"spendingWatch": [
  { "alertFromAmount": 500, "numOfDayToCount": 1 },
  { "alertFromAmount": 3000, "numOfDayToCount": 7, "watchPayees": ["שופרסל", "רמי לוי"] },
  { "alertFromAmount": 10000, "numOfDayToCount": 30, "watchPayees": ["rent", "שכירות"] }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| `alertFromAmount` | Yes | Alert if total spending exceeds this amount (in currency units, e.g., ILS) |
| `numOfDayToCount` | Yes | Time window in days to sum transactions (1 = today only, 7 = week, 30 = month) |
| `watchPayees` | No | Only count transactions matching these payees (substring match, case-insensitive). Missing or empty = count ALL payees |

**How it works:**

1. After each bank import, the tool queries Actual Budget for all debit transactions in the time window
2. If `watchPayees` is set, only transactions matching those names are counted (substring match — `"שופרסל"` matches `"שופרסל דיזנגוף סניף 123"`)
3. If `watchPayees` is missing or empty, ALL debits are counted
4. Amounts are summed and compared to `alertFromAmount`
5. Triggered rules are combined into one message and sent to all configured channels (Telegram + webhook)

**Example rules explained:**

| Rule | What it does |
|------|-------------|
| `500 / 1 day / no filter` | "Alert if I spend more than 500 ILS today" |
| `3000 / 7 days / שופרסל, רמי לוי` | "Alert if grocery spending exceeds 3,000 ILS this week" |
| `10000 / 30 days / rent, שכירות` | "Alert if rent payments exceed 10,000 ILS this month" |

**Alert output (sent to Telegram):**

```text
🔔 Spending Watch

⚠️ All payees: 1,250.00 in 1 day (limit: 500)
  -507.08  AliExpress
  -398.21  AliExpress
  -263.90  Netflix
  ... and 2 more

⚠️ שופרסל, רמי לוי: 3,420.00 in 7 days (limit: 3,000)
  -1,200.00  שופרסל דיזנגוף
  -890.00  רמי לוי תל אביב
  -1,330.00  שופרסל דיל
```

**No `spendingWatch` config = no alerts** (fully backward compatible).

Spending watch runs **automatically after each import**. The `/watch` Telegram command shows info — on-demand checking is planned for a future release.

### Split Config (Optional)

Separate secrets from settings using two files:

- **`credentials.json`** — passwords, tokens, bank IDs (encrypt this)
- **`config.json`** — settings like daysBack, targets, formats (safe to share)

See `credentials.json.example` for the template. If `credentials.json` exists, it deep-merges with `config.json`.

Single `config.json` with everything still works (backward compatible).

### Encrypted Config

Protect credentials by encrypting any config file:

```bash
npm run build
CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/encrypt-config.js
# Or encrypt just credentials: CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/encrypt-config.js credentials.json
```

```yaml
# docker-compose.yml
environment:
  - CREDENTIALS_ENCRYPTION_PASSWORD=mypassword
```

The app auto-detects encrypted files and decrypts in memory. Supports old `CONFIG_PASSWORD` env var too.

To edit: `CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/decrypt-config.js`, edit, re-encrypt.

### Rate Limiting

Prevent bank API throttling by adding a delay between bank imports:

```json
"delayBetweenBanks": 5000
```

Waits 5 seconds between each bank. Default: 0 (no delay). Set at the top level of `config.json`, not per-bank.

---

## Notifications

### Telegram

Get import summaries and error alerts via Telegram after each run.

**Step 1: Create a Telegram Bot (2 minutes)**

1. Open Telegram → search for **@BotFather** → start a chat
2. Send: `/newbot`
3. Choose a name and username (must end in `bot`)
4. Copy the **bot token**: `123456789:ABCDefGHijKlMnOpQrStUvWxYz`

**Step 2: Get Your Chat ID (1 minute)**

- **Personal:** Search for **@userinfobot** → it replies with your chat ID
- **Group:** Add bot to group → open `https://api.telegram.org/bot<TOKEN>/getUpdates` → find `"chat":{"id":-100...}`

**Step 3: Add to config.json**

```json
"notifications": {
  "enabled": true,
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID",
    "messageFormat": "compact",
    "showTransactions": "new",
    "listenForCommands": true
  }
}
```

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `maxTransactions` | `1`-`25` | `5` | Max transactions per account (set at `notifications` level) |
| `messageFormat` | `summary`, `compact`, `ledger`, `emoji` | `summary` | Notification style |
| `showTransactions` | `new`, `all`, `none` | `new` | Transaction detail level |
| `listenForCommands` | `true`, `false` | `false` | Enable bot commands |

#### Message Formats

<details><summary><b>summary</b> (default) - Banks overview only</summary>

```text
✅ Import Summary

🏦 Banks: 3/3 (100%)
📥 Transactions: 47 imported
🔄 Duplicates: 12 skipped
⏱ Duration: 38.2s

✅ discount: 18 txns 12.3s
✅ leumi: 22 txns 15.1s
✅ hapoalim: 7 txns 10.8s
```

</details>

<details><summary><b>compact</b> - Transaction details with amounts</summary>

```text
✅ Import Summary
3/3 banks | 47 txns | 38.2s

✅ Discount · 0152228812
14/02  משכורת חודשית
       +12,500.00
14/02  שופרסל דיזנגוף
       -342.50
14/02  חברת חשמל
       -289.00
💰 45,230.50 ILS
✅ Balance matched
```

</details>

<details><summary><b>ledger</b> - Monospace table layout</summary>

```text
✅ Import Summary
47 transactions · 38.2s

✅ Discount (0152228812)
14/02 משכורת חודשית
        +12,500.00
14/02 שופרסל דיזנגוף
           -342.50
14/02 חברת חשמל
           -289.00
Balance: 45,230.50 ILS
✅ Balance matched
```

</details>

<details><summary><b>emoji</b> - Visual deposit/payment indicators</summary>

```text
✅ Import Summary

📊 3/3 banks · 47 txns · 38.2s

💳 Discount
  📥 +12,500.00  משכורת חודשית
  📤 -342.50  שופרסל דיזנגוף
  📤 -289.00  חברת חשמל
  💰 45,230.50 ILS
  ✅ Balance matched
```

</details>

**On failure:**

```text
🚨 Import Failed

🔐 Authentication Error (discount): Invalid credentials. Please verify your password.
```

#### Bot Commands

When `listenForCommands` is `true`, control the importer from Telegram:

| Command | Action |
|---------|--------|
| `/scan` | Run bank import now |
| `/status` | Show last run info (from audit log) |
| `/watch` | Check spending watch rules now |
| `/logs` | Show recent log entries (default: 50) |
| `/logs N` | Show last N entries (max 150) |
| `/help` | List commands |

The bot listens alongside the cron scheduler. If an import is already running, it waits instead of starting a duplicate.

### Webhooks (Slack, Discord, Generic)

Send import summaries to any webhook URL:

```json
"notifications": {
  "enabled": true,
  "webhook": {
    "url": "https://hooks.slack.com/services/T.../B.../...",
    "format": "slack"
  }
}
```

| Format | Target | Payload |
|--------|--------|---------|
| `slack` | Slack Incoming Webhook | `{ "text": "✅ *Import Summary*..." }` |
| `discord` | Discord Webhook | `{ "content": "✅ **Import Summary**..." }` |
| `plain` | Any HTTP endpoint | `{ "event": "import_complete", "totalTransactions": 5, ... }` |

Can be used alongside Telegram — both channels fire independently.

**Disable notifications:** Set `"enabled": false` or remove the `notifications` section.

---

## Reconciliation

When `"reconcile": true`, the tool automatically reconciles your Actual Budget balance with the bank balance.

**How it works:**

- **Idempotent** - Creates only ONE reconciliation transaction per day per account
- **Smart detection** - Skips if already balanced
- **Duplicate prevention** - Running multiple times won't create duplicates
- **Automatic adjustment** - Creates adjustment transaction if balances differ

**Status messages:**

```text
✅ Already balanced             - No adjustment needed
✅ Reconciled: +123.45 ILS      - Created adjustment transaction
✅ Already reconciled today     - Duplicate prevented (already exists)
```

**When to use:**

- `false` (default) - You review and reconcile manually in Actual Budget
- `true` - Auto-adjust balance to match bank (for trusted accounts)

**Note:** Credit card balances are negative (this is normal!)

---

## Metrics & Monitoring

After each import run, you'll see a comprehensive summary:

```text
============================================================
📊 Import Summary

  Total banks: 3
  Successful: 3 (100.0%)
  Failed: 0 (0.0%)
  Total transactions: 45
  Duplicates prevented: 12
  Total duration: 38.2s
  Average per bank: 12.7s

🏦 Bank Performance:

  ✅ discount: 12.3s (18 txns, 5 duplicates)
     ✅ Reconciliation: balanced
  ✅ leumi: 15.1s (22 txns, 7 duplicates)
     🔄 Reconciliation: +123.45 ILS
  ✅ hapoalim: 10.8s (5 txns, 0 duplicates)
     ✅ Reconciliation: already reconciled
============================================================
```

Import history is persisted at `/app/data/audit-log.json` (last 90 entries). View with `/status` bot command.

---

## Troubleshooting

### "out-of-sync-migrations"

- **Cause:** Version mismatch
- **Fix:** Ensure Actual Budget server is v26.2.0+

### "Failed to launch browser"

- **Cause:** Missing `SYS_ADMIN`
- **Fix:** Add `--cap-add SYS_ADMIN` to docker run or `cap_add: [SYS_ADMIN]` to docker-compose

### 2FA Required Every Time

- **Cause:** Browser session not saved
- **Fix:** Mount chrome-data volume: `-v ./chrome-data:/app/chrome-data`

### Windows Volume Mount Error

**PowerShell:**

```powershell
docker run --rm `
  -v "${PWD}/config.json:/app/config.json" `
  ...
```

**CMD:**

```cmd
docker run --rm ^
  -v "%CD%/config.json:/app/config.json" ^
  ...
```

### Too Many Transactions

- **Fix:** Add `"daysBack": 14` or `"startDate": "2026-01-19"` to limit range

---

## Documentation

| File | Description |
|------|-------------|
| [BANKS.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md) | Per-institution config examples |
| [DEPLOYMENT.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/DEPLOYMENT.md) | VM deployment, Docker Compose details |
| [SECURITY.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/SECURITY.md) | Security best practices |
| [CHANGELOG.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/CHANGELOG.md) | Version history and release notes |
| [config.json.example](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/config.json.example) | Full example configuration |
| [GUIDELINES.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/GUIDELINES.md) | Development guidelines for contributors |
| [CONTRIBUTING.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CONTRIBUTING.md) | How to contribute |
| [CODE_OF_CONDUCT.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/CODE_OF_CONDUCT.md) | Community standards |

---

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) | 6.7.1 | Bank scraping |
| [@actual-app/api](https://github.com/actualbudget/actual) | 26.2.0 | Actual Budget integration |
| Node.js | 22 | Runtime |
| Chromium | Latest | Browser automation |
| Docker | - | Containerization |
| [Vitest](https://vitest.dev/) | 4.x | Unit testing |

---

## Testing

```bash
npm test              # Run all tests
npm run test:coverage # With coverage report
npm run test:watch    # Watch mode
npm run validate      # Build + test (validate before committing)
```

Comprehensive test suite with 80%+ line coverage and 70%+ branch coverage. Run `npm test` to see current count.

### E2E Tests

End-to-end tests build the Docker image and run the full import pipeline with mock bank data.

**One-time setup (Telegram bot):**
```bash
cp .env.e2e.example .env.e2e
# Edit .env.e2e with your test bot token and chat ID
# (Create via Telegram @BotFather → /newbot)
```

**Run E2E tests:**
```bash
# 1. Create test budget + prepare mock data
npm run test:e2e:setup
mkdir -p tests/e2e/fixtures/mock-scraper-dir
cp tests/e2e/fixtures/mock-scraper-result.json tests/e2e/fixtures/mock-scraper-dir/e2eTestBank.json
cp tests/e2e/fixtures/mock-scraper-result-bank2.json tests/e2e/fixtures/mock-scraper-dir/e2eTestBank2.json

# 2. Build Docker image and run import (get BUDGET_ID from setup output)
docker build -t israeli-bank-importer:e2e .
docker run --rm \
  -v ./tests/e2e/fixtures/config.generated.json:/app/config.json:ro \
  -v ./tests/e2e/fixtures/mock-scraper-dir:/app/mock-scraper-dir:ro \
  -v ./tests/e2e/fixtures/e2e-data:/app/data \
  -e E2E_MOCK_SCRAPER_DIR=/app/mock-scraper-dir \
  -e E2E_LOCAL_BUDGET_ID=<budget-id> \
  israeli-bank-importer:e2e node dist/index.js

# 3. Verify results (loads .env.e2e automatically)
npm run test:e2e
```

E2E tests run automatically on PRs that change `src/` or `Dockerfile` (see `.github/workflows/e2e.yml`). Telegram tests require `E2E_TELEGRAM_BOT_TOKEN` and `E2E_TELEGRAM_CHAT_ID` secrets in the repo.

---

## Security

- Keep `config.json` private (in `.gitignore`)
- Use `chmod 600 config.json`
- Mount config as read-only: `:ro`
- Never commit credentials to git

**Why SYS_ADMIN?** Required for Chromium sandboxing. Safe when running trusted code.

See [SECURITY.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/SECURITY.md) for full security policy.

---

## Credits

- **[israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)** by [@eshaham](https://github.com/eshaham) — the core library that makes this possible
- **[Actual Budget](https://github.com/actualbudget/actual)** — open-source budgeting tool

## License

MIT License — See [LICENSE](LICENSE)

## Support

- **Bank scraping issues:** [israeli-bank-scrapers issues](https://github.com/eshaham/israeli-bank-scrapers/issues)
- **Actual Budget issues:** [Actual Budget issues](https://github.com/actualbudget/actual/issues)
- **This tool issues:** [Open an issue](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues)

---

If this saves you time, please star this repository!
