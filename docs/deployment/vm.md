# VM Deployment

Deploy the importer to a long-running VM (Hetzner, DigitalOcean, AWS EC2, GCP, your home server, …).

## Prerequisites

- VM with **Docker** and **Docker Compose** installed.
- SSH access.
- Optional but recommended: a managed-DNS hostname for the Actual Budget UI.

> **Local development** requires Node.js 22+ (`.nvmrc` is included — run `nvm use` to switch automatically).

## Step 1 — Create the importer directory

```bash
ssh -i "your_ssh_key.key" ubuntu@your_vm_ip_address

mkdir -p /home/ubuntu/actual-importer/{data,cache,chrome-data,logs}
cd /home/ubuntu/actual-importer
```

## Step 2 — Create `config.json` on the VM

When the VM also runs Actual Budget in the same compose stack, use the internal Docker DNS service name as `serverURL` (not `localhost`):

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

## Step 3 — Add the importer to your existing `docker-compose.yml`

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
      - /home/ubuntu/actual-importer/logs:/app/logs
    depends_on:
      - actual_server
    networks:
      - actual_network

networks:
  actual_network:
    name: actual_network
```

## Step 4 — Deploy

```bash
cd /home/ubuntu/actual-importer

docker compose pull importer
docker compose up -d importer
docker compose logs -f importer
docker compose ps
```

## Update workflow

```bash
docker compose pull importer
docker compose up -d importer       # rolling restart
docker image prune -f               # cleanup old layers
```

## Deployment checklist

- [ ] `config.json` exists with credentials
- [ ] Tested with run-once mode (no `SCHEDULE`)
- [ ] Transactions appear in Actual Budget
- [ ] `daysBack` or `startDate` set for the history you want
- [ ] `SCHEDULE` set with the right `TZ`
- [ ] `--cap-add SYS_ADMIN` (or `cap_add: SYS_ADMIN`)
- [ ] All required volumes mounted
- [ ] `restart: unless-stopped` so the container survives reboots
- [ ] First scheduled run confirmed in logs
