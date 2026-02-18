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

**See [BANKS.md](BANKS.md) for credential requirements**

---

## ✨ Features

- ✅ Automatic scheduled imports (cron)
- ✅ 18 Israeli banks and credit cards
- ✅ Duplicate detection
- ✅ 2FA support (saves browser session)
- ✅ Date filtering (import only recent transactions)
- ✅ Multiple accounts mapping
- ✅ Optional reconciliation

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
# Pull from Docker Hub
docker pull sergienko4/israeli-bank-importer:latest

# Run
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  sergienko4/israeli-bank-importer:latest
```

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
    image: sergienko4/israeli-bank-importer:latest
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

When `"reconcile": true`, the tool creates a transaction to match your Actual Budget balance with the bank balance.

**Important:**
- Creates a **NEW** transaction each run (does not update existing)
- Credit card balances are negative (this is normal!)
- You may want to delete old reconciliation transactions periodically

**When to use:**
- ✅ `true` - For checking, savings, credit cards
- ❌ `false` - If you manually reconcile in Actual Budget

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

## 📚 Documentation

| File | Description |
|------|-------------|
| [BANKS.md](BANKS.md) | All 18 banks with credential requirements |
| [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) | Detailed deployment instructions |
| [config.json.example](config.json.example) | Example configuration |

---

## 🔧 Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) | 6.7.1 | Bank scraping |
| [@actual-app/api](https://github.com/actualbudget/actual) | 26.2.0 | Actual Budget integration |
| Node.js | 22 | Runtime |
| Chromium | Latest | Browser automation |
| Docker | - | Containerization |

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

MIT License - See [LICENSE](LICENSE)

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
