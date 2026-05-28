# Israeli Bank Importer

**Automatically import transactions from 19 Israeli banks and credit cards into [Actual Budget](https://actualbudget.org/).**

Powered by [@sergienko4/israeli-bank-scrapers](https://github.com/sergienko4/israeli-bank-scrapers) (fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with Amex/Isracard WAF fix and Camoufox stealth).

---

## What It Does

```text
Your Bank → israeli-bank-scrapers → This Tool → Actual Budget
                    OR
Receipt Photo → Telegram Bot → OCR → This Tool → Actual Budget
```

No manual CSV downloads. Everything automated.

---

<div class="grid cards" markdown>

-   :material-rocket-launch: **Get Started**

    ---

    Install Docker, drop in a `config.json`, and run.

    [:octicons-arrow-right-24: Quick Start](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/getting-started/quick-start.md)

-   :material-bank: **Supported Banks**

    ---

    19 Israeli banks and credit cards — Hapoalim, Leumi, Discount, OneZero, Max, Isracard, Amex, PayBox, Pepper, and more.

    [:octicons-arrow-right-24: Bank list](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md)

-   :material-cog: **Configuration**

    ---

    Schedule, encryption, categorization, spending watch, proxy, logging.

    [:octicons-arrow-right-24: Configuration](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/getting-started/configuration.md)

-   :material-docker: **Deploy**

    ---

    Docker Compose, single container, VM, Oracle Cloud, Synology, Kubernetes.

    [:octicons-arrow-right-24: Deployment](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/docker-compose.md)

-   :material-bell: **Notifications**

    ---

    Telegram bot with `/scan`, `/preview`, `/import_receipt` (OCR), plus Slack/Discord webhooks.

    [:octicons-arrow-right-24: Telegram](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/notifications/telegram.md)

-   :material-shield-check: **Security**

    ---

    Encrypted config, split-credentials, no telemetry, no third-party calls.

    [:octicons-arrow-right-24: Security](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/SECURITY.md)

</div>

---

## Highlights

- **19 institutions** — major banks + credit cards
- **Telegram bot** — `/scan`, `/preview`, `/status`, `/logs`, `/import_receipt` (OCR)
- **Auto-categorization** — `history`, `translate` (Hebrew → English), or off
- **Spending watch** — alert on budget thresholds with payee filters
- **Encrypted config** — AES-256-GCM + PBKDF2 for credentials at rest
- **OTP auto-forward** — Android (MacroDroid) and iPhone (Shortcuts) guides
- **Scheduled** — cron-based, runs on Docker Compose / Synology / Oracle Cloud / Kubernetes

---

## Project Status

Released under [MIT License](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/LICENSE).
See the [Roadmap](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/ROADMAP.md) for what's next.

[:fontawesome-brands-github: Source](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget){ .md-button }
[:fontawesome-brands-docker: Docker Hub](https://hub.docker.com/r/sergienko4/israeli-bank-importer){ .md-button }
