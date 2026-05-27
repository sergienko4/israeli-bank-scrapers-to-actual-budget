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
| `phoneNumber` | Phone number registered for SMS OTP (e.g. `+972501234567`). |

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

After the first successful login, capture the value of `otpLongTermToken` from the logs and add it back to `config.json` to skip OTP on future runs.

For automated SMS forwarding, see [OTP auto-forward](../OTP-AUTOFORWARD.md).

## Known gotchas

`twoFactorAuth: true` is **always required** on first login. After the first successful run, copy the value of `otpLongTermToken` from the logs and persist it in `config.json` to skip OTP on future runs.

## See also

- [Bank options](../configuration/banks.md) - full schema reference
- [Banks index](index.md) - all 18 banks
- [Troubleshooting](../troubleshooting.md)
