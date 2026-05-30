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
| `phoneNumber` | Phone number registered with Pepper. Both digits-only (`972501234567`) and `+`-prefixed (`+972501234567`) are accepted; the importer normalises to canonical digits-only `972XXXXXXXXX` before talking to the bank. Local `0XXXXXXXXX` form is also normalised. |
| `password` | Your Pepper app login password. |

## Sample config

```json
{
  "pepper": {
    "phoneNumber": "972501234567",
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
- Leave `otpLongTermToken` as an **empty string** on first login. Do **not** insert placeholder text — the importer treats any non-empty value as a warm-start token; if it is invalid, the upstream library falls back to a cold (OTP) login, which the importer now correctly handles by always attaching the OTP retriever.
- Production crash signature `envelope selector miss: smsAssertionId at /data/control_flow/0/methods/*channels/?type=sms/assertion_id` indicates the auth response did **not** include the SMS channel. Two likely causes: (a) the `phoneNumber` was sent in an unsupported form (now fixed by normalisation at the credential boundary), or (b) the `password` is wrong — Pepper omits SMS from the available factors when uid/password is malformed.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
