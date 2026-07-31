# Config Portal

An optional, opt-in web portal to view/edit/add/remove your importer
configuration from a phone, tablet, or desktop — **without ever editing
`config.json` by hand or shelling into the container**. Disabled by default.

## Why use it

Normally you configure the importer by editing `config.json` (and the optional
`credentials.json`) on disk and re-deploying. On a server or in Docker that
means SSH-ing in, finding the mounted volume, hand-editing JSON, and getting the
secret split + encryption right. The portal replaces that with a safe, guided UI
you can reach over the network: it validates every change, masks and preserves
secrets, and writes the files back for you (settings to `config.json`, secrets
to `credentials.json`). The importer/scheduler reloads config on its next run,
so no restart is needed. (Changing the portal's **own** auth settings —
`authMode`, `passwordHash`, or `sessionSecret` — is the exception: the portal
reads those once at startup, so restart the portal for those to take effect.)

## Manifest-driven UI

The portal renders entirely from the project's [config manifest](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/getting-started/configuration.md#config-manifest-single-source-of-truth),
served at `GET /api/manifest`. Every section, field, bank option, and enum you
see is generated from that single source — so when a new config option is added
to the manifest it appears in the portal automatically, with no UI changes and
nothing to maintain in two places.

## Manage your banks

The **Banks** section is a searchable master–detail, so a long list of banks
never turns into an endless page scroll:

- **Search + pick from the left.** A bounded, scrollable list shows the full
  catalog of supported banks. Type in the search box to filter it.
- **✓ marks the banks you already configured.** Configured banks are flagged
  with a checkmark (matched case-insensitively, so a `oneZero`-style key still
  lines up with its `onezero` catalog entry — no accidental duplicates). Click a
  configured bank to review or edit it.
- **Click an unconfigured bank to add it.** Selecting a bank you have not set up
  yet templates its required fields and one empty target, then opens it for
  editing.
- **Edit on the right.** The detail pane shows only the selected bank's
  credentials, optional fields, and Actual targets, plus a Remove button. The
  first configured bank opens automatically when you enter the section.

## Enable

Add a `portal` block to `config.json` (or set `PORTAL_ENABLED=true`):

```json
"portal": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 8080,
  "authMode": "password"
}
```

Then start the portal entry point: `node dist/Portal.js`. Open
`http://localhost:8080`.

| Setting / env | Default | Purpose |
| --- | --- | --- |
| `enabled` / `PORTAL_ENABLED` | `false` | Opt-in switch; one of them must be set to start. |
| `host` / `PORTAL_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` exposes it on the network. |
| `port` / `PORTAL_PORT` | `8080` | Listen port. |
| `authMode` | `password` | `password`, `google`, or `both`. |
| `secureCookies` / `PORTAL_SECURE_COOKIES` | `false` | Mark cookies `Secure` (enable behind HTTPS). |
| `PORTAL_TRUST_PROXY` | `false` | Proxy hops to trust for `X-Forwarded-For`; set to `1` behind one reverse proxy so rate limits count the caller. |

> **Boot requirement:** the snippet above is not enough to start. Every mode
> needs a strong `sessionSecret` (≥16 characters), and `password`/`both` mode
> also needs a `passwordHash` — both in `credentials.json`. The portal **refuses
> to boot** without them (it will not start an un-loginable or forgeable portal).
> See **Authentication** below to set them; after the first boot the UI hashes
> new passwords for you.

## Run in Docker

The portal turns the importer's Docker deployment into a web-managed one: instead
of SSHing to the host and hand-editing JSON on the volume, you browse to the
portal and edit config there. Edits propagate to the importer on its next
scheduled run — no restart, no manual file surgery.

### Mount a config DIRECTORY, not single files

Both the importer and the portal read config from a **directory** mounted at
`/app/config` (holding `config.json` and the optional `credentials.json`), not
from individual single-file bind mounts. This is required, not cosmetic:

- The portal saves **atomically** — it writes a temp file, then renames it over
  the target. A rename swaps the file's *inode*.
- With a **single-file** bind mount, the importer container is pinned to the
  original inode, so it would **never see the portal's edits**, and the portal's
  rename can fail with `EBUSY` (you cannot rename over a mountpoint).
