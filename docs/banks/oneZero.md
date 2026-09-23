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

This bank **requires** 2FA for the first (cold) login. Later runs replay the
stored long-term token and need no SMS, until the bank expires or revokes it.

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

Leave `otpLongTermToken` as an empty string. After the first successful login the
importer captures the bank's long-term token itself and saves it to
`/app/data/bank-tokens.json`, then replays it on every later run so no SMS is
needed. There is nothing to copy out of the logs — since scrapers 8.7.2 the
token is redacted there.

For automated SMS forwarding, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

`twoFactorAuth: true` is **always required** on first login. From the second run
onwards the stored token is replayed automatically; you only see another SMS if
the token expires, is rejected, or another importer instance re-mints it.

**Run only one importer per OneZero account.** Each cold (SMS) login mints a new
long-term token and revokes the previous one, so two instances sharing an account
cancel each other out and every run falls back to SMS.

Each scrape is allowed exactly one SMS login. The scraper enforces this for the
login itself, and the importer applies the same rule to a mistyped code: the run
ends and you start a new scrape rather than being asked again. This keeps an
unattended schedule from looping on prompts and sending SMS after SMS.

The token file is written to the read-write `/app/data` volume with mode `600`.
Set `BANK_TOKENS_PATH` to an absolute path to store it elsewhere.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
