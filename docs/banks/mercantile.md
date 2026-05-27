# Mercantile

| Property | Value |
|----------|-------|
| Config key | `mercantile` |
| Login fields | id, password, num |
| 2FA / OTP | optional |

## Login fields

| Field | Description |
|-------|-------------|
| `id` | Your 9-digit Israeli ID (Teudat Zehut), unless noted otherwise. |
| `password` | Your internet-banking password. |
| `num` | 6-character user-identification code shown on your bank statements. |

## Sample config

```json
{
  "mercantile": {
    "id": "your_id",
    "password": "your_password",
    "num": "your_num",
    "daysBack": 14,
    "targets": [
      {
        "actualAccountId": "uuid-from-actual",
        "reconcile": true,
        "accounts": "all"
      }
    ]
  }
}
```

## 2FA / OTP

2FA is **optional** - enable it only if your bank prompts for an SMS code:

```json
{
  "mercantile": {
    "id": "your_id",
    "password": "your_password",
    "num": "your_num",
    "twoFactorAuth": true,
    "twoFactorTimeout": 300,
    "daysBack": 14,
    "targets": [...]
  }
}
```

The Telegram bot prompts for the code on each run. For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

Mercantile is a subsidiary of Discount - the scraper uses the same login flow.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 18 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
