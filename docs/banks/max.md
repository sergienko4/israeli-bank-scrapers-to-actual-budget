# Max (Leumi Card)

| Property | Value |
|----------|-------|
| Config key | `max` |
| Login fields | username, password, id |
| 2FA / OTP | optional |

## Login fields

| Field | Description |
|-------|-------------|
| `username` | Your internet-banking username. |
| `password` | Your internet-banking password. |
| `id` | Your 9-digit Israeli ID (Teudat Zehut), unless noted otherwise. |

## Sample config

```json
{
  "max": {
    "username": "your_username",
    "password": "your_password",
    "id": "your_id",
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
  "max": {
    "username": "your_username",
    "password": "your_password",
    "id": "your_id",
    "twoFactorAuth": true,
    "twoFactorTimeout": 300,
    "daysBack": 14,
    "targets": [...]
  }
}
```

The Telegram bot prompts for the code on each run. For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

Both `username` and `id` are required - `id` is your full Israeli ID number.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
