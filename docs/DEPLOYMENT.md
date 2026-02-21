# Israeli Bank Importer - Deployment Guide

**Compatible with Actual Budget v26.2.0+**

---

## Quick Start

### 1. Create config.json

```json
{
  "actual": {
    "init": {
      "dataDir": "./data",
      "password": "your_actual_password",
      "serverURL": "https://your-actual-server.com"
    },
    "budget": {
      "syncId": "your_budget_sync_id",
      "password": null
    }
  },
  "banks": {
    "discount": {
      "id": "your_id",
      "password": "your_password",
      "num": "your_num",
      "daysBack": 14,
      "targets": [
        {
          "actualAccountId": "your_account_uuid",
          "reconcile": true,
          "accounts": "all"
        }
      ]
    }
  },
  "delayBetweenBanks": 5000,
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
      "botToken": "123456789:ABCdef...",
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

### 2. Run Once (Test Mode)

```bash
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  -e TZ=Asia/Jerusalem \
  sergienko4/israeli-bank-importer
```

### 3. Run Scheduled (Production Mode)

```bash
docker run -d \
  --name israeli-bank-importer \
  --restart unless-stopped \
  --cap-add SYS_ADMIN \
  -e TZ=Asia/Jerusalem \
  -e SCHEDULE="0 */8 * * *" \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  sergienko4/israeli-bank-importer
```

---

## Docker Compose Setup (Recommended)

A ready-to-use `docker-compose.yml` is included in the repo:

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f

# Update to latest version
docker compose pull && docker compose up -d

# Stop
docker compose down
```

Customize schedule and timezone by editing `docker-compose.yml`:

```yaml
environment:
  - TZ=Asia/Jerusalem
  - SCHEDULE=0 */8 * * *    # Every 8 hours
```

Uses named volumes for data persistence — your data survives container recreation.

---

## Configuration Reference

### Actual Budget Connection

| Option | Required | Description |
|--------|----------|-------------|
| `actual.init.serverURL` | Yes | Your Actual Budget server URL |
| `actual.init.password` | Yes | Server password |
| `actual.init.dataDir` | No | Local data directory (default: `./data`) |
| `actual.budget.syncId` | Yes | UUID from Settings → Show Advanced Settings → Sync ID |
| `actual.budget.password` | No | Budget encryption password (if set) |

### Bank Options (per bank)

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `startDate` | No | ~1 year | Fixed start date (`YYYY-MM-DD`), max 1 year back |
| `daysBack` | No | - | Import last N days (1-30). Cannot use with `startDate` |
| `targets` | Yes | - | Array of account mappings (see below) |
| `twoFactorAuth` | No | `false` | Enable 2FA OTP via Telegram (OneZero) |
| `twoFactorTimeout` | No | `300` | Seconds to wait for OTP reply |
| `otpLongTermToken` | No | - | Skip OTP after first login |

### Target Options (per target)

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `actualAccountId` | Yes | - | Target account UUID in Actual Budget |
| `reconcile` | No | `false` | Auto-adjust balance to match bank |
| `accounts` | No | `"all"` | `"all"` or array like `["1234", "5678"]` |

### Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `delayBetweenBanks` | `0` | Milliseconds to wait between bank imports |

### Logging

| Option | Default | Description |
|--------|---------|-------------|
| `logConfig.format` | `words` | Log format: `words`, `json`, `table`, `phone` |
| `logConfig.maxBufferSize` | `150` | Ring buffer size for `/logs` bot command (1-500) |

### Auto-Categorization

| Option | Default | Description |
|--------|---------|-------------|
| `categorization.mode` | `none` | `none`, `history`, or `translate` |
| `categorization.translations` | `[]` | Array of `{fromPayee, toPayee}` rules (only for `translate` mode) |

### Notifications

| Option | Description |
|--------|-------------|
| `notifications.enabled` | `true` / `false` — master switch |
| `notifications.maxTransactions` | Max transactions per account in notifications (1-25, default: 5) |
| `notifications.telegram.botToken` | Telegram Bot API token |
| `notifications.telegram.chatId` | Chat ID for notifications |
| `notifications.telegram.messageFormat` | `summary` (default), `compact`, `ledger`, `emoji` |
| `notifications.telegram.showTransactions` | `new` (default), `all`, `none` |
| `notifications.telegram.listenForCommands` | `true` to enable `/scan`, `/status`, `/logs`, `/help` |
| `notifications.webhook.url` | Webhook URL (Slack, Discord, or custom) |
| `notifications.webhook.format` | `slack`, `discord`, `plain` (default) |

---

## Scheduling

The `SCHEDULE` environment variable uses cron format:

