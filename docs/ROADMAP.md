# Roadmap

What's coming next for Israeli Bank Importer.

Want to suggest a feature? [Open an issue](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues).

---

## Setup & Onboarding

Make it easy to go from "I installed Docker" to "my transactions are flowing."

| Feature | Description | Status |
|---------|-------------|--------|
| **Config validation** | `--validate` flag and `/validate` bot command. Checks JSON syntax, bank name typos (with "did you mean?"), UUID formats, Actual server connectivity, Telegram token validity. Clear PASS/FAIL/WARN report. | Planned |
| **Dry run / preview** | `DRY_RUN=true` env var and `/preview` bot command. Scrapes banks but doesn't write to Actual Budget. Shows accounts found, transaction counts, balances, and sample transactions. | Planned |
| **Account discovery** | `/discover` bot command. Scrapes all banks and outputs a clean table of account numbers and balances, with ready-to-paste `targets` config snippets. | Planned |

## Daily Use

Turn the Telegram bot from a notification pipe into a proactive financial assistant.

| Feature | Description | Status |
|---------|-------------|--------|
| **Spending alerts** | Configurable alerts: large transactions (over threshold), daily spending limits, new unknown payees. Separate from import summary notifications. | Planned |
| **Spending summary** | `/summary` bot command. Monthly income/expenses/net, top 5 categories, account balances. Also `/summary week` and `/summary last` for different time ranges. | Planned |
| **Selective bank import** | `/scan discount` to import just one bank. `/scan visaCal,leumi` for multiple. Per-bank control instead of all-or-nothing. | Planned |
| **Balance alerts** | Per-account balance thresholds. Get notified when checking account drops below 5,000 ILS or credit card exceeds -10,000 ILS. | Planned |

## Data Quality

Cleaner, more accurate imports.

| Feature | Description | Status |
|---------|-------------|--------|
| **Payee normalization** | Rules to clean up messy bank descriptions before import. `"שופרסל דיל-סניף 123-תל אביב"` becomes `"Shufersal"`. Extends existing translate rules. Original payee preserved. | Planned |
| **Transfer detection** | Detect matching debit/credit pairs between own accounts and mark as transfers. Prevents double-counting in spending reports. Configurable date window and minimum amount. | Planned |

## Reliability

Better errors, monitoring, and recovery.

| Feature | Description | Status |
|---------|-------------|--------|
| **Health check endpoint** | HTTP `/health` endpoint for Docker health checks, Uptime Kuma, Kubernetes probes. Returns last run time, next scheduled run, configured banks. | Planned |
| **Error improvements + /retry** | Map scraper error codes to actionable messages ("Your password may have changed"). `/retry` command re-runs only failed banks. Consecutive failure escalation. | Planned |

---

## Recently Shipped

| Feature | Version |
|---------|---------|
| Dynamic test count badge | v1.12.0 |
| Split config (credentials + settings) | v1.11.0 |
| Encrypted config (AES-256-GCM) | v1.10.0 |
| Auto-categorize transactions (history + translate) | v1.9.0 |
| Telegram HTML parsing fix | v1.9.0 |
| Rate limiting between bank imports | v1.8.x |
| Webhook notifications (Slack, Discord, plain) | v1.8.x |
| Import audit log + /status history | v1.8.x |
| Structured logging (words/json/table/phone) | v1.7.x |
| Telegram bot commands (/scan, /status, /logs, /help) | v1.6.x |
| 2FA via Telegram (OneZero) | v1.5.x |

---

## Not Planned (but considered)

These were evaluated and deprioritized:

| Feature | Reason |
|---------|--------|
| GUI / Web dashboard | Out of scope — this is a Docker CLI tool. Use Actual Budget's UI. |
| Google Sheets export | Adds OAuth2 dependency. Consider [Moneyman](https://github.com/daniel-hauser/moneyman) instead. |
| YNAB export | This project targets Actual Budget. Consider [Caspion](https://github.com/brafdlog/caspion) for YNAB. |
| LLM categorization | Consider [actual-ai](https://github.com/sakowicz/actual-ai) as a companion Docker service. |
| GitHub Actions deployment | Security concern with bank credentials in GitHub Secrets. |

---

*Last updated: 2026-02-21*
