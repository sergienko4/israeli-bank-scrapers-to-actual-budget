# Synology (Container Manager)

Synology's **Container Manager** package (formerly Docker) runs the importer image directly. This guide walks through the UI workflow — no SSH required.

## Prerequisites

- DSM 7.2+ with **Container Manager** installed.
- A Synology user with admin rights.
- A folder on the volume (e.g. `/volume1/docker/actual-importer/`) for config + persistent state.

## Step 1 — Prepare folders

In **File Station**, create:

```text
/volume1/docker/actual-importer/
├── config.json
├── data/
├── cache/
├── chrome-data/
└── logs/
```

Edit `config.json` with your bank credentials. See [Quick Start](../getting-started/quick-start.md) for the schema.

## Step 2 — Pull the image

In **Container Manager** → **Registry** → search `sergienko4/israeli-bank-importer` → **Download** → choose `latest`.

## Step 3 — Create the container

**Container Manager** → **Container** → **Create** → select the downloaded image.

### General settings

- **Container Name:** `israeli-bank-importer`
- **Enable auto-restart**: ✔

### Advanced — Capabilities

Add capability: `SYS_ADMIN` (required for the Camoufox sandbox).

### Advanced — Environment

| Variable | Value |
|----------|-------|
| `TZ` | `Asia/Jerusalem` |
| `SCHEDULE` | `0 */8 * * *` (or your chosen cron) |

### Advanced — Volume

| Host file/folder | Container path | Mount type |
|------------------|----------------|------------|
| `/volume1/docker/actual-importer/config.json` | `/app/config.json` | Read-only |
| `/volume1/docker/actual-importer/data` | `/app/data` | Read/write |
| `/volume1/docker/actual-importer/cache` | `/app/cache` | Read/write |
| `/volume1/docker/actual-importer/chrome-data` | `/app/chrome-data` | Read/write |
| `/volume1/docker/actual-importer/logs` | `/app/logs` | Read/write |

### Advanced — Network

Use `bridge` (default). If Actual Budget runs on the same NAS, pick the same custom network so DNS resolution works.

## Step 4 — Start

Click **Apply**. The container should show **Running**.

Tail logs via **Container** → select → **Details** → **Log**.

## Update

**Container Manager** → **Registry** → re-download `sergienko4/israeli-bank-importer:latest` → **Image** → right-click old image → **Clear** → **Container** → **Restart**.

Or via SSH:

```bash
sudo docker pull sergienko4/israeli-bank-importer:latest
sudo docker stop israeli-bank-importer
sudo docker rm israeli-bank-importer
# Re-create via Container Manager (settings persist if you exported them).
```

## See also

- [Docker run reference](docker-run.md)
- [Scheduling](../configuration/scheduling.md)
- [Logging](../configuration/logging.md)
