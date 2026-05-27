# Yahav

| Property | Value |
|----------|-------|
| Config key | `yahav` |
| Login fields | username, nationalID, password |
| 2FA / OTP | optional |

## Login fields

| Field | Description |
|-------|-------------|
| `username` | Your internet-banking username. |
| `nationalID` | Your 9-digit Israeli ID number - distinct from `username`. |
| `password` | Your internet-banking password. |

## Sample config

```json
{
  "yahav": {
    "username": "your_username",
    "nationalID": "your_nationalID",
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
  "yahav": {
    "username": "your_username",
    "nationalID": "your_nationalID",
    "password": "your_password",
    "twoFactorAuth": true,
    "twoFactorTimeout": 300,
    "daysBack": 14,
    "targets": [...]
  }
}
```

The Telegram bot prompts for the code on each run. For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

`nationalID` is your full 9-digit Israeli ID - separate from `username`.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 18 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
