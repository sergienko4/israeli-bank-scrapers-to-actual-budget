# Israeli Bank Importer

<!-- meta:badges:start -->
[![PR Pipeline](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/pr.yml/badge.svg)](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/pr.yml)
[![Release](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/release.yml/badge.svg)](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker Pulls](https://img.shields.io/docker/pulls/sergienko4/israeli-bank-importer)](https://hub.docker.com/r/sergienko4/israeli-bank-importer)
[![Node.js](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fsergienko4%2F2860e2ffec3d5919e4b658fed5ce4e5e%2Fraw%2Factual-budget-importer-test-count.json)](#contributing)
[![E2E](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fsergienko4%2F2860e2ffec3d5919e4b658fed5ce4e5e%2Fraw%2Factual-budget-importer-e2e-count.json)](#contributing)
<!-- meta:badges:end -->

**Automatically import transactions from 19 Israeli banks and credit cards into [Actual Budget](https://actualbudget.org/).**

Powered by [**@sergienko4/israeli-bank-scrapers**](https://github.com/sergienko4/israeli-bank-scrapers) (fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with Amex/Isracard WAF fix and Camoufox stealth).

📖 **Full documentation:** <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/>

---

## TL;DR Quick Start

```bash
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git
cd israeli-bank-scrapers-to-actual-budget
cp config.json.example config.json
# edit config.json with your bank credentials + actualAccountId
docker compose up -d actual-server   # first-time: open http://localhost:5006
docker compose up -d                 # start the importer
docker compose logs -f
```

**Windows:** replace `$(pwd)` with `"C:\path\to\config.json"` in `docker run` examples.

See [Quick Start guide](https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/getting-started/quick-start/) for the full walk-through.

---

## Supported Banks

<!-- meta:supported-banks:start -->
| # | Institution | Config key | Login fields |
|---|-------------|-----------|--------------|
| 1 | Bank Hapoalim | `hapoalim` | userCode, password |
| 2 | Bank Leumi | `leumi` | username, password |
| 3 | Discount Bank | `discount` | id, password, num |
| 4 | Mizrahi Tefahot | `mizrahi` | username, password |
| 5 | Mercantile | `mercantile` | id, password, num |
| 6 | Otsar Hahayal | `otsarHahayal` | username, password |
| 7 | Beinleumi | `beinleumi` | username, password |
| 8 | Massad | `massad` | username, password |
| 9 | Yahav | `yahav` | username, nationalID, password |
| 10 | Beyahad Bishvilha | `beyahadBishvilha` | id, password |
| 11 | Behatsdaa | `behatsdaa` | id, password |
| 12 | Pagi | `pagi` | username, password |
| 13 | One Zero | `oneZero` | email, password, phoneNumber |
| 14 | Visa Cal | `visaCal` | username, password |
| 15 | Max (Leumi Card) | `max` | username, password, id |
| 16 | Isracard | `isracard` | id, card6Digits, password |
| 17 | Amex | `amex` | id, card6Digits, password |
| 18 | PayBox (by Discount Bank) | `paybox` | phoneNumber |
| 19 | Pepper (by Bank Leumi) | `pepper` | phoneNumber, password |
<!-- meta:supported-banks:end -->

See per-bank pages: [Banks index](https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/banks/) · [docs/banks/](docs/banks/).

---

## Features

- 🏦 19 banks and credit cards (major Israeli institutions + cards)
- 🤖 Telegram bot: `/scan`, `/preview`, `/status`, `/logs`, `/import_receipt` (OCR)
- 📥 Webhook delivery (Slack, Discord, generic JSON)
- 🏷️ Auto-categorization (`history` / `translate` Hebrew → English)
- 🚨 Spending watch with payee filters and threshold alerts
- 🔐 Encrypted config (AES-256-GCM + PBKDF2 derivation)
- 📤 OTP auto-forward (Android MacroDroid + iPhone Shortcuts guides)
- ⏰ Cron-based scheduling (Docker, VM, Synology, Oracle Cloud, Kubernetes)
- 🦊 Camoufox stealth browser (Firefox + C++-level fingerprint masking)
- 🛡️ Read-only config mounts, non-root container, zero telemetry

---

<details>
<summary><b>Minimal config example</b></summary>

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

Full reference: [Configuration docs](https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/getting-started/configuration/).

</details>

<details>
<summary><b>Telegram bot setup (3 steps)</b></summary>

1. Chat with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Add the bot to a group or chat with [@userinfobot](https://t.me/userinfobot) for your chat ID.
3. Add the credentials to `config.json`:

```json
"notifications": {
  "enabled": true,
  "telegram": {
    "botToken": "123456789:ABCDefGHijKlMnOpQrStUvWxYz",
    "chatId": "-1001234567890",
    "messageFormat": "compact",
    "showTransactions": "new",
    "listenForCommands": true,
    "enableReceiptImport": false
  }
}
```

Full bot setup, commands, and OCR receipt import: [Telegram docs](https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/notifications/telegram/).

</details>

<details>
<summary><b>Docker run (single container)</b></summary>

```bash
docker pull ghcr.io/sergienko4/israeli-bank-importer
# or
docker pull sergienko4/israeli-bank-importer

docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Jerusalem \
  -e SCHEDULE="0 */8 * * *" \
  ghcr.io/sergienko4/israeli-bank-importer
```

The container entrypoint is `node dist/Index.js`. Full Docker options: [Docker run guide](https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/deployment/docker-run/).

</details>

<details>
<summary><b>Tech stack</b></summary>

<!-- meta:tech-stack:start -->
- **Node.js** >=22.0.0 (Docker base: `node:24-slim`)
- **TypeScript** ^6.0.3 (strict mode, ES2022)
- **Vitest** ^4.1.7 (v8 coverage)
- **Scraper** [`@sergienko4/israeli-bank-scrapers`](https://github.com/sergienko4/israeli-bank-scrapers) ^8.4.0
- **Browser** Camoufox (Firefox + C++-level fingerprint masking)
- **Actual Budget API** `@actual-app/api` ^26.5.2
<!-- meta:tech-stack:end -->

</details>

<details>
<summary><b>Docker image</b></summary>

<!-- meta:docker-image:start -->
Images are published to two registries (multi-arch: `linux/amd64`, `linux/arm64`).

**GHCR (primary, always available):**

```bash
docker pull ghcr.io/sergienko4/israeli-bank-importer:latest
# or pin a specific version
docker pull ghcr.io/sergienko4/israeli-bank-importer:v1.x.x
```

**Docker Hub (mirror, best-effort):**

```bash
docker pull sergienko4/israeli-bank-importer:latest
# or pin a specific version
docker pull sergienko4/israeli-bank-importer:v1.x.x
```

See available tags on [GHCR](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/pkgs/container/israeli-bank-importer) or [Docker Hub](https://hub.docker.com/r/sergienko4/israeli-bank-importer/tags).
<!-- meta:docker-image:end -->

Multi-arch images (`linux/amd64`, `linux/arm64`) are published per release.
GHCR is the canonical publish target and is always in sync with releases; Docker Hub is a best-effort mirror that may lag during registry incidents.

To never miss a release, subscribe to signals that are independent of any Docker registry:

- **GitHub Releases** — [Watch → Custom → Releases](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget) for email + UI notifications.
- **RSS feed** — [`releases.atom`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases.atom).
- **Auto-updaters** (Watchtower, Diun, etc.) — track `ghcr.io/sergienko4/israeli-bank-importer` for guaranteed updates.

</details>

<details>
<summary><b>Local development</b></summary>

```bash
nvm use                 # Node 22+ (.nvmrc included)
npm ci
npm run build
npm test                # unit tests + coverage (config/vitest.config.ts)
npm run test:unit       # explicit unit run
npm run test:e2e:mock   # Dockerized mocked E2E (no real banks)
npm run docs:serve      # http://127.0.0.1:8000 — MkDocs Material preview
```

Pre-commit runs a 21-gate hook (type-check, lint, build, audit, tests, Docker build, Trivy, mocked E2E, Telegram smoke, ESLint canaries, runtime circular-dep check, coupling regression). Plan PRs accordingly. The decoupling baseline is captured at `tests/coupling-baseline.json` and regenerated via `npm run coupling:report`; CI fails on any new file scoring >= 8 (see `scripts/coupling-scanner.cjs`).

</details>

---

## Documentation

| Topic | Link |
|-------|------|
| Quick start | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/getting-started/quick-start/> |
| Per-bank options | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/banks/> |
| Configuration reference | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/getting-started/configuration/> |
| Telegram & webhooks | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/notifications/telegram/> |
| Deployment guides | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/deployment/docker-compose/> |
| Architecture | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/architecture/> |
| Troubleshooting | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/troubleshooting/> |
| Security | [docs/SECURITY.md](docs/SECURITY.md) |
| Contributing | [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) |
| Code guidelines | [docs/GUIDELINES.md](docs/GUIDELINES.md) |
| Roadmap | [docs/ROADMAP.md](docs/ROADMAP.md) |
| API (TypeDoc) | <https://sergienko4.github.io/israeli-bank-scrapers-to-actual-budget/api/> |

---

## Contributing

Contributions welcome! See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) and the [Code Guidelines](docs/GUIDELINES.md). All contributors agree to the [Code of Conduct](docs/CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE) © Israeli Bank Importer Contributors.

## Support

- 🐛 [Open an issue](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues)
- 💬 [Issue tracker](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues)
- 📦 [Releases](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases)
