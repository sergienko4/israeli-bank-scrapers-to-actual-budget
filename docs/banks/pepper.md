# Pepper (by Bank Leumi)

| Property | Value |
|----------|-------|
| Config key | `pepper` |
| Login fields | phoneNumber, password |
| 2FA / OTP | **required** |

Pepper is an API-direct bank (Bank Leumi's mobile-first bank): the importer
talks to the bank's mobile-app API instead of driving a browser. Every
login requires an SMS OTP, but the bank issues a long-term token after the
first successful run that lets you skip OTP on subsequent runs.

## Login fields

| Field | Description |
|-------|-------------|
| `phoneNumber` | Phone number registered with Pepper in international form (e.g. `+972501234567`). |
| `password` | Your Pepper app login password. |

## Sample config

```json
{
  "pepper": {
    "phoneNumber": "your_phoneNumber",
    "password": "your_password",
    "twoFactorAuth": true,
    "twoFactorTimeout": 300,
    "otpLongTermToken": "",
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

This bank **requires** 2FA on every login.

After the first successful login, capture the value of `otpLongTermToken` from the logs and add it back to `config.json` to skip OTP on future runs.

For automated SMS forwarding, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

- `twoFactorAuth: true` is **always required** on first login.
- Pepper uses the API-direct path — there is no browser session, so `clearSession` and Camoufox-related settings have no effect.
- The `phoneNumber` must be the one registered with Pepper; the bank rejects unknown numbers with an authentication error.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
