# Supported Israeli Banks & Credit Cards

Complete list of all supported financial institutions and their required credentials.

---

## 🏦 Banks (11)

### Bank Hapoalim
```json
{
  "hapoalim": {
    "userCode": "your_user_code",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Bank Leumi
```json
{
  "leumi": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Bank Discount
```json
{
  "discount": {
    "id": "your_id_number",
    "password": "your_password",
    "num": "your_identification_code",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Mizrahi Bank
```json
{
  "mizrahi": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Mercantile Bank
```json
{
  "mercantile": {
    "id": "your_id_number",
    "password": "your_password",
    "num": "your_identification_code",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Bank Otsar Hahayal
```json
{
  "otsarHahayal": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Union Bank
```json
{
  "union": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Beinleumi
```json
{
  "beinleumi": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Massad
```json
{
  "massad": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Bank Yahav
```json
{
  "yahav": {
    "username": "your_username",
    "nationalID": "your_national_id",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

---

## 💳 Credit Cards (9)

### Visa Cal
```json
{
  "visaCal": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Max (Leumi Card)
```json
{
  "max": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Isracard
```json
{
  "isracard": {
    "id": "your_id_number",
    "card6Digits": "123456",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### American Express (Amex)
```json
{
  "amex": {
    "id": "your_id_number",
    "card6Digits": "123456",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Beyahad Bishvilha (ביחד בשבילך)
```json
{
  "beyahadBishvilha": {
    "id": "your_id_number",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Behatsdaa (בהצדעה)
```json
{
  "behatsdaa": {
    "id": "your_id_number",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### Pagi
```json
{
  "pagi": {
    "username": "your_username",
    "password": "your_password",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```

### One Zero (Experimental)
```json
{
  "oneZero": {
    "email": "your_email",
    "password": "your_password",
    "phoneNumber": "your_phone_number",
    "startDate": "2026-01-19",
    "targets": [...]
  }
}
```
**Note:** OneZero requires OTP authentication. Advanced configuration may be needed.

---

## 📋 Credential Requirements Summary

| Institution | Type | Required Fields |
|-------------|------|-----------------|
| Hapoalim | Bank | `userCode`, `password` |
| Leumi | Bank | `username`, `password` |
| Discount | Bank | `id`, `password`, `num` |
| Mizrahi | Bank | `username`, `password` |
| Mercantile | Bank | `id`, `password`, `num` |
| Otsar Hahayal | Bank | `username`, `password` |
| Union | Bank | `username`, `password` |
| Beinleumi | Bank | `username`, `password` |
| Massad | Bank | `username`, `password` |
| Yahav | Bank | `username`, `nationalID`, `password` |
| Visa Cal | Credit | `username`, `password` |
| Max | Credit | `username`, `password` |
| Isracard | Credit | `id`, `card6Digits`, `password` |
| Amex | Credit | `id`, `card6Digits`, `password` |
| Beyahad Bishvilha | Credit | `id`, `password` |
| Behatsdaa | Credit | `id`, `password` |
| Pagi | Credit | `username`, `password` |
| One Zero | Bank | `email`, `password`, `phoneNumber` |

---

## ⚙️ Common Configuration Options

All institutions support these additional options:

### startDate (Optional)
Limit transaction history to a specific date range:
```json
{
  "startDate": "2026-01-19"  // YYYY-MM-DD format
}
```

### targets (Required)
Define where transactions should be imported:

```json
{
  "targets": [
    {
      "actualAccountId": "account-id-from-actual-budget",
      "reconcile": true,
      "accounts": "all"
    }
  ]
}
```

**Options:**
- `actualAccountId` (required): Target account ID in Actual Budget
- `reconcile` (optional): `true`, `false`, or `"consolidate"` - Auto-balance matching
- `accounts` (optional): `"all"` or array like `["1234", "5678"]` for specific accounts

### Multiple Accounts Example

```json
{
  "discount": {
    "id": "your_id_number",
    "password": "your_bank_password",
    "num": "your_identification_code",
    "targets": [
      {
        "actualAccountId": "your_checking_account_id",
        "reconcile": true,
        "accounts": ["1234"]
      },
      {
        "actualAccountId": "your_savings_account_id",
        "reconcile": true,
        "accounts": ["5678"]
      }
    ]
  }
}
```

---

## 🔐 Security Notes

- **Never commit** config.json to version control
- Use **environment variables** for sensitive CI/CD pipelines
- Store config.json with restricted permissions: `chmod 600 config.json`
- Mount config.json as **read-only** in Docker: `:ro` flag

---

## 📚 Resources

- **israeli-bank-scrapers**: https://github.com/eshaham/israeli-bank-scrapers
- **Actual Budget**: https://actualbudget.org
- **Configuration Schema**: Based on [tomerh2001's schema](https://github.com/tomerh2001/israeli-banks-actual-budget-importer/blob/main/config.schema.json)
