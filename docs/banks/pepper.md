# Pepper (by Bank Leumi)

| Property | Value |
|----------|-------|
| Config key | `pepper` |
| Login fields | phoneNumber, password |
| 2FA / OTP | **required** |

Pepper is an API-direct bank (Bank Leumi's mobile-first bank): the importer
talks to the bank's mobile-app API instead of driving a browser. The first
run asks for one SMS code and enrolls the importer as a device on your Pepper
account. Later runs log in as that device, with no code.

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

This bank **requires** 2FA to enroll the importer as a device.

- **First run:** asks for one SMS code. Pepper then hands back a device state,
  which the importer saves in `bank-tokens.json` on the data volume, under
  `pepper-device:<entry name>`, such as `pepper-device:pepper`.
- **Later runs:** send the saved state and need no code. When the device's
  access expires, Pepper renews it with no code, and the importer saves the
  renewed state.
- **When Pepper refuses the saved state**, because it no longer knows the
  device or rejects the state itself, that run fails. The importer removes the
  state and warns
  `Removed the Pepper device state for <key>; the next run asks for one SMS code`.
  The next run enrolls again with one code.
- **When Pepper refuses the password**, after it accepted the device, that run
  fails and the state is kept. The importer warns
  `Kept the Pepper device state for <key>; Pepper refused the password, so check the password in the config`.
  Fix `password` on the entry, and the next run needs no code.
- **A failure that may pass keeps the state:** a timeout, rate limiting, a
  Cloudflare block page, a server error, a network error, any other refused
  login, or a refused data request. The next run tries the same state again.
- **Keep `twoFactorAuth: true`.** With it off, a run with no saved state cannot
  enroll: it warns
  `No Pepper device state for <key>, and this run cannot ask for an SMS code`
  and fails.
- **Changing `phoneNumber`**, or renaming the `banks` entry, costs one SMS: the
  saved state belongs to one phone number and one entry.
- The logs never show the state, and with a config password it is sealed in
  the file like every saved token.

To see what a run did, look for these log lines (`<key>` is
`pepper-device:<entry name>`):

| Log line | Meaning |
|---|---|
| `Using the stored Pepper device state for <key>` | The saved state was sent. |
| `Stored the Pepper device state for <key>` | A new or renewed state was saved. |
| `The stored Pepper device state for <key> belongs to another login` | The phone number changed; the run enrolls with one SMS. |
| `Removed the Pepper device state for <key>` | Pepper refused the state; the next run enrolls with one SMS. |
| `Kept the Pepper device state for <key>; Pepper refused the password` | Pepper accepted the device but refused `password`; fix it, and the next run needs no SMS. |
| `Could not remove the long-term token for <key>`, or `Could not remove the Pepper device state for <key>` | Pepper refused the state but the file kept it, so the next run sends it again; the warning names the cause. |
| `Could not store the long-term token for <key>`, or `Could not store the Pepper device state for <key>` | The run fails and keeps the previous state; check that `/app/data` is writable. |
| `Could not read the Pepper device state for <key>` | The file could not be read, so the run logs in with an SMS and saves nothing. |
| `The token file is damaged and holds no usable Pepper device state for <key>` | The run enrolls with one SMS. |
| `No login identity for <key>` | The entry has no phone number, so the run logs in with an SMS and saves nothing. |

You never need to delete the state by hand. To enroll again anyway, stop the
importer and delete the `pepper-device:<entry name>` key from
`bank-tokens.json`, leaving every other key as it is. With a config password
only the values are sealed, so the key is still there to delete. The next run
enrolls with one SMS.

Pepper no longer uses `otpLongTermToken`. An entry that sets one does not send
it, and the run warns
`The configured long-term token for pepper:<entry name> is not sent`.
Remove it from the entry. A long-term token an earlier release saved is not
sent either.

For automated SMS forwarding, see [OTP auto-forward](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md).

## Known gotchas

- `twoFactorAuth: true` is **always required** to enroll.
- Pepper uses the API-direct path — there is no browser session, so `clearSession` and Camoufox-related settings have no effect.
- The `phoneNumber` must be the one registered with Pepper; the bank rejects unknown numbers with an authentication error.
- Pepper skips products its transaction resolver cannot serve, principally unsupported non-ILS products. Other supported products continue importing instead of failing the entire scrape.
- Production crash signature `envelope selector miss: smsAssertionId at /data/control_flow/0/methods/*channels/?type=sms/assertion_id` indicates the auth response did **not** include the SMS channel. Two likely causes: (a) the `phoneNumber` was sent in an unsupported form (now fixed by normalisation at the credential boundary), or (b) the `password` is wrong — Pepper omits SMS from the available factors when uid/password is malformed.

## See also

- [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md) - full schema reference
- [Banks index](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/index.md) - all 19 banks
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
