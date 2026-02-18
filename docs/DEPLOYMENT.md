# Israeli Bank Importer - Deployment Guide

**Compatible with Actual Budget v26.2.0+**

This importer follows the same approach as [tomerh2001/israeli-banks-actual-budget-importer](https://github.com/tomerh2001/israeli-banks-actual-budget-importer) with updated dependencies.

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Docker Compose Setup](#docker-compose-setup)
3. [Configuration](#configuration)
4. [Scheduling](#scheduling)
5. [VM Deployment](#vm-deployment)

---

## 🚀 Quick Start

### 1. Create Configuration

Create `config.json`:

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
      "startDate": "2026-01-19",
      "targets": [
        {
          "actualAccountId": "your_account_id",
          "reconcile": true,
          "accounts": "all"
        }
      ]
    }
  }
}
```

### 2. Run Once (Test Mode)

```bash
docker run --rm \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  -e TZ=Asia/Jerusalem \
  israeli-bank-importer:latest
```

### 3. Run Scheduled (Production Mode)

```bash
docker run -d \
  --name israeli_bank_importer \
  --restart always \
  --cap-add SYS_ADMIN \
  -e TZ=Asia/Jerusalem \
  -e SCHEDULE="0 */8 * * *" \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  israeli-bank-importer:latest
```

---

## 🐳 Docker Compose Setup

### Local Testing

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  israeli_bank_importer:
    image: israeli-bank-importer:latest
    container_name: israeli_bank_importer
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

**Run:**
```bash
docker-compose up -d
```

**View logs:**
```bash
docker-compose logs -f israeli_bank_importer
```

**Stop:**
```bash
docker-compose down
```

---

## ⚙️ Configuration

### Required: Actual Budget Connection

```json
{
  "actual": {
    "init": {
      "serverURL": "https://your-server.com",
      "password": "server_password",
      "dataDir": "./data"
    },
    "budget": {
      "syncId": "budget-sync-id",
      "password": null
    }
  }
}
```

### Bank Configurations

#### Bank Discount

```json
{
  "discount": {
    "id": "your_id_number",
    "password": "your_password",
    "num": "your_identification_code",
    "startDate": "2026-01-19",
    "targets": [
      {
        "actualAccountId": "your_actual_account_id",
        "reconcile": true,
        "accounts": "all"
      }
    ]
  }
}
```

#### Bank Leumi

```json
{
  "leumi": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [
      {
        "actualAccountId": "account-id",
        "reconcile": true,
        "accounts": "all"
      }
    ]
  }
}
```

#### Bank Hapoalim

```json
{
  "hapoalim": {
    "userCode": "your_user_code",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [
      {
        "actualAccountId": "account-id",
        "reconcile": true,
        "accounts": "all"
      }
    ]
  }
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `startDate` | No | ~1 year | Start date for transactions (YYYY-MM-DD) |
| `reconcile` | No | `false` | Auto-create reconciliation transaction |
| `accounts` | No | `"all"` | `"all"` or array like `["1234", "5678"]` |
| `actualAccountId` | Yes | - | Target account ID in Actual Budget |

---

## ⏰ Scheduling

### Using SCHEDULE Environment Variable

The `SCHEDULE` environment variable uses cron format:

```bash
# Run every 8 hours (midnight, 8am, 4pm)
SCHEDULE=0 */8 * * *

# Run daily at 2am
SCHEDULE=0 2 * * *

# Run every 6 hours
SCHEDULE=0 */6 * * *

# Run every Monday at 9am
SCHEDULE=0 9 * * 1
```

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

### Run Modes

**Run Once (No Schedule)**
- Don't set `SCHEDULE` environment variable
- Container runs import once and exits
- Useful for testing

**Scheduled Mode**
- Set `SCHEDULE` environment variable
- Container keeps running
- Imports run on schedule
- Use `restart: always` for persistence

---

## 🖥️ VM Deployment

### Prerequisites

- VM with Docker and Docker Compose installed
- Actual Budget server running on VM
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
      "startDate": "2026-01-19",
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

#### 3. Update Actual Budget docker-compose.yml

Edit `/home/ubuntu/actual-data/docker-compose.yml`:

```yaml
services:
  actual_server:
    # ... existing config ...

  caddy:
    # ... existing config ...

  israeli_bank_importer:
    image: YOUR_DOCKERHUB_USERNAME/israeli-bank-importer:latest
    container_name: israeli_bank_importer
    restart: always
    cap_add:
      - SYS_ADMIN
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

#### 4. Deploy to VM

```bash
# Pull the image
cd /home/ubuntu/actual-data
sudo docker-compose pull israeli_bank_importer

# Start the service
sudo docker-compose up -d israeli_bank_importer

# Check logs
sudo docker-compose logs -f israeli_bank_importer

# Verify it's running
sudo docker-compose ps
```

#### 5. Test Manual Run (Optional)

```bash
# Run once for testing
sudo docker-compose run --rm israeli_bank_importer

# Check Actual Budget for imported transactions
# Visit https://your-actual-server.com
```

---

## 📊 Volume Persistence

### Required Volumes

| Volume | Purpose | Required |
|--------|---------|----------|
| `/app/config.json` | Configuration | ✅ Yes |
| `/app/data` | Actual Budget cache | ✅ Yes |
| `/app/cache` | Scraper cache | Recommended |
| `/app/chrome-data` | Browser profile (for 2FA) | Recommended |

### Why Persist chrome-data?

- Stores browser cookies and sessions
- Prevents repeated 2FA challenges
- Some banks require 2FA on first login only

---

## 🔒 Security Notes

### Docker Capabilities

The importer requires `SYS_ADMIN` capability for Chromium:

```yaml
cap_add:
  - SYS_ADMIN
```

This is needed for browser sandboxing. **Only run trusted images** with this capability.

### Config File Security

- **Never commit `config.json` to git**
- Set read-only permission: `chmod 600 config.json`
- Use `:ro` mount flag in docker-compose for read-only

### Credentials

- Store `config.json` securely
- Consider using Docker secrets for production
- Limit file access to necessary users only

---

## 🐛 Troubleshooting

### Check Logs

```bash
# Docker run
docker logs israeli_bank_importer

# Docker Compose
docker-compose logs -f israeli_bank_importer
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
- Ensure container has `restart: always`

---

## 📚 Additional Resources

- **israeli-bank-scrapers**: https://github.com/eshaham/israeli-bank-scrapers
- **Actual Budget**: https://actualbudget.org/docs/
- **Actual Budget API**: https://actualbudget.org/docs/api/

---

## ✅ Deployment Checklist

- [ ] Created `config.json` with credentials
- [ ] Tested with run-once mode locally
- [ ] Verified transactions in Actual Budget
- [ ] Adjusted `startDate` for desired history
- [ ] Set appropriate `SCHEDULE` value
- [ ] Added `SYS_ADMIN` capability
- [ ] Mounted all required volumes
- [ ] Set `restart: always` for scheduled runs
- [ ] Pushed image to Docker Hub (for VM)
- [ ] Deployed to VM with docker-compose
- [ ] Verified scheduled runs are working
