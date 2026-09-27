# Upgrading

`CHANGELOG.md` lists every change. This page lists only the ones where an
**existing deployment stops behaving the way it used to** unless you change your
configuration — the changes that need a human before or after `docker pull`.

If a version is not listed here, upgrading to it needs no action beyond pulling
the new image.

---

## 1.43.0 — Portal files, config reads and the encryption password

**Affects:** deployments that run the [config portal](configuration/portal.md),
deployments that set `CREDENTIALS_ENCRYPTION_PASSWORD` to an empty value beside
`CONFIG_PASSWORD`, and deployments whose config file is not plain UTF-8. Each
section below names who it affects.

### Upgrade the importer and the portal together

**Affects:** deployments that run the portal.

The import history, `devices.json` and the portal's app sign-ins
(`app-tokens.json`) are now saved as a JSON object instead of a bare list. This
release reads the old lists, so the upgrade loses nothing. A rollback does: an
earlier release reads the new files as empty, so every phone is signed out of
the app, and an older portal that registers a device rewrites `devices.json`
with only that device.

**Migration:** pull the same release for both services, and do not roll back.
See
[Upgrade both services together](configuration/portal.md#upgrade-both-services-together).

### The portal shares the data volume, which needs hard links

**Affects:** deployments that run the portal, and deployments that use the app
OTP channel.

The importer and the portal pass OTP codes, the OTP channel, push device tokens
and the import history through the data volume, so the portal must mount it at
`/app/data`. The least-privilege compose example before this release did not.

App OTP requests now live in one file per request, and each file is published
with a hard link, so two writers never replace each other's file. Local disks
and Docker volumes have hard links; an SMB/CIFS share such as Azure Files does
not. There a bank login that asks for an app code fails with a storage error
(it does not fall back to Telegram), and the portal answers a submitted code
with 500. A request pending during the upgrade is not carried over: the bank
login waiting for it times out, and the next import asks again.

**Migration:** add the importer's data volume to the portal service, at the same
path (`importer-data:/app/data` in `docker-compose.yml`), and keep it off
SMB/CIFS. See
[Least privilege](configuration/portal.md#least-privilege-importer-reads-portal-writes).

### An empty `CREDENTIALS_ENCRYPTION_PASSWORD` no longer hides `CONFIG_PASSWORD`

**Affects:** deployments that set `CREDENTIALS_ENCRYPTION_PASSWORD` to an empty
string and `CONFIG_PASSWORD` to a password. `CREDENTIALS_ENCRYPTION_PASSWORD=`
in an env file does this, and so does `${CREDENTIALS_ENCRYPTION_PASSWORD}` in a
compose file on a host without that variable.

Up to 1.42.25 the empty value won, so nothing was encrypted. It now counts as
unset, and `CONFIG_PASSWORD` is used. For such a deployment encryption turns on:
the next portal save encrypts `credentials.json`, and the long-term bank tokens
this release saves are sealed under the password.

**Migration:** none if you want encryption; keep the password safe, because the
files cannot be read without it. To stay unencrypted, remove `CONFIG_PASSWORD`.

### A config file that cannot be read stops the start

**Affects:** deployments whose `config.json` or `credentials.json` is not a
regular UTF-8 file of at most 8 MiB.

Up to 1.42.25 a file in another encoding loaded with its unreadable characters
replaced, which could silently change a stored password. The importer and the
portal now refuse it and name the file. Only a missing `config.json` still means
"run from environment variables".

**Migration:** save the file as UTF-8. The other errors are listed in
[Troubleshooting](troubleshooting.md#the-importer-or-portal-stops-at-startup-on-a-config-read-error).

---

## 1.42.19 — Hapoalim charges import as outflows (scraper 8.6.10)

**Affects:** deployments that import **Bank Hapoalim**. No other institution is
affected, and no configuration change is required.

### What changed

Hapoalim reports an amount as an unsigned magnitude and puts the direction in a
separate numeric field (`eventActivityTypeCode`: 1 = money in, 2 = money out).
Up to scraper 8.6.9 that field was not read, so **every Hapoalim charge was
imported as a positive amount** — spending appeared in Actual Budget as income.
Scraper 8.6.10 reads the direction, so charges now import as outflows.

New imports are correct from the first run on this version. The rows already in
your budget are not rewritten, so some history needs a look.

### Symptom if you skip the migration

Only already-imported Hapoalim rows are wrong, and they go wrong in **two
different ways** depending on when they were written:

- **Recently imported rows** are matched on a fingerprint that includes the
  amount. The corrected charge no longer matches, so it arrives as a **new
  row** and you end up with a pair for the same purchase — one positive, one
  negative — which double-counts in reports until the positive one is removed.
- **Older rows** are matched on the bank's own reference number, which does not
  contain the amount. The corrected charge matches the row that is already
  there, so it is treated as an existing transaction and **the amount is not
  updated**. There is no duplicate to notice: the original positive row simply
  stays wrong.

Because the second case leaves a single row rather than a pair, looking only for
duplicate pairs will miss it.

Two side effects are worth knowing about:

- **Spending alerts change.** Alerts only ever considered outflows, so Hapoalim
  spending was invisible to them while it was stored as income. It now counts,
  and thresholds that were never reached may start firing. This is the intended
  behaviour, not a regression.
- **Reconciliation balances shift** for Hapoalim accounts, since the sum of the
  transactions changes.

### Migration

Filter the Hapoalim account in Actual Budget to the period you have been
importing and sort by amount:

- Where a purchase appears **twice** with the same date and merchant — once
  positive, once negative — delete the **positive** row.
- Where a purchase appears **once** as a positive amount, correct its sign in
  place.

Do this before relying on Hapoalim figures in reports or spending alerts.

Do **not** use `--cleanup-card-refunds` for this. That command exists for a
different, credit-card-only defect and assumes the *negative* row of a pair is
the wrong one — the opposite of this case, so it would delete the corrected row
and keep the wrong one. It only reads accounts used exclusively by card
issuers, and from 1.42.19 it explicitly skips any account shared with a
non-card bank and says so in its output.

---

## 1.42.12 — `PORTAL_TRUST_PROXY` no longer accepts a proxy hop count

**Affects:** deployments that run the [config portal](configuration/portal.md)
behind a reverse proxy **and** set `PORTAL_TRUST_PROXY` (or `portal.trustProxy`)
to a **number**. The most common case is `PORTAL_TRUST_PROXY=1` behind
`tailscale serve` — the value this documentation recommended before 1.42.12.

Deployments that never set `PORTAL_TRUST_PROXY`, or that already set it to an
address such as `loopback`, need no action.

### What changed

Fastify 5.12.1 removed the numeric "trust N proxy hops" form of `trustProxy`.
The form was withdrawn because it trusted `X-Forwarded-*` headers on **every**
connection rather than only on connections coming from the proxy, which let any
caller that could reach the port claim any source address
([GHSA-3m5p-2c4r-xxw2][fastify-proxy-advisory]).

The importer follows upstream rather than working around it: a numeric value is
refused, and the portal trusts no forwarded header until you name the address
the proxy connects **from**.

### Symptom if you skip the migration

The portal still starts and still serves requests — this fails safe, not loud.
What you lose is per-caller attribution: every request is credited to the proxy's
own address instead of the device that made it, so the per-IP rate limits
collapse into a single shared bucket. One busy device can then exhaust the login
limiter for **everyone**.

The portal says so at boot:

```text
⚠️  PORTAL_TRUST_PROXY is set to a proxy hop count, a form Fastify removed in
5.12.1 because it trusted X-Forwarded-For on every connection regardless of who
opened it (GHSA-3m5p-2c4r-xxw2). The portal is therefore trusting no forwarded
header, so every caller now shares one rate-limit bucket. Name the proxy's own
address instead: `loopback` behind `tailscale serve`, or an IP/CIDR such as
10.0.0.0/8.
```

A value that is neither a number nor a parseable address logs the companion
`PORTAL_TRUST_PROXY was set to a value the portal could not parse` warning and
behaves the same way.

### Migration

Replace the hop count with the address the proxy connects from:

| Your topology | Before | After |
| --- | --- | --- |
| Proxy on the same host (`tailscale serve`, host-network sidecar) | `PORTAL_TRUST_PROXY=1` | `PORTAL_TRUST_PROXY=loopback` |
| Proxy in another container on the Docker network | `PORTAL_TRUST_PROXY=1` | `PORTAL_TRUST_PROXY=172.18.0.0/16` (that network's subnet) |
| Proxy on another machine | `PORTAL_TRUST_PROXY=1` | `PORTAL_TRUST_PROXY=10.0.0.5` (its address) |
| Two chained proxies | `PORTAL_TRUST_PROXY=2` | `PORTAL_TRUST_PROXY=loopback,10.0.0.5` (one entry per hop) |
| No reverse proxy | unset or `false` | leave as is |

Accepted entries are the named subnets `loopback`, `linklocal` and
`uniquelocal`, a plain IPv4/IPv6 address, or a CIDR block — singly or as a
comma-separated list.

Trust only what actually fronts the portal. `PORTAL_TRUST_PROXY=0.0.0.0/0`
technically parses, but it hands the forwarded header back to every caller and
reintroduces exactly the spoofing this change removed.

### Verifying the fix

1. Restart the container and confirm neither `PORTAL_TRUST_PROXY` warning
   appears in the boot log.
2. Fail a portal login from two different devices. Each should get its own
   remaining-attempts count; if one device's failures consume the other's
   budget, the forwarded address is still not being trusted.

[fastify-proxy-advisory]: https://github.com/fastify/fastify/security/advisories/GHSA-3m5p-2c4r-xxw2
