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
| `phoneNumber` | Phone number registered with PayBox. Both digits-only (`972501234567`) and `+`-prefixed (`+972501234567`) are accepted; the importer normalises to canonical digits-only `972XXXXXXXXX` before talking to the bank. Local `0XXXXXXXXX` form is also normalised. |

## Sample config

```json
{
  "paybox": {
    "phoneNumber": "972501234567",
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

PayBox's login consumes the SMS code **twice** — once to validate the PIN step
and once to complete the SMS sign-in. Both steps need the same delivered digits,
so the importer answers the second request with the code you already supplied.
You are prompted once per login attempt, not twice.

If the bank rejects the code, the next attempt prompts you for a fresh one —
the replay cache is rebuilt per attempt, so a wrong code is never re-sent.

> The bank is matched on the `CompanyTypes` enum **value**, which is camelCase
> (`payBox`) rather than PascalCase (`PayBox`). Matching on a hand-written
> PascalCase literal silently disables the replay cache and the double prompt
> returns. Always compare against `CompanyTypes.PayBox`, never a string literal.

## Known gotchas

- `twoFactorAuth: true` is **always required** on first login.
- PayBox uses the API-direct path — there is no browser session, so `clearSession` and Camoufox-related settings have no effect.
- The `phoneNumber` must be the one registered with PayBox; the bank rejects unknown numbers with an authentication error.
- Leave `otpLongTermToken` as an **empty string** on first login. Do **not** insert placeholder text — the importer treats any non-empty value as a warm-start token; if it is invalid, the upstream library falls back to a cold (OTP) login, which the importer now correctly handles by always attaching the OTP retriever.
- Production crash signature `POST /phoneValidate 400 {"errors":"Validation Error"}` indicates the `phoneNumber` was sent in an unsupported form (e.g. raw `+972…` slipped past upstream's international validator). The current importer prevents this by normalising at the credential boundary; if you still hit it, check that your `phoneNumber` contains only digits / `+` / `-` / spaces — no letters or extension suffixes.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
