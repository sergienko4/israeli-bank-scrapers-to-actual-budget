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

The bot prompts for a code when Hapoalim requests one. Hapoalim's app flow can
ask for **two codes in the same run**: the login code first, then a device
step-up code when the importer enrolls this host as a device. Answer both
prompts. For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

Hapoalim signs in through the bank's app edge. After a successful login, the
importer saves the warm-start token in `bank-tokens.json` and reuses it on
later runs to skip SMS verification while the session remains valid. The token
holds the session and a device seed, so treat the file as a secret.

The first run after upgrading to scraper 10.1.0 re-enrolls the device. The
token saved by the previous scraper is a cookie session, not the new carry
bundle, so the importer refuses it, enrolls again with two SMS codes, and
replaces the old token automatically. Later runs skip SMS until the session
expires or the password changes. After a password change, expect one cold
login while a new token is published.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 17 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
