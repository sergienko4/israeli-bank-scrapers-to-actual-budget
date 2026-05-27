# Configuration

The importer reads its configuration from `config.json` at the repository root (or `/app/config.json` inside the container). Use [`config.json.example`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/config.json.example) as the canonical template.

The configuration is split into several sections — each documented on its own page:

- [Actual Budget connection](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/actual.md)
- [Scheduling](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/scheduling.md)
- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md)
- [Logging](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/logging.md)
- [Auto-categorization](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/categorization.md)
- [Spending watch](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/spending-watch.md)
- [Encrypted config](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/encrypted-config.md)
- [Proxy](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/proxy.md)
- [Rate limiting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/rate-limiting.md)

## Top-level structure

```json
{
  "actual": { ... },
  "delayBetweenBanks": 0,
  "banks": {
    "<bankKey>": { ... }
  },
  "logConfig": { ... },
  "categorization": { ... },
  "spendingWatch": [ ... ],
  "notifications": {
    "telegram": { ... },
    "webhook": { ... }
  }
}
```

| Key | Purpose | Required |
|-----|---------|----------|
| `actual` | Actual Budget server URL, password, sync ID | Yes |
| `delayBetweenBanks` | Milliseconds to wait between bank imports | No (default `0`) |
| `banks` | Map of bank credentials and targets | Yes |
| `logConfig` | Log format and output directory | No |
| `categorization` | Auto-categorization mode | No |
| `spendingWatch` | Threshold rules and payee filters | No |
| `notifications` | Telegram + webhook delivery | No |

## Split config (secrets / settings)

Separate secrets from settings by creating two files:

- `credentials.json` — passwords, tokens, bank IDs (encrypt this)
- `config.json` — settings like daysBack, targets, formats (safe to commit / share)

`credentials.json` is deep-merged into `config.json` at startup. A single `config.json` with everything still works (fully backward compatible).

See [Encrypted config](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/encrypted-config.md) for the encryption workflow.