- With a **directory** mount, the rename happens normally inside the shared
  directory and every reader re-resolves the path on its next run, so edits
  propagate correctly.

Point the importer at the directory and tell it where the file lives:

```yaml
importer:
  environment:
    - CONFIG_PATH=/app/config/config.json   # default is /app/config.json
  volumes:
    - ./config:/app/config:ro               # READ-ONLY — the importer never writes
```

### Least privilege: importer reads, portal writes

Run the portal as a **separate service** that mounts the **same** directory
**read-write**, while the importer keeps it **read-only**. Each container gets
exactly the permission it needs — only the portal can ever modify your config:

```yaml
portal:
  image: sergienko4/israeli-bank-importer:latest
  container_name: israeli-bank-portal
  restart: unless-stopped
  command: ["node", "dist/Portal.js"]
  ports:
    - "8080:8080"
  environment:
    - PORTAL_ENABLED=true
    - PORTAL_HOST=0.0.0.0                    # listen on all interfaces inside the container
    - PORTAL_CONFIG_PATH=/app/config/config.json
    # - CREDENTIALS_ENCRYPTION_PASSWORD=your_encryption_password
  volumes:
    - ./config:/app/config:rw                # READ-WRITE — the portal is the only writer
```

- `credentials.json` rides along inside the same directory — no separate mount.
- `PORTAL_HOST=0.0.0.0` lets the container accept connections; the published
  port (`8080:8080`) is what you reach from your LAN at
  `http://<docker-host>:8080`.
- Always require auth (set a password or Google) before exposing the port — the
  portal can edit secrets.

> **Migrating from single-file mounts?** If you previously mounted
> `./config.json:/app/config.json`, create a `./config/` directory, move
> `config.json` (and `credentials.json`) into it, then switch to the directory
> mounts above plus `CONFIG_PATH`/`PORTAL_CONFIG_PATH`. The code still defaults
> to `/app/config.json`, so an existing single-file importer-only deployment
> keeps working — but the portal's saves only propagate with a directory mount.

## Expose over HTTPS

Editing secrets over plain HTTP is only safe on `localhost`. To reach the portal
from elsewhere, **terminate TLS at a reverse proxy** and keep the portal itself
behind it. The portal speaks HTTP; the proxy adds HTTPS.

Two common patterns:

- **Local-only:** leave `host: 127.0.0.1` (the default) and browse from the same
  machine, or tunnel to it (for example `ssh -L 8080:127.0.0.1:8080 user@host`).
  No ports are published; this is the safest default.
- **Network + HTTPS:** put a TLS reverse proxy (Caddy, Traefik, nginx) in front
  and set `PORTAL_SECURE_COOKIES=true` so session cookies are only sent over
  HTTPS.

A minimal Caddy example (`Caddyfile`) that fronts the portal with an automatic
Let's Encrypt certificate:

```text
portal.example.com {
    reverse_proxy portal:8080
}
```

```yaml
# add to docker-compose.yml alongside the `portal` service
caddy:
  image: caddy:2
  restart: unless-stopped
  ports:
    - "443:443"
    - "80:80"
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy-data:/data
  depends_on:
    - portal
```

With this in place:

- Keep the portal **unpublished** (drop its `ports:` mapping) so only Caddy can
  reach it on the internal Docker network.
- Set `PORTAL_SECURE_COOKIES=true` on the `portal` service (TLS is terminated by
  Caddy, so cookies must be marked `Secure`).
- Browse to `https://portal.example.com`.

> Set `secureCookies`/`PORTAL_SECURE_COOKIES=true` **only** when the browser
> reaches the portal over HTTPS. Over plain HTTP the browser drops `Secure`
> cookies and you will not stay logged in.

## Reach it from your phone with Tailscale

A reverse proxy on a public hostname means opening a port, renewing a
certificate, and accepting that anyone on the internet can knock on the login
page. If the portal only ever needs to be reachable by *you*, Tailscale is the
smaller answer: your devices join a private network, and `tailscale serve`
fronts the portal with HTTPS on a name only that network can resolve.

Run this on the host where the portal already listens on `127.0.0.1:8080`:

```bash
tailscale serve --bg 8080
```

