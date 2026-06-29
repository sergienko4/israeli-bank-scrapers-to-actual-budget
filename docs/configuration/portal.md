# Config Portal

An optional, opt-in web portal to view/edit/add/remove your importer
configuration from phone, tablet, or desktop. Disabled by default.

## Enable

Add to `config.json` (or set `PORTAL_ENABLED=true`):

```json
"portal": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 8080,
  "authMode": "password"
}
```

Then run the portal entry point: `node dist/Portal.js` (or the `portal` service
in `docker-compose.yml`). Open `http://localhost:8080`.

## Authentication

`authMode` is one of:

- **password** — a single shared password (default).
- **google** — Google sign-in restricted to allow-listed emails.
- **both** — Google first, then the password (two steps).

### Password

```bash
node scripts/hash-portal-password.js "your-password"
```

Put the printed `scrypt$…` value in `credentials.json` → `portal.passwordHash`,
and set a random `portal.sessionSecret`.

### Google

Create an OAuth client (redirect `http://<host>:8080/auth/google/callback`).
Put `clientId`, `redirectUri`, and `allowedEmails` in `config.json`; put
`clientSecret` in `credentials.json` → `portal.google.clientSecret`.

## Security

- Binds `127.0.0.1` by default; set `host`/`PORTAL_HOST=0.0.0.0` to expose.
- Secrets are masked in the UI and preserved on save unless changed.
- Saves are split into `config.json` (settings) + `credentials.json` (secrets);
  credentials are re-encrypted when `CREDENTIALS_ENCRYPTION_PASSWORD` is set.
