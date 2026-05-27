# Israeli Bank Importer

[![Docker Pulls](https://img.shields.io/docker/pulls/sergienko4/israeli-bank-importer)](https://hub.docker.com/r/sergienko4/israeli-bank-importer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/sergienko4/israeli-bank-scrapers-to-actual-budget)](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases)

**Automatically import transactions from 18 Israeli banks and credit cards into [Actual Budget](https://actualbudget.org/).**

---

## Quick Start

### Docker Compose (recommended)

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
cp config.json.example config.json   # edit with your credentials
docker compose up -d actual-server   # first-time: open http://localhost:5006
docker compose up -d                 # start the importer
docker compose logs -f
```

### Docker run (single container)

```bash
docker pull sergienko4/israeli-bank-importer

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

The container entrypoint is `node dist/Index.js`.

---

## Supported Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release (linux/amd64, linux/arm64) |
| `v1.x.x` | Specific version (see [Releases](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases)) |

Each tagged release ships with a Software Bill of Materials (SBOM) attached to the GitHub release.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TZ` | _(none)_ | Container timezone, e.g. `Asia/Jerusalem` |
| `SCHEDULE` | _(none)_ | Cron expression; omit to run once and exit |
| `CREDENTIALS_ENCRYPTION_PASSWORD` | _(none)_ | Decryption password for encrypted `config.json` / `credentials.json` |
| `DRY_RUN` | `false` | When `true`, scrape banks but skip Actual Budget writes |
| `PROXY_SERVER` | _(none)_ | `socks5://`, `socks4://`, `http://`, `https://` — kept for future use (not yet wired to Camoufox) |

---

## Volumes

| Mount | Purpose | Notes |
|-------|---------|-------|
| `/app/config.json` | Bank credentials + Actual Budget connection | Required. Mount read-only (`:ro`) |
| `/app/data` | Actual Budget local sync data | Required for the Actual Budget API client |
| `/app/cache` | Scraper run cache | Recommended for faster re-runs |
| `/app/chrome-data` | Legacy browser session (no-op with Camoufox v7.9.0+) | Optional |
| `/app/logs` | Rotating log files (10 MB max, 3-day retention) | Required for the `/logs` Telegram command |

---

## Capabilities

- `--cap-add SYS_ADMIN` is required for the Camoufox/Firefox sandbox.
- Container runs as the non-root `node` user (UID 1000).

---

## What You Get

- 18 institutions (major Israeli banks + credit cards)
- Telegram bot (`/scan`, `/preview`, `/status`, `/logs`, `/import_receipt` OCR)
- Webhook delivery (Slack, Discord, generic JSON)
- Auto-categorization (`history` or Hebrew → English `translate`)
- Spending watch with payee-filtered thresholds
- Encrypted config (AES-256-GCM + PBKDF2)
- OTP auto-forward guides for Android (MacroDroid) and iPhone (Shortcuts)

---

## Links

- 📖 **Full documentation:** <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/>
- 🐙 **GitHub source:** <https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget>
- 🗺️ **Roadmap:** <https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/ROADMAP.md>
- 🔐 **Security policy:** <https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/SECURITY.md>
- 🐛 **Issues:** <https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues>

---

## License

[MIT](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/LICENSE) © Israeli Bank Importer Contributors

Maintained by [@sergienko4](https://github.com/sergienko4).
