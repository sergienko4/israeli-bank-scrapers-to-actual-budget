# PayBox (by Discount Bank)

| Property | Value |
|----------|-------|
| Config key | `paybox` |
| Login fields | phoneNumber |
| 2FA / OTP | **required** |

PayBox is an API-direct bank: the importer talks to the bank's mobile-app
API instead of driving a browser. Every login requires an SMS OTP, but the
bank issues a long-term token after the first successful run that lets
you skip OTP on subsequent runs.

## Login fields

| Field | Description |
|-------|-------------|
| `phoneNumber` | Phone number registered with PayBox in international form (e.g. `+972501234567`). |

## Sample config

```json
{
  "paybox": {
    "phoneNumber": "your_phoneNumber",
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
- PayBox uses the API-direct path — there is no browser session, so `clearSession` and Camoufox-related settings have no effect.
- The `phoneNumber` must be the one registered with PayBox; the bank rejects unknown numbers with an authentication error.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