Tailscale prints the resulting URL, of the form
`https://<node>.<tailnet>.ts.net/`. It terminates TLS with a certificate it
provisions for you, so the portal keeps speaking plain HTTP on loopback and
nothing is published to the internet.

Two settings must change, because the portal is now behind a proxy:

```bash
PORTAL_SECURE_COOKIES=true   # the browser is on HTTPS; cookies must say Secure
PORTAL_TRUST_PROXY=1         # exactly one hop (tailscale serve) sits in front
```

`PORTAL_TRUST_PROXY` is what makes the per-IP rate limits count the phone that
made the request rather than the proxy that forwarded it. Without it every
caller shares one bucket, so one device retrying a login can lock out the rest.
Set it to the number of proxies in front of the portal — `1` for `tailscale
serve` alone — and leave it unset when nothing is in front, because trusting
`X-Forwarded-For` with no proxy to rewrite it lets any caller invent an address
and walk past the limits entirely.

| Setting / env | Value behind `tailscale serve` | Why |
| --- | --- | --- |
| `host` / `PORTAL_HOST` | `127.0.0.1` | The proxy connects over loopback; nothing else should. |
| `PORTAL_SECURE_COOKIES` | `true` | The browser speaks HTTPS, so cookies must be `Secure`. |
| `PORTAL_TRUST_PROXY` | `1` | One hop to trust, so limits count the real caller. |

> Use `tailscale serve`, not `tailscale funnel`. Funnel publishes the same URL
> to the whole internet, which gives back every exposure the reverse-proxy
> section was trying to avoid.

### Register the Tailscale URL with Google

If `authMode` is `google` or `both`, Google must be told to accept the new
callback. In the Google Cloud console, under the OAuth client's **Authorized
redirect URIs**, add:

```text
https://<node>.<tailnet>.ts.net/auth/google/callback
```

Then set the same value as `portal.google.redirectUri` in your config, because
Google compares it byte for byte against what the portal sends.

Google will accept this URI: it is HTTPS, it is a hostname rather than a raw IP
address, and `ts.net` is on the public suffix list. A bare LAN address such as
`https://192.168.1.20:8080/...` is rejected for exactly those reasons, which is
part of why Tailscale is the easier route for Google sign-in.

## Authentication

`authMode` is one of:

- **password** — a single shared password (default; fully offline).
- **google** — Google sign-in restricted to an allow-list of emails.
- **both** — Google first, then the password (two factors).

### Password

Generate a hash (the plaintext is read from `PORTAL_PASSWORD` or piped stdin —
never from a command-line argument, so it can't leak via shell history or the
process list):

```bash
PORTAL_PASSWORD='your-password' node scripts/hash-portal-password.js
# or, to keep it out of the environment as well:
printf '%s' 'your-password' | node scripts/hash-portal-password.js
```

Put the printed `scrypt$…` value in `credentials.json` under
`portal.passwordHash`, and set a random `portal.sessionSecret` (16+ characters).

> **Tip:** This manual hash only bootstraps the **first** password. Once the
> portal is running, setting or changing the password in the UI hashes it for
> you automatically on save — you never paste a hash again.

### Google

Google mode lets a chosen set of Google accounts sign in. You create an OAuth
client once in Google Cloud, then point the portal at it.

#### 1. Create a Google OAuth client

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   or create a project.
2. Go to **APIs & Services → OAuth consent screen**. Choose **External**, give
   the app a name and your support email, and add yourself under **Test users**
   (External apps stay in "testing" until verified — test users can still sign
   in). The portal only requests the `openid` and `email` scopes.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
4. Choose **Web application**.
5. Under **Authorized redirect URIs**, add the portal callback URL exactly as
   users will reach it:
   - Local: `http://localhost:8080/auth/google/callback`
   - Behind HTTPS: `https://portal.example.com/auth/google/callback`
6. Click **Create** and copy the **Client ID** and **Client secret**.

#### 2. Configure the portal

Put the non-secret parts in `config.json`:

```json
"portal": {
  "enabled": true,
  "authMode": "google",
  "google": {
    "clientId": "1234567890-abc.apps.googleusercontent.com",
    "redirectUri": "https://portal.example.com/auth/google/callback",
    "allowedEmails": ["you@gmail.com", "spouse@gmail.com"]
  }
}
```

Put the **secret** in `credentials.json`:

