# Israeli Bank Importer

[![Docker Pulls](https://img.shields.io/docker/pulls/sergienko4/israeli-bank-importer)](https://hub.docker.com/r/sergienko4/israeli-bank-importer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/sergienko4/israeli-bank-scrapers-to-actual-budget)](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases)

**Automatically import transactions from 19 Israeli banks and credit cards into [Actual Budget](https://actualbudget.org/).**

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

> **Tip:** Images are also published to GitHub Container Registry at
> `ghcr.io/sergienko4/israeli-bank-importer`. GHCR is the primary release
> target and is always in sync; this Docker Hub repository is a best-effort
> mirror that may occasionally lag behind during registry incidents.

---

## Supported Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release (linux/amd64, linux/arm64) |
| `v1.x.x` | Specific version (see [Releases](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases)) |

Each tagged release ships with a Software Bill of Materials (SBOM) attached to the GitHub release.

---

## Stay up to date

This Docker Hub repository is a **best-effort mirror** of the canonical GHCR release at `ghcr.io/sergienko4/israeli-bank-importer`. When a Docker Hub mirror push fails (registry incidents, edge-proxy rejects), a tag may temporarily be missing here even though the release has shipped to GHCR and GitHub.

To never miss a release, subscribe to the signals that are **independent of any Docker registry**:

- **GitHub Releases** — [Watch → Custom → Releases](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget) (email + UI notifications on every release).
- **RSS feed** — [`https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases.atom`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases.atom).
- **Auto-updaters (Watchtower, Diun, etc.)** — track `ghcr.io/sergienko4/israeli-bank-importer` for guaranteed updates; Docker Hub backfills on the next successful mirror publish.

When the GitHub release exists but `docker pull sergienko4/israeli-bank-importer:<tag>` returns `manifest unknown`, pull the same tag from GHCR:

```bash
docker pull ghcr.io/sergienko4/israeli-bank-importer:<tag>
```

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

- 19 institutions (major Israeli banks + credit cards)
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
