# Supported Banks

Eighteen Israeli financial institutions are supported — major banks and credit cards.

| # | Institution | Config key | Login fields | 2FA / OTP |
|---|-------------|-----------|--------------|-----------|
| 1 | Bank Hapoalim | [`hapoalim`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/hapoalim.md) | userCode, password | optional |
| 2 | Bank Leumi | [`leumi`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/leumi.md) | username, password | optional |
| 3 | Discount Bank | [`discount`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/discount.md) | id, password, num | optional |
| 4 | Mizrahi Tefahot | [`mizrahi`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/mizrahi.md) | username, password | optional |
| 5 | Mercantile | [`mercantile`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/mercantile.md) | id, password, num | optional |
| 6 | Otsar Hahayal | [`otsarHahayal`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/otsarHahayal.md) | username, password | optional |
| 7 | Union | [`union`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/union.md) | username, password | optional |
| 8 | Beinleumi | [`beinleumi`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/beinleumi.md) | username, password | optional |
| 9 | Massad | [`massad`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/massad.md) | username, password | optional |
| 10 | Yahav | [`yahav`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/yahav.md) | username, nationalID, password | optional |
| 11 | Beyahad Bishvilha | [`beyahadBishvilha`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/beyahadBishvilha.md) | id, password | optional |
| 12 | Behatsdaa | [`behatsdaa`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/behatsdaa.md) | id, password | optional |
| 13 | Pagi | [`pagi`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/pagi.md) | username, password | optional |
| 14 | One Zero | [`oneZero`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/oneZero.md) | email, password, phoneNumber | **required** |
| 15 | Visa Cal | [`visaCal`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/visaCal.md) | username, password | optional |
| 16 | Max (Leumi Card) | [`max`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/max.md) | username, password, id | optional |
| 17 | Isracard | [`isracard`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/isracard.md) | id, card6Digits, password | optional |
| 18 | Amex | [`amex`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/amex.md) | id, card6Digits, password | optional |

Use the **Config key** as the bank name in your `config.json`.

## Common fields (any bank)

Every bank entry shares the same shape on top of its credentials:

```json
"<bankKey>": {
  "<...credentials...>": "...",
  "daysBack": 14,                  // or "startDate": "2026-02-01"
  "targets": [
    { "actualAccountId": "uuid", "reconcile": true, "accounts": "all" }
  ],
  "timeout": 30000,                // optional, raise for slow networks
  "navigationRetryCount": 0,       // optional, raise for flaky networks
  "twoFactorAuth": false,          // optional
  "twoFactorTimeout": 300          // optional, seconds
}
```

Full reference: [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md).

## 2FA / OTP

Any bank with an SMS verification screen supports `twoFactorAuth: true`. The Telegram bot prompts for the code. For automated handling, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

**One Zero is special** — 2FA is required on every login, but you can capture an `otpLongTermToken` after the first successful run to skip it thereafter.

## Security tips

- Mount `config.json` read-only in Docker (`:ro`).
- `chmod 600 config.json` outside the container.
- [Encrypt your config](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/encrypted-config.md) when storing it on disk.
- Use the split `credentials.json` + `config.json` pattern so settings stay shareable.
