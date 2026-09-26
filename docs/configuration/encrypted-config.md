# Encrypted Config

Protect credentials by encrypting any config file at rest. The importer auto-detects encrypted files and decrypts them in memory.

## Encryption parameters

- **Algorithm:** AES-256-GCM
- **Key derivation:** PBKDF2-SHA512 with 100,000 iterations
- **Salt:** 32 bytes (random per file)
- **IV (nonce):** 16 bytes (random per file)
- **Auth tag:** 16 bytes (verified before decrypt)

## Encrypt

```bash
npm run build
CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/encrypt-config.js
```

By default, this encrypts `config.json`. To encrypt only credentials:

```bash
CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/encrypt-config.js credentials.json
```

## Decrypt (for editing)

```bash
CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/decrypt-config.js
# … edit the file …
CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/encrypt-config.js
```

## Use in Docker

Pass the password via environment variable:

```yaml
# docker-compose.yml
services:
  importer:
    environment:
      - CREDENTIALS_ENCRYPTION_PASSWORD=mypassword
```

```bash
# docker run
docker run -e CREDENTIALS_ENCRYPTION_PASSWORD=mypassword ...
```

Or via the legacy `CONFIG_PASSWORD` env var (still supported for backward compatibility).

## Long-term bank tokens

The same password seals the long-term tokens that OneZero, Pepper and PayBox
logins save in `bank-tokens.json` on the data volume. The importer seals each
record itself; do not run `encrypt-config.js` on that file, or the importer
reads it as damaged.

- Turning the password on or off, or changing it, costs one SMS login per
  account, once, so keep `twoFactorAuth: true` for that run. If the old file
  is still there, the run warns `The token file is damaged …`; either way it
  saves a new token.
- An encrypted `config.json` or `credentials.json` still needs its own
  password: a missing or wrong one stops the run at startup, before any token
  is read. Decrypt the config, or re-encrypt it under the new password, before
  you turn the password off or change it.
- When you turn it on, delete `bank-tokens.json` from the data volume: its
  plain-text tokens can no longer be used. Otherwise the file stays as it is
  until the next saved token sets it aside as `bank-tokens.json.quarantined-*`,
  which you then delete.

The [token store design](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/architecture/bank-token-store.md)
shows the sealed layout.

## Split config (recommended)

Separate secrets from settings:

- `credentials.json` — passwords, tokens, bank IDs (**encrypt this**)
- `config.json` — daysBack, targets, formats (safe to commit / share)

`credentials.json` is deep-merged into `config.json` at startup. See [`credentials.json.example`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/credentials.json.example).

## Operational tips

- Store the password in a secret manager (HashiCorp Vault, AWS SSM, etc.) and inject via `--env-file`.
- `chmod 600 config.json` + `:ro` mount inside Docker so even root inside the container can't write to it.
- Never commit `config.json` or `credentials.json` — both are in `.gitignore`. Commit only `*.example` templates.
