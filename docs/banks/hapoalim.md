# Bank Hapoalim

| Property | Value |
|----------|-------|
| Config key | `hapoalim` |
| Login fields | userCode, password |
| 2FA / OTP | optional |

## Login fields

| Field | Description |
|-------|-------------|
| `userCode` | Bank-issued user code (Hapoalim). |
| `password` | Your internet-banking password. |

## Sample config

```json
{
  "hapoalim": {
    "userCode": "your_userCode",
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
  "hapoalim": {
    "userCode": "your_userCode",
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

After a successful login, the importer automatically saves Hapoalim's warm-start cookie bundle in `bank-tokens.json` and reuses it on later runs to skip SMS verification while the session remains valid.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 17 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
