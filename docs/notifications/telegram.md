# Telegram Bot

Get import summaries and error alerts via Telegram after each run. Optionally control the importer with commands (`/scan`, `/preview`, `/status`, `/logs`, `/import_receipt` OCR).

## Step 1 — Create a Telegram bot (2 minutes)

1. Open Telegram → search for [**@BotFather**](https://t.me/BotFather) → start a chat.
2. Send `/newbot`.
3. Choose a name and username (must end in `bot`).
4. Copy the **bot token**, e.g. `123456789:ABCDefGHijKlMnOpQrStUvWxYz`.

## Step 2 — Get your chat ID (1 minute)

- **Personal chat:** message [**@userinfobot**](https://t.me/userinfobot) — it replies with your chat ID.
- **Group:** add the bot to the group, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and look for `"chat":{"id":-100...}`.

## Step 3 — Add to `config.json`

```json
"notifications": {
  "enabled": true,
  "maxTransactions": 5,
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID",
    "messageFormat": "compact",
    "showTransactions": "new",
    "listenForCommands": true,
    "enableReceiptImport": false
  }
}
```

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `maxTransactions` | `1`–`25` | `5` | Max transactions per account in notifications (set at `notifications` level, not inside `telegram`) |
| `messageFormat` | `summary`, `compact`, `ledger`, `emoji` | `summary` | See [Message formats](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/notifications/message-formats.md) |
| `showTransactions` | `new`, `all`, `none` | `new` | Transaction detail level |
| `listenForCommands` | `true`, `false` | `false` | Enable bot commands (long-polling) |
| `enableReceiptImport` | `true`, `false` | `false` | Enable `/import_receipt` for OCR receipt import |

## Bot commands

When `listenForCommands` is `true`:

| Command | Action |
|---------|--------|
| `/scan` | Run bank import now |
| `/scan bankName` | Import a single bank, e.g. `/scan discount` |
| `/retry` | Re-import only banks that failed in the last run |
| `/preview` | Dry-run: scrape banks and show what would be imported (no writes) |
| `/status` | Show last 5 imports with transaction counts and duration |
| `/check_config` | Validate config (offline + online checks) |
| `/watch` | Show current spending-watch totals |
| `/logs` | Show recent log entries (default: 50, requires `logConfig.logDir`) |
| `/logs N` | Show last N entries (max 150) |
| `/import_receipt` | Start a receipt-photo OCR import flow (requires `enableReceiptImport: true`) |
| `/help` | List all commands |

The bot listens **alongside** the cron scheduler. If an import is already running, an incoming `/scan` waits instead of starting a duplicate. Error messages include actionable advice (e.g. "Bank requires password change — update password on bank website"). Banks that fail 3+ times in a row get escalated warnings.

## Receipt Import (OCR)

Import transactions directly from receipt photos.

**Flow:**

1. Send `/import_receipt` to the bot.
2. Take a photo of your receipt and send it.
3. The bot extracts date, amount, and merchant using OCR.
4. **Smart match:** if a previous transaction has the same payee, the bot suggests the same account + category.
5. Select account and category via inline buttons.
6. Transaction is imported into Actual Budget.

**Enable in `config.json`:**

```json
"telegram": {
  "listenForCommands": true,
  "enableReceiptImport": true
}
```

**OCR details:**

- Engine: [tesseract.js](https://github.com/naptha/tesseract.js) (Hebrew + English).
- Preprocessing: [sharp](https://sharp.pixelplumbing.com/) (resize 1500 px, greyscale, threshold).
- Accuracy: ~81 % confidence on Hebrew receipts after preprocessing.
- Priority extraction: `לתשלום` (total) > `סה"כ` (subtotal) > `₪` prefix > largest formatted number.
- No temp files: photo processed as in-memory `Buffer`. OCR language data cached in `./data/tesseract/`.
- 2-minute timeout auto-cancels abandoned flows.

## Disable the bot

Set `"enabled": false` or remove the `notifications` section entirely.

## See also

- [Message formats](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/notifications/message-formats.md) — every layout illustrated
- [Webhooks](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/notifications/webhooks.md) — Slack / Discord / generic JSON
- [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md) — automate 2FA from your phone