```bash
# Run every 8 hours (midnight, 8am, 4pm)
SCHEDULE=0 */8 * * *

# Run daily at 2am
SCHEDULE=0 2 * * *

# Run every 6 hours
SCHEDULE=0 */6 * * *
```

Don't set `SCHEDULE` to run once and exit.

### Cron Format Reference

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday=0)
│ │ │ │ │
* * * * *
```

---

## VM Deployment

### Prerequisites

- VM with Docker and Docker Compose installed
- Actual Budget server running and accessible
- SSH access to VM

### Deployment Steps

#### 1. Create Importer Directory on VM

```bash
ssh -i "your_ssh_key.key" ubuntu@your_vm_ip_address

mkdir -p /home/ubuntu/actual-importer/{data,cache,chrome-data}
cd /home/ubuntu/actual-importer
```

#### 2. Create config.json on VM

Use internal Docker network URL for serverURL:

```json
{
  "actual": {
    "init": {
      "serverURL": "http://actual_server:5006",
      "password": "your_actual_server_password",
      "dataDir": "./data"
    },
    "budget": {
      "syncId": "your_budget_sync_id",
      "password": null
    }
  },
  "banks": {
    "discount": {
      "id": "your_id_number",
      "password": "your_bank_password",
      "num": "your_identification_code",
      "daysBack": 14,
      "targets": [
        {
          "actualAccountId": "your_actual_account_id",
          "reconcile": true,
          "accounts": "all"
        }
      ]
    }
  }
}
```

#### 3. Add Importer to docker-compose.yml

Edit your Actual Budget `docker-compose.yml`:

```yaml
services:
  actual_server:
    # ... existing config ...

  importer:
    image: sergienko4/israeli-bank-importer:latest
    container_name: israeli-bank-importer
    restart: unless-stopped
    cap_drop:
      - ALL
    cap_add:
      - SYS_ADMIN
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /dev/shm:size=256m
    environment:
      - TZ=Asia/Jerusalem
      - SCHEDULE=0 */8 * * *
    volumes:
      - /home/ubuntu/actual-importer/config.json:/app/config.json:ro
      - /home/ubuntu/actual-importer/data:/app/data
      - /home/ubuntu/actual-importer/cache:/app/cache
      - /home/ubuntu/actual-importer/chrome-data:/app/chrome-data
    depends_on:
      - actual_server
    networks:
      - actual_network

networks:
  actual_network:
    name: actual_network
```

#### 4. Deploy

```bash
cd /home/ubuntu/actual-data

# Pull and start
docker compose pull importer
docker compose up -d importer

# Check logs
docker compose logs -f importer

# Verify it's running
docker compose ps
```

---

## Volume Persistence

| Volume | Purpose | Required |
|--------|---------|----------|
| `/app/config.json` | Bank credentials | Yes |
| `/app/data` | Actual Budget sync data | Yes |
| `/app/cache` | Scraper cache | Recommended |
| `/app/chrome-data` | Browser session (2FA persistence) | Recommended |

**Why persist chrome-data?** Stores browser cookies and sessions, preventing repeated 2FA challenges.

---

## Security Notes

- **Never commit `config.json` to git**
- Set read-only permission: `chmod 600 config.json`
- Use `:ro` mount flag for read-only config
- `SYS_ADMIN` is required for Chromium sandboxing — only run trusted images with this capability
- Container runs as non-root user (`node`, UID 1000)

---

## Troubleshooting

### Check Logs

```bash
# Docker run
docker logs israeli-bank-importer

# Docker Compose
docker compose logs -f importer
```

### Common Issues

**Import fails with "out-of-sync-migrations"**
- Ensure Actual Budget server is v26.2.0+
- Clear `./data` directory and try again

**Browser fails to launch**
- Ensure `SYS_ADMIN` capability is set
- Check Chromium is installed in container

**2FA Required Every Run**
- Ensure `chrome-data` volume is mounted
- Check volume permissions

**Scheduled runs not working**
- Verify `SCHEDULE` format is correct
- Check container logs for scheduler messages
- Ensure container has `restart: unless-stopped`

---

## Deployment Checklist

- [ ] Created `config.json` with credentials
- [ ] Tested with run-once mode locally
- [ ] Verified transactions in Actual Budget
- [ ] Set `daysBack` or `startDate` for desired history
- [ ] Set appropriate `SCHEDULE` value
- [ ] Added `SYS_ADMIN` capability
- [ ] Mounted all required volumes
- [ ] Set `restart: unless-stopped` for scheduled runs
- [ ] Verified scheduled runs are working

---

## Additional Resources

- **israeli-bank-scrapers**: https://github.com/eshaham/israeli-bank-scrapers
- **Actual Budget**: https://actualbudget.org/docs/
- **Actual Budget API**: https://actualbudget.org/docs/api/
