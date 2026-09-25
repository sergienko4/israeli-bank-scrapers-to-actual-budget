# One Zero

| Property | Value |
|----------|-------|
| Config key | `oneZero` |
| Login fields | email, password, phoneNumber |
| 2FA / OTP | required |

## Login fields

| Field | Description |
|-------|-------------|
| `email` | The email address registered with the bank. |
| `password` | Your internet-banking password. |
| `phoneNumber` | Phone number registered for SMS OTP. Both digits-only (`972501234567`) and `+`-prefixed (`+972501234567`) are accepted; the importer normalises to canonical digits-only `972XXXXXXXXX` before talking to the bank. Local `0XXXXXXXXX` form is also normalised. |

## Sample config

```json
{
  "oneZero": {
    "email": "your_email",
    "password": "your_password",
    "phoneNumber": "your_phoneNumber",
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

```json
{
  "oneZero": {
    "email": "your_email",
    "password": "your_password",
    "phoneNumber": "your_phoneNumber",
    "twoFactorAuth": true,
    "twoFactorTimeout": 300,
    "otpLongTermToken": "",
    "daysBack": 14,
    "targets": [...]
  }
}
```

After the first SMS login the importer saves the bank's long-term token in
`bank-tokens.json` on the data volume and sends it on later runs, so they
skip the SMS. Keep `twoFactorAuth: true`: when the bank refuses the token, the
importer logs in with one SMS and saves the new one. The logs never show the
token. Changing the email or renaming the `banks` entry costs one SMS. See
[Long-term token](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md#long-term-token).

For automated SMS forwarding, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

`twoFactorAuth: true` is **always required** on first login. Keep it on
afterwards: without it the importer cannot ask for a code when the bank
refuses the saved token, and the run fails.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
