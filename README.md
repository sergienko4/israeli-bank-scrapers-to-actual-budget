# Israeli Bank Scrapers to Actual Budget

**Automatically import transactions from 18 Israeli banks and credit cards into Actual Budget**

This project uses [**israeli-bank-scrapers**](https://github.com/eshaham/israeli-bank-scrapers) by eshaham to fetch transactions from Israeli financial institutions and imports them into [Actual Budget](https://actualbudget.org/).

---

## 📖 What Does This Do?

```
Your Bank → israeli-bank-scrapers → This Tool → Actual Budget
```

1. You provide bank credentials in a config file
2. israeli-bank-scrapers logs into your bank and fetches transactions
3. This tool imports them into Actual Budget
4. All your transactions appear automatically!

**No manual CSV downloads. Everything automated.**

---

## 🏦 Supported Banks (18)

### Banks (11)
Bank Hapoalim, Leumi, Discount, Mizrahi Tefahot, Mercantile, Otsar Hahayal, Bank of Jerusalem, International Bank, Massad, Yahav

### Credit Cards (7)
Cal (Visa Cal), Max, Isracard, Amex Israel, Beyahad Bishvilha, Behatsdaa, Pagi, OneZero

**See [BANKS.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md) for credential requirements**

---

## ✨ Features

### Core Features
- ✅ Automatic scheduled imports (cron)
- ✅ 18 Israeli banks and credit cards
- ✅ Duplicate detection
- ✅ 2FA support (saves browser session)
- ✅ Date filtering (import only recent transactions)
- ✅ Multiple accounts mapping
- ✅ Optional reconciliation

### Stability & Resilience (Phase 3)
- ✅ **TypeScript** - Full type safety and clean architecture
- ✅ **10-minute timeout** - No more indefinite hangs
- ✅ **3 retry attempts** - Automatic recovery from transient failures
- ✅ **Exponential backoff** - Smart retry timing (1s, 2s, 4s)
- ✅ **Clear error messages** - User-friendly error categorization
- ✅ **Graceful shutdown** - Clean SIGTERM/SIGINT handling

### Idempotent Reconciliation (Phase 4)
- ✅ **Duplicate-free reconciliation** - No duplicate reconciliation transactions
- ✅ **One reconciliation per day** - Idempotent using `imported_id` pattern
- ✅ **Automatic detection** - Skips if reconciliation already exists
- ✅ **Proper balancing** - Matches bank balance with Actual Budget

### Observability & Metrics (Phase 4+)
- ✅ **Import metrics** - Track success rates, duration, and transaction counts
- ✅ **Performance tracking** - See which banks are slowest
- ✅ **Duplicate detection stats** - Know how many duplicates were prevented
- ✅ **Comprehensive validation** - Config errors caught at startup (not runtime)
- ✅ **Detailed summary** - See complete import statistics after each run

---

## 🚀 Quick Start

### 1. Install Docker

- **Windows/Mac**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**: `sudo apt install docker.io docker-compose`

### 2. Get the Code

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
```

### 3. Create Configuration

Copy the example and edit it:

```bash
cp config.json.example config.json
# Edit config.json with your credentials
```

**Minimal config.json:**

```json
{
  "actual": {
    "init": {
      "serverURL": "http://localhost:5006",
      "password": "your_actual_password",
      "dataDir": "./data"
    },
    "budget": {
      "syncId": "your_sync_id",
      "password": null
    }
  },
  "banks": {
    "discount": {
      "id": "123456789",
      "password": "bank_password",
      "num": "ABC123",
      "startDate": "2026-01-19",
      "targets": [{
        "actualAccountId": "account_id_from_actual",
        "reconcile": true,
        "accounts": "all"
      }]
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

### 4. Run with Docker

**Option A: Use pre-built image (easiest)**

```bash
# Pull from Docker Hub (use specific version for stability)
docker pull sergienko4/israeli-bank-importer:1.4

# Run
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  sergienko4/israeli-bank-importer:1.4
```

**Available tags:**
- `1.4`, `1` - Latest stable version (recommended)
- `v1.4.0` - Specific version (pinned)
- `20260218-214500` - Timestamped builds
- `main-abc123` - Commit-based builds

**Option B: Build from source**

```bash
# Build
docker build -t israeli-bank-importer:latest .

# Run
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  israeli-bank-importer:latest
```

**Windows users:** Replace `$(pwd)` with full path: `-v "C:\path\to\config.json:/app/config.json"`

**Scheduled run (recommended):**

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  israeli_bank_importer:
    image: sergienko4/israeli-bank-importer:1.4
    restart: always
    cap_add:
      - SYS_ADMIN
    environment:
      - TZ=Asia/Jerusalem
      - SCHEDULE=0 */8 * * *  # Every 8 hours
    volumes:
      - ./config.json:/app/config.json:ro
      - ./data:/app/data
      - ./cache:/app/cache
      - ./chrome-data:/app/chrome-data
```

Start:
```bash
docker-compose up -d
```

---

## 📋 Configuration Examples

### Example 1: Single Bank

```json
{
  "actual": { ... },
  "banks": {
    "leumi": {
      "username": "myusername",
      "password": "mypassword",
      "startDate": "2026-01-19",
      "targets": [{
        "actualAccountId": "account-uuid",
        "reconcile": true,
        "accounts": "all"
      }]
    }
  }
}
```

### Example 2: Multiple Banks

```json
{
  "actual": { ... },
  "banks": {
    "discount": {
      "id": "123456789",
      "password": "password1",
      "num": "ABC123",
      "targets": [{ "actualAccountId": "uuid1", "reconcile": true, "accounts": "all" }]
    },
    "leumi": {
      "username": "username",
      "password": "password2",
      "targets": [{ "actualAccountId": "uuid2", "reconcile": true, "accounts": "all" }]
    }
  }
}
```

### Example 3: Multiple Cards → Separate Accounts

Useful for credit cards when you want each card in its own Actual Budget account:

```json
{
  "actual": { ... },
  "banks": {
    "visaCal": {
      "username": "myusername",
      "password": "mypassword",
      "targets": [
        {
          "actualAccountId": "visa-card-1-uuid",
          "reconcile": true,
          "accounts": ["8538"]  // Card ending in 8538
        },
        {
          "actualAccountId": "visa-card-2-uuid",
          "reconcile": true,
          "accounts": ["7697"]  // Card ending in 7697
        }
      ]
    }
  }
}
```

**Tip:** Run with `"accounts": "all"` first, check logs to see card numbers, then configure specific cards.

---

## ⏰ Scheduling

Use `SCHEDULE` environment variable (cron format):

| Schedule | Expression | When |
|----------|-----------|------|
| Every 8 hours | `0 */8 * * *` | Midnight, 8am, 4pm |
| Daily at 2am | `0 2 * * *` | Once per day |
| Twice daily | `0 6,18 * * *` | 6am and 6pm |
| Run once | (don't set) | No schedule, exit after run |

---

## 🔄 Reconciliation

When `"reconcile": true`, the tool automatically reconciles your Actual Budget balance with the bank balance.

**How it works:**
- ✅ **Idempotent** - Creates only ONE reconciliation transaction per day per account
- ✅ **Smart detection** - Skips if already balanced
- ✅ **Duplicate prevention** - Running multiple times won't create duplicates
- ✅ **Automatic adjustment** - Creates adjustment transaction if balances differ

**Reconciliation Status Messages:**
```
✅ Already balanced             - No adjustment needed
✅ Reconciled: +123.45 ILS      - Created adjustment transaction
✅ Already reconciled today     - Duplicate prevented (already exists)
```

**When to use:**
- ✅ `true` - For checking, savings, credit cards (recommended)
- ❌ `false` - If you manually reconcile in Actual Budget

**Note:** Credit card balances are negative (this is normal!)

---

## 🐛 Common Issues

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

**Or use absolute path:**
```bash
-v "C:\Users\YourName\project\config.json:/app/config.json"
```

### Too Many Transactions
- **Fix:** Add `"startDate": "2026-01-19"` to limit to last 30 days

---

## 📊 Metrics & Monitoring

After each import run, you'll see a comprehensive summary:

```
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

**Benefits:**
- 📈 Track import success rates over time
- ⚡ Identify slow banks that need investigation
- 🔍 See how many duplicates are being prevented
- 📊 Monitor reconciliation accuracy
- 🐛 Quickly identify which bank is failing

---

## 📚 Documentation

| File | Description |
|------|-------------|
| [docs/BANKS.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md) | All 18 banks with credential requirements |
| [docs/DEPLOYMENT.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/DEPLOYMENT.md) | Detailed deployment instructions |
| [SECURITY.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/SECURITY.md) | Security best practices and guidelines |
| [CHANGELOG.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/CHANGELOG.md) | Version history and release notes |
| [config.json.example](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/config.json.example) | Example configuration |
| [GUIDELINES.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/GUIDELINES.md) | Development guidelines for contributors |

---

## 🔧 Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) | 6.7.1 | Bank scraping |
| [@actual-app/api](https://github.com/actualbudget/actual) | 26.2.0 | Actual Budget integration |
| Node.js | 22 | Runtime |
| Chromium | Latest | Browser automation |
| Docker | - | Containerization |
| [Vitest](https://vitest.dev/) | 4.x | Unit testing |

---

## 🧪 Testing

![CI/CD](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/docker-publish.yml/badge.svg)

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Watch mode (re-runs on file changes)
npm run test:watch

# Build + test (validate before committing)
npm run validate
```

**Coverage target:** 80%+ lines, functions, statements; 70%+ branches

---

## 📱 Telegram Notifications (Optional)

Get import summaries and error alerts via Telegram after each run.

### Step 1: Create a Telegram Bot (2 minutes)

1. Open Telegram on your phone or desktop
2. Search for **@BotFather** and start a chat
3. Send: `/newbot`
4. BotFather will ask for a name - type anything (e.g., `My Bank Importer`)
5. BotFather will ask for a username - must end in `bot` (e.g., `my_bank_importer_bot`)
6. BotFather replies with your **bot token** - copy it:
   ```
   123456789:ABCDefGHijKlMnOpQrStUvWxYz
   ```

### Step 2: Get Your Chat ID (1 minute)

**For personal notifications:**
1. Search for **@userinfobot** in Telegram and start a chat
2. It replies with your **chat ID** (a number like `123456789`)

**For group notifications:**
1. Add your new bot to a Telegram group
2. Send any message in the group
3. Open: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. Find `"chat":{"id":-100XXXXXXX}` - that's your group **chat ID**

### Step 3: Add to config.json

Add this section to your `config.json` (after `banks`):

```json
"notifications": {
  "enabled": true,
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN_HERE",
    "chatId": "YOUR_CHAT_ID_HERE"
  }
}
```

### Message Formats

Add `"messageFormat"` to choose how notifications look. Set in `config.json`:

```json
"telegram": {
  "botToken": "...",
  "chatId": "...",
  "messageFormat": "compact"
}
```

<details><summary><b>summary</b> (default) - Banks overview only</summary>

```
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

```
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

```
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

```
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

### On Failure
```
🚨 Import Failed

🔐 Authentication Error (discount): Invalid credentials. Please verify your password.
```

### Bot Commands (Optional)

Control the importer from Telegram. Add to your telegram config:

```json
"listenForCommands": true
```

| Command | Action |
|---------|--------|
| `/scan` | Run bank import now |
| `/status` | Show last run info |
| `/help` | List commands |

The bot listens alongside the cron scheduler. If an import is already running (from cron or a previous `/scan`), it waits instead of starting a duplicate.

### Disable Notifications

Set `"enabled": false` or remove the `notifications` section entirely.

---

## 🔐 Security

- ✅ Keep `config.json` private (in `.gitignore`)
- ✅ Use `chmod 600 config.json`
- ✅ Mount config as read-only: `:ro`
- ❌ Never commit credentials to git
- ❌ Never share config.json

**Why SYS_ADMIN?** Required for Chromium sandboxing. Safe when running trusted code.

---

## 🤝 Credits

- **[israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)** by [@eshaham](https://github.com/eshaham) - The core library that makes this possible. Huge thanks! ❤️
- **[Actual Budget](https://github.com/actualbudget/actual)** - Open-source budgeting tool

---

## 📄 License

MIT License - See [LICENSE](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/LICENSE)

---

## 🙋 Support

- **Bank scraping issues:** [israeli-bank-scrapers issues](https://github.com/eshaham/israeli-bank-scrapers/issues)
- **Actual Budget issues:** [Actual Budget issues](https://github.com/actualbudget/actual/issues)
- **This tool issues:** Open an issue in this repository

---

## 🌟 Star This Project

If this saves you time, please star ⭐ this repository!

---

**Made with ❤️ for the Israeli Actual Budget community**
