# Actual Budget Connection

Configure how the importer talks to your Actual Budget server.

```json
"actual": {
  "init": {
    "serverURL": "http://actual-server:5006",
    "password": "your_server_password",
    "dataDir": "./data"
  },
  "budget": {
    "syncId": "uuid-from-settings",
    "password": null
  }
}
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `actual.init.serverURL` | Yes | — | Actual Budget server URL. Inside docker-compose: `http://actual-server:5006`. From outside the compose network: `http://localhost:5006` or your remote URL. |
| `actual.init.password` | Yes | — | Server password (the one you set when you first opened Actual Budget). |
| `actual.init.dataDir` | No | `./data` | Local directory used by the Actual Budget API client for sync state. Mount as a volume. |
| `actual.budget.syncId` | Yes | — | Sync ID from **Settings → Show Advanced Settings → Sync ID**. |
| `actual.budget.password` | No | `null` | Budget encryption password (only if you enabled end-to-end encryption on the budget). |

## Where to find values

| Field | Where |
|-------|-------|
| `serverURL` | Your Actual Budget server's address |
| `password` | Server password (set during first run) |
| `syncId` | Actual Budget → Settings → Show Advanced Settings → Sync ID |
| `actualAccountId` | Open an account in Actual Budget → copy the UUID from the URL |

## First-time setup

If you don't have an Actual Budget instance yet, the bundled `docker-compose.yml` brings one up:

```bash
docker compose up -d actual-server
# Open http://localhost:5006
# Sign in or create your account
# Create a budget
# Settings → Show Advanced Settings → Sync ID → copy
# Settings → Show Advanced Settings → Reset sync (if needed)
```

Use the copied Sync ID as `actual.budget.syncId`.
