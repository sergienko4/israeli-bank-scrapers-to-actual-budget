# Bank Leumi

| Property | Value |
|----------|-------|
| Config key | `leumi` |
| Login fields | username, password |
| 2FA / OTP | optional |

## Login fields

| Field | Description |
|-------|-------------|
| `username` | Your internet-banking username. |
| `password` | Your internet-banking password. |

## Sample config

```json
{
  "leumi": {
    "username": "your_username",
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
  "leumi": {
    "username": "your_username",
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
