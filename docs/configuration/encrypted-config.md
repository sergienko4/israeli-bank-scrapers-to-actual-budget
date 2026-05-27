# Encrypted Config

Protect credentials by encrypting any config file at rest. The importer auto-detects encrypted files and decrypts them in memory.

## Encryption parameters

- **Algorithm:** AES-256-GCM
- **Key derivation:** PBKDF2-SHA256 with 200,000 iterations
- **Salt:** 16 bytes (random per file)
- **IV (nonce):** 12 bytes (random per file)
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

## Split config (recommended)

Separate secrets from settings:

- `credentials.json` — passwords, tokens, bank IDs (**encrypt this**)
- `config.json` — daysBack, targets, formats (safe to commit / share)

`credentials.json` is deep-merged into `config.json` at startup. See [`credentials.json.example`](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/credentials.json.example).

## Operational tips

- Store the password in a secret manager (HashiCorp Vault, AWS SSM, etc.) and inject via `--env-file`.
- `chmod 600 config.json` + `:ro` mount inside Docker so even root inside the container can't write to it.
- Never commit `config.json` or `credentials.json` — both are in `.gitignore`. Commit only `*.example` templates.
