# Local validation stack

Runs the importer and its portal in Docker against a throwaway budget, then
reads the result from the phone app on an Android emulator. It exists to answer
one question end to end: **does a run whose banks all fail reach the app?**

That is the bug PR #637 fixes. Every layer between the failure and the phone —
the audit log, `GET /api/status`, the app's Status screen — is exercised here
against real containers rather than mocked in a unit test.

## What it proves

Leg A is the dry-run wiring proof:

```text
docker compose -f tests/e2e/local-stack/docker-compose.yml run --rm importer-dryrun
```

The pipeline completes and writes **no** audit entry.

Leg B is the fix proof:

```text
docker compose -f tests/e2e/local-stack/docker-compose.yml run --rm importer-fail
```

Every bank fails, one audit entry is written per bank, `/api/status` serves
them, and the app renders them in red.

Leg A is the wiring proof and leg B is the fix proof. They are separate because
**a dry run cannot exercise this fix**: `recordFailedRun` returns early when
`ctx.state.isDryRun` is set, exactly as `FinalizeImportStep` skips recording for
dry runs. A dry-run-only validation would pass identically with and without the
fix and would prove nothing.

Leg B never contacts a bank and never uses a real credential. The mock scraper
reads the failure fixtures in `fixtures/`, so it is as safe as a dry run while
still travelling the real recording path.

## Running it

From the repository root:

```bash
# 1. Throwaway budget + generated importer config.
npm run test:e2e:setup

# 2. Portal config and credentials for the stack (writes stack-config/, .env).
node tests/e2e/local-stack/setup.mjs

# 3. Importer image (see "Why an overlay image" below).
npm run build
docker build -f tests/e2e/local-stack/Dockerfile.overlay \
  --build-arg BASE_VERSION=v1.42.11 -t israeli-bank-importer:e2e .

# 4. Portal.
docker compose -f tests/e2e/local-stack/docker-compose.yml up -d portal

# 5. Leg A, then leg B.
docker compose -f tests/e2e/local-stack/docker-compose.yml run --rm importer-dryrun
docker compose -f tests/e2e/local-stack/docker-compose.yml run --rm importer-fail

# 6. Read what the app would read.
node tests/e2e/local-stack/status.mjs
```

`status.mjs` signs in and prints the run history:

```text
runs: 2
  2026-08-21T07:25:34.992Z  FAILED  0%  0/1 ok  txns=0
      e2eTestBank: failure — Error: simulated login failure
  2026-08-21T07:25:35.549Z  FAILED  0%  0/1 ok  txns=0
      e2eTestBank2: failure — Error: simulated timeout
```

Two entries of one bank each, not one entry of two banks: every bank runs in its
own child process, so each records its own failed run.

### Proving the fix rather than assuming it

Build the same image from `main` and run leg B against it. The audit log does
not grow.

Build from a detached worktree so the comparison never touches your working
tree:

```bash
git fetch origin main
git worktree add /tmp/before origin/main
npm --prefix /tmp/before ci
npm --prefix /tmp/before run build
docker build -f tests/e2e/local-stack/Dockerfile.overlay \
  -t israeli-bank-importer:e2e-before /tmp/before
git worktree remove /tmp/before
```

Then point the `importer-fail` service at `israeli-bank-importer:e2e-before`
and run leg B again.

Observed: entries before the run `2`, after the run `2`. With the fix the same
run adds one entry per bank.

## Validating in the app

The app refuses plain HTTP — `normalizeBaseUrl` rejects `http://` outright so
that shipped code never has to switch off a platform protection. The stack
therefore fronts the portal with TLS and installs the CA where the app will
trust it.

```powershell
pwsh tests/e2e/local-stack/make-certs.ps1     # CA + cert with SAN IP:10.0.2.2
docker compose -f tests/e2e/local-stack/docker-compose.yml up -d tls
pwsh tests/e2e/local-stack/install-ca.ps1     # CA into the emulator's system store
```

Then in the app: enter `https://10.0.2.2:8443`, sign in with the password
printed by `setup.mjs`, approve, and open **Status**. Each failed run appears in
red with its per-bank reason.

`10.0.2.2` is the host as seen from the emulator. `install-ca.ps1` patches the
system store rather than the user store because the app ships no network
security config that opts into user certificates — the correct default, and not
something a test should change in the app.

## Why an overlay image

`Dockerfile.overlay` starts from the published `sergienko4/israeli-bank-importer`
image and copies a host-built `dist/` over it, instead of building from source.

The repository `Dockerfile` is not at fault and CI builds it normally. On a
network that cannot reach `registry.npmjs.org` — the TLS handshake is refused
outright — the CVE-patching layer cannot run, and `--network=host` does not help
because the host is blocked too. The overlay needs no registry at all.

Two consequences worth knowing:

- The base image's dependencies are those of its tag, so a working tree that has
  bumped a dependency runs against the older one. Immaterial here (the failure
  path is pure application code and the mock scraper replaces the scraper
  entirely), but it means this stack is a validation tool, not a release
  artifact.
- Keep `BASE_VERSION` matched to `package.json`. A mismatched base pairs new
  `dist/` output with older `node_modules`.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Portal, TLS proxy, and the two importer legs |
| `Dockerfile.overlay` | Importer image built without a registry |
| `setup.mjs` | Portal config + credentials for the stack |
| `status.mjs` | Reads `/api/status` the way the app does |
| `make-certs.ps1` | Throwaway CA and server certificate |
| `install-ca.ps1` | Installs the CA into the emulator's system trust store |
| `nginx.conf` | TLS termination in front of the portal |
| `fixtures/*.json` | Mock scraper responses that fail every bank |

`certs/`, `stack-config/` and `.env` are generated and git-ignored; the CA
private key must never be committed.

## Cleaning up

```bash
docker compose -f tests/e2e/local-stack/docker-compose.yml down
```

The emulator's patched trust store is tmpfs-backed and disappears when the
emulator restarts.
