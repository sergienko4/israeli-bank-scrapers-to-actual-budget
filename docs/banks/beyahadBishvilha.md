# Beyahad Bishvilha

| Property | Value |
|----------|-------|
| Config key | `beyahadBishvilha` |
| Login fields | id, password |
| 2FA / OTP | optional |

## Login fields

| Field | Description |
|-------|-------------|
| `id` | Your 9-digit Israeli ID (Teudat Zehut), unless noted otherwise. |
| `password` | Your internet-banking password. |

## Sample config

```json
{
  "beyahadBishvilha": {
    "id": "your_id",
    "password": "your_password",
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
  "beyahadBishvilha": {
    "id": "your_id",
    "password": "your_password",
    "twoFactorAuth": true,
    "twoFactorTimeout": 300,
    "daysBack": 14,
    "targets": [...]
  }
}
```

The Telegram bot prompts for the code on each run. For automated handling, see [OTP auto-forward](../OTP-AUTOFORWARD.md).

## Known gotchas

No known gotchas for this bank - open an issue if you hit one.

## See also

- [Bank options](../configuration/banks.md) - full schema reference
- [Banks index](index.md) - all 18 banks
- [Troubleshooting](../troubleshooting.md)
