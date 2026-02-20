# Supported Israeli Banks & Credit Cards

Complete list of all supported financial institutions and their required credentials.

---

## Supported Institutions

| Institution | Config key | Login fields |
|-------------|-----------|-------------|
| Bank Hapoalim | `hapoalim` | userCode, password |
| Bank Leumi | `leumi` | username, password |
| Discount Bank | `discount` | id, password, num |
| Mizrahi Tefahot | `mizrahi` | username, password |
| Mercantile | `mercantile` | id, password, num |
| Otsar Hahayal | `otsarHahayal` | username, password |
| Union | `union` | username, password |
| Beinleumi | `beinleumi` | username, password |
| Massad | `massad` | username, password |
| Yahav | `yahav` | username, nationalID, password |
| Beyahad Bishvilha | `beyahadBishvilha` | id, password |
| Behatsdaa | `behatsdaa` | id, password |
| Pagi | `pagi` | username, password |
| One Zero | `oneZero` | email, password, phoneNumber |
| Visa Cal | `visaCal` | username, password |
| Max | `max` | username, password |
| Isracard | `isracard` | id, card6Digits, password |
| Amex | `amex` | id, card6Digits, password |

---

## Per-Institution Config Examples

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

### Mizrahi Tefahot
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

### Mercantile
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

### Otsar Hahayal
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

### Union
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

### Yahav
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

### Beyahad Bishvilha
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

### Behatsdaa
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

### One Zero
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
**Note:** OneZero requires OTP authentication. See [2FA configuration](../README.md#-2fa-onezero) in the README.

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

### Amex
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

---

## Common Configuration Options

All institutions support these additional options:

### startDate or daysBack
```json
{
  "startDate": "2026-01-19"
}
```
Or use relative days:
```json
{
  "daysBack": 14
}
```
Cannot use both on the same bank. `daysBack` max: 30. `startDate` max: 1 year back.

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
- `actualAccountId` (required): Target account ID in Actual Budget (UUID format)
- `reconcile` (optional): `true` or `false` (default: `false`) — auto-balance matching
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

## Security Notes

- **Never commit** config.json to version control
- Use **environment variables** for sensitive CI/CD pipelines
- Store config.json with restricted permissions: `chmod 600 config.json`
- Mount config.json as **read-only** in Docker: `:ro` flag

---

## Resources

- **israeli-bank-scrapers**: https://github.com/eshaham/israeli-bank-scrapers
- **Actual Budget**: https://actualbudget.org