```json
"portal": {
  "google": { "clientSecret": "GOCSPX-your-client-secret" }
}
```

- `redirectUri` **must** match one of the Authorized redirect URIs above,
  character for character (scheme, host, port, path).
- Only emails in `allowedEmails` may sign in; everyone else is rejected after
  Google verifies them. The list **must not be empty** for `google`/`both` mode:
  the portal treats an empty allow-list as un-loginable and **refuses to boot**,
  rather than starting a portal nobody can sign into.
- Use `authMode: "both"` to require Google **and** the portal password.

#### Advanced: override the Google endpoints

The portal talks to Google's public endpoints by default. Two env vars let you
point it at a different OpenID-Connect-style provider or a local stub:

| Env var | Default |
| --- | --- |
| `GOOGLE_AUTH_BASE` | `https://accounts.google.com/o/oauth2/v2/auth` |
| `GOOGLE_TOKEN_URL` | `https://oauth2.googleapis.com/token` |

This seam is what the automated end-to-end tests use: CI starts a local
fake-Google server and drives the **entire** browser flow (click *Continue with
Google* → consent → callback → email allow-list → app), so the Google path is
validated on every pull request with no real Google account or network access.
The same flow works unchanged against real Google once the client above is set.

#### Validate a real Google client in CI (optional secrets)

The fake-Google flow proves the *portal code* works. To additionally prove that
**your real OAuth client** is configured correctly (client id/secret valid and
the redirect URI registered), the E2E pipeline runs a secret-gated smoke,
`scripts/google-oauth-smoke.mjs`. It never opens a browser — it asks Google's
token endpoint to exchange a deliberately invalid code with your real
credentials and asserts Google's reply:

- `invalid_grant` → **pass** (credentials + redirect URI are recognised; only
  the throwaway code was rejected),
- `invalid_client` → fail (client id/secret wrong),
- `redirect_uri_mismatch` → fail (redirect URI not registered).

Add these repository secrets (**Settings → Secrets and variables → Actions**) to
turn it on; when any is missing the smoke self-skips so forks stay green:

| Secret | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Your OAuth client id (`…apps.googleusercontent.com`). |
| `GOOGLE_CLIENT_SECRET` | The matching client secret (`GOCSPX-…`). |
| `GOOGLE_REDIRECT_URI` | A redirect URI registered on the client, e.g. `http://127.0.0.1:8088/auth/google/callback`. |

The client secret is read only from the environment and is never printed. Run it
locally the same way: `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REDIRECT_URI=… npm run smoke:google-config`.

## API access for apps and scripts (bearer tokens)

The portal's REST API (`/api/*`) powers the web UI, but it is also a stable
surface for **native apps and scripts** — including the companion mobile config
app. Browsers authenticate with a session **cookie**; a non-browser client
authenticates with a **bearer token** instead. The `/api` guard accepts either.

### Get a token

`POST /auth/token` with the portal password returns a signed token:

```bash
curl -sX POST http://127.0.0.1:8080/auth/token \
  -H 'content-type: application/json' \
  -d '{"password":"your-portal-password"}'
# → {"token":"<opaque-token>"}
```

A wrong, empty, or non-string password returns `401`, and the route is
rate-limited exactly like `/auth/login`.

In `authMode: "both"` this route returns `409` instead of a token. A password
alone can never satisfy `both`, so a token minted from one would be rejected by
every `/api` call that followed — the route says so up front rather than handing
back a credential that only looks valid. A client that needs `both` signs in
through `/auth/app/authorize`, where the second factor can actually be
collected.

### The app sign-in asks before it hands over a code

`/auth/app/authorize` does not mint a code the moment an authorized browser
reaches it. It answers with a page naming the device that is asking, and only
the Approve button on that page produces the code.

The step exists because the redirect target is a custom scheme
(`bankimporter://auth`). Any app on the phone can register that scheme, and PKCE
does not help when the person who wrote the link also chose the challenge — they
hold the verifier. Without the approval, opening a crafted link in a browser
that is already signed in to the portal would mint a code and hand it to
whichever app answers the scheme.

The approval is signed by the portal, tied to that exact request, and expires
after five minutes, so a link cannot carry one that was issued for something
else. This narrows the window rather than closing it: a person who approves
anyway has approved. Closing it entirely needs a verified HTTPS redirect target,
which is not available when the address belongs to the operator.

