# Supported Banks

Eighteen Israeli financial institutions are supported — major banks and credit cards.

| # | Institution | Config key | Login fields | 2FA / OTP |
|---|-------------|-----------|--------------|-----------|
| 1 | Bank Hapoalim | [`hapoalim`](hapoalim.md) | userCode, password | optional |
| 2 | Bank Leumi | [`leumi`](leumi.md) | username, password | optional |
| 3 | Discount Bank | [`discount`](discount.md) | id, password, num | optional |
| 4 | Mizrahi Tefahot | [`mizrahi`](mizrahi.md) | username, password | optional |
| 5 | Mercantile | [`mercantile`](mercantile.md) | id, password, num | optional |
| 6 | Otsar Hahayal | [`otsarHahayal`](otsarHahayal.md) | username, password | optional |
| 7 | Union | [`union`](union.md) | username, password | optional |
| 8 | Beinleumi | [`beinleumi`](beinleumi.md) | username, password | optional |
| 9 | Massad | [`massad`](massad.md) | username, password | optional |
| 10 | Yahav | [`yahav`](yahav.md) | username, nationalID, password | optional |
| 11 | Beyahad Bishvilha | [`beyahadBishvilha`](beyahadBishvilha.md) | id, password | optional |
| 12 | Behatsdaa | [`behatsdaa`](behatsdaa.md) | id, password | optional |
| 13 | Pagi | [`pagi`](pagi.md) | username, password | optional |
| 14 | One Zero | [`oneZero`](oneZero.md) | email, password, phoneNumber | **required** |
| 15 | Visa Cal | [`visaCal`](visaCal.md) | username, password | optional |
| 16 | Max (Leumi Card) | [`max`](max.md) | username, password, id | optional |
| 17 | Isracard | [`isracard`](isracard.md) | id, card6Digits, password | optional |
| 18 | Amex | [`amex`](amex.md) | id, card6Digits, password | optional |

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

Full reference: [Bank options](../configuration/banks.md).

## 2FA / OTP

Any bank with an SMS verification screen supports `twoFactorAuth: true`. The Telegram bot prompts for the code. For automated handling, see [OTP auto-forward](../OTP-AUTOFORWARD.md).

**One Zero is special** — 2FA is required on every login, but you can capture an `otpLongTermToken` after the first successful run to skip it thereafter.

## Security tips

- Mount `config.json` read-only in Docker (`:ro`).
- `chmod 600 config.json` outside the container.
- [Encrypt your config](../configuration/encrypted-config.md) when storing it on disk.
- Use the split `credentials.json` + `config.json` pattern so settings stay shareable.
