# Upgrading

`CHANGELOG.md` lists every change. This page lists only the ones where an
**existing deployment stops behaving the way it used to** unless you change your
configuration — the changes that need a human before or after `docker pull`.

If a version is not listed here, upgrading to it needs no action beyond pulling
the new image.

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