### Use the token

Send it as an `Authorization: Bearer` header on any `/api/*` request:

```bash
TOKEN=...   # the value returned by /auth/token
curl -s http://127.0.0.1:8080/api/config -H "authorization: Bearer $TOKEN"
```

`GET /auth/status` accepts the same header, so a client can check whether its
token is still valid before making a call.

### Read import status

`GET /api/status` returns the recent import runs (per-bank outcome, transaction
count, duration, and timestamp) from the importer's audit log:

```bash
curl -s http://127.0.0.1:8080/api/status -H "authorization: Bearer $TOKEN"
# → {"runs":[{"timestamp":"…","banks":[{"name":"leumi","status":"success","txns":3}]}]}
```

The importer writes the audit log and the portal reads it, so both must agree on
the file. Set **`AUDIT_LOG_PATH`** to a path on a **shared volume** (for example
`/app/config/audit-log.json`) on both the importer and the portal service; it
defaults to `/app/data/audit-log.json`. The payload is a redacted summary — no
account numbers, transaction details, or credentials.

### Register for push notifications

`POST /api/devices` with `{ "token": "ExponentPushToken[…]" }` registers the
mobile app for push; `DELETE /api/devices` with the same body unregisters it.
On each import the importer sends a redacted result to every registered device
via Expo Push. Set **`DEVICE_TOKENS_PATH`** to a shared-volume path (for example
`/app/config/devices.json`) on both the portal (writer) and the importer
(reader), and keep `notifications.enabled: true`.

### Token lifetime and security

- **Short-lived by design.** A bearer token is the portal's stateless,
  HMAC-signed session token, and it expires 15 minutes after it is issued. The
  browser cookie is a separate, longer-lived token; neither is accepted in the
  other's place.
- **Rotation evicts tokens.** The token embeds a fingerprint of the credentials
  in force when it was issued, so changing the portal password (or the Google
  allow-list) immediately invalidates every outstanding token — the client must
  request a new one.
- **`password` mode is the right fit for scripts.** In `both` mode this route
  refuses (`409`), because a header-only client has no way to satisfy the Google
  factor. Use `authMode: "password"` for scripts, or the app sign-in flow at
  `/auth/app/authorize` for anything that can open a browser.
- Store the token in the platform secret store (Keychain / Keystore), never in
  plain text.

### Reaching a self-hosted portal from a phone

The API can edit bank secrets, so **never publish its port to the internet**.
Reach your own importer over a **private tunnel** instead:

- **Tailscale (recommended):** install it on the importer host and on your phone,
  then front the portal with `tailscale serve --bg 8080` and connect to the
  `https://<node>.<tailnet>.ts.net/` URL it prints. Traffic is encrypted
  end-to-end with no publicly exposed ports. See *Reach it from your phone with
  Tailscale* above for the `PORTAL_SECURE_COOKIES` and `PORTAL_TRUST_PROXY`
  settings it needs.
- **TLS reverse proxy:** if you must expose it, front it with HTTPS (see *Expose
  over HTTPS* above) and set `PORTAL_SECURE_COOKIES=true`.

## Security

- Binds `127.0.0.1` by default; set `host`/`PORTAL_HOST=0.0.0.0` to expose, and
  only do so behind auth + HTTPS.
- Secrets are masked in the UI and preserved on save unless you change them.
- Saves are split into `config.json` (settings) + `credentials.json` (secrets);
  credentials are re-encrypted when `CREDENTIALS_ENCRYPTION_PASSWORD` is set.
- Session cookies are HMAC-signed with `sessionSecret`; the portal refuses to
  start on a missing/weak secret (under 16 chars or a known placeholder).
- Sessions are bound to the credentials in force when you signed in: changing the
  portal password or the Google `allowedEmails` list immediately invalidates every
  existing session, so a rotated password or a revoked account cannot keep using an
  already-issued cookie (users must sign in again).
- The `/api` also accepts **bearer tokens** (`POST /auth/token`) for native apps
  and scripts — see *API access for apps and scripts* above. Expose that surface
  only over a private tunnel (Tailscale) or a TLS proxy; never publish it to the
  internet.
