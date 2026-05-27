# Quick Start

Install [Actual Budget](https://actualbudget.org/) first (a server URL, a budget password, and a sync ID are required). Then:

## 1. Install Docker

- **Windows / macOS:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux:** `sudo apt install docker.io docker-compose`

## 2. Create `config.json`

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
cp config.json.example config.json
```

Edit `config.json`:

```json
{
  "actual": {
    "init": {
      "serverURL": "http://actual-server:5006",
      "password": "your_actual_password",
      "dataDir": "./data"
    },
    "budget": {
      "syncId": "your_sync_id_uuid",
      "password": null
    }
  },
  "delayBetweenBanks": 0,
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
    }
  }
}
```

**Where to find values:**

| Field | Where |
|-------|-------|
| `serverURL` | Your Actual Budget server URL — inside docker-compose use `http://actual-server:5006` |
| `password` | Actual Budget server password |
| `syncId` | Actual Budget → Settings → Show Advanced Settings → Sync ID |
| `actualAccountId` | Open an account in Actual Budget → copy the UUID from the URL |
| Bank credentials | Same as you use on the bank's website |

## 3. Run with Docker Compose (recommended)

```bash
docker compose up -d actual-server   # first run: open http://localhost:5006
docker compose up -d                 # start everything
docker compose logs -f               # tail logs
docker compose pull && docker compose up -d   # update
docker compose down                  # stop
```

The bundled `docker-compose.yml` starts **both** Actual Budget and the importer. Inside the compose network, use `http://actual-server:5006`.

## 4. Or with a single container

=== "Linux / macOS"

    ```bash
    docker run --rm --cap-add SYS_ADMIN \
      -v $(pwd)/config.json:/app/config.json:ro \
      -v $(pwd)/data:/app/data \
      -v $(pwd)/cache:/app/cache \
      -v $(pwd)/chrome-data:/app/chrome-data \
      -v $(pwd)/logs:/app/logs \
      -e TZ=Asia/Jerusalem \
      -e SCHEDULE="0 */8 * * *" \
      sergienko4/israeli-bank-importer
    ```

=== "Windows (PowerShell)"

    ```powershell
    docker run --rm --cap-add SYS_ADMIN `
      -v "${PWD}\config.json:/app/config.json:ro" `
      -v "${PWD}\data:/app/data" `
      -v "${PWD}\cache:/app/cache" `
      -v "${PWD}\chrome-data:/app/chrome-data" `
      -v "${PWD}\logs:/app/logs" `
      -e TZ=Asia/Jerusalem `
      -e SCHEDULE="0 */8 * * *" `
      sergienko4/israeli-bank-importer
    ```

The image entrypoint is `node dist/Index.js`. See [Docker run options](../deployment/docker-run.md) for the full reference.

## 5. Verify

- Open Actual Budget → confirm transactions appear.
- Tail `docker compose logs -f` (or `docker logs israeli-bank-importer`) — you should see one block per configured bank ending with `Bank ✅` or an actionable error.
- If notifications are enabled, the Telegram bot will reply to `/status`.

## Next steps

- [Add more banks](../banks/index.md)
- [Set the schedule](../configuration/scheduling.md)
- [Set up the Telegram bot](../notifications/telegram.md)
- [Auto-forward OTP codes](../OTP-AUTOFORWARD.md)
- [Encrypt your config](../configuration/encrypted-config.md)
