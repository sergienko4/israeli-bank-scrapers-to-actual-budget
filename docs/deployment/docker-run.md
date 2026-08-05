# Docker Run (single container)

Use this when you already have Actual Budget running elsewhere (different host, different stack, managed instance, etc.) and only want the importer container.

## Pull and run

```bash
docker pull sergienko4/israeli-bank-importer
```

=== "Linux / macOS"

    ```bash
    docker run --rm --cap-add SYS_ADMIN \
      -v $(pwd)/config.json:/app/config.json:ro \
      -v $(pwd)/data:/app/data \
      -v $(pwd)/cache:/app/cache \
      -v $(pwd)/chrome-data:/app/chrome-data \
      -v $(pwd)/logs:/app/logs \
      -e TZ=Asia/Jerusalem \
      -e SCHEDULE="0 */8 * * *" \
      sergienko4/israeli-bank-importer
    ```

=== "Windows (PowerShell)"

    ```powershell
    docker run --rm --cap-add SYS_ADMIN `
      -v "${PWD}\config.json:/app/config.json:ro" `
      -v "${PWD}\data:/app/data" `
      -v "${PWD}\cache:/app/cache" `
      -v "${PWD}\chrome-data:/app/chrome-data" `
      -v "${PWD}\logs:/app/logs" `
      -e TZ=Asia/Jerusalem `
      -e SCHEDULE="0 */8 * * *" `
      sergienko4/israeli-bank-importer
    ```

The container entrypoint is `node dist/Index.js`.

## Production (long-running)

Drop `--rm`, add `--restart unless-stopped`, cap the memory, and run detached:

```bash
docker run -d \
  --name israeli-bank-importer \
  --restart unless-stopped \
  --cap-add SYS_ADMIN \
  --memory 2g \
  --memory-swap 2g \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Jerusalem \
  -e SCHEDULE="0 */8 * * *" \
  sergienko4/israeli-bank-importer
```

`--memory` is not optional for a long-running deployment. Without a cgroup
ceiling a stalled scrape can consume every byte of host RAM before the kernel
reclaims it — see
[Hardened defaults](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/docker-run.md#hardened-defaults)
for the sizing.

## Hardened defaults

```bash
docker run -d \
  --name israeli-bank-importer \
  --restart unless-stopped \
  --cap-drop ALL \
  --cap-add SYS_ADMIN \
  --security-opt no-new-privileges:true \
  --tmpfs /dev/shm:size=256m \
  --memory 2g \
  --memory-swap 2g \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Jerusalem \
  -e SCHEDULE="0 */8 * * *" \
  sergienko4/israeli-bank-importer
```

| Flag | Why |
|------|-----|
| `--cap-drop ALL` + `--cap-add SYS_ADMIN` | Drop every Linux capability except the one Camoufox needs for sandboxing |
| `--security-opt no-new-privileges:true` | Block setuid escalation |
| `--tmpfs /dev/shm:size=256m` | Firefox-family browsers stream to `/dev/shm`; allocate it explicitly |
| `--memory 2g` + `--memory-swap 2g` | Cap the container so a stalled scrape can never exhaust host RAM. Sized from measurements: ~200 MB Node + ~1 GB worst-case bank browser + ~300 MB OCR + headroom. `--max-old-space-size` is not a substitute — it caps only the JS heap, and most of the footprint is native browser memory |

## Memory sizing

Banks are scraped one child process at a time, so the ceiling is set by the
single heaviest bank — not by how many banks you configure. Thirteen banks need
the same 2 GB as one.

A measured end-to-end run of the heaviest bank inside a `--memory 2g` container
peaks at ~1.2 GB and settles back to ~400 MB between banks.

> **Keep `NODE_ENV=production`.** Outside production the scraper library
> attaches a `pino-pretty` transport, which starts a `thread-stream` worker
> thread owning a 4 MB `SharedArrayBuffer` and a `process` exit listener. On
> scraper 8.6.2 the root logger was cached only when a log file was configured,
> so a fresh worker leaked on *every log call* — one bank reached 14.3 GB RSS
> before the kernel OOM-killed it. Scraper 8.6.3 caches the root logger per
> destination and fixes that at source; pinning production additionally keeps
> the pretty transport, and its worker, out of the container.

`NODE_ENV=production` silences the *scraper library's* own log output. The
importer's logging is independent and still honours `LOG_LEVEL`, so
`-e LOG_LEVEL=trace` continues to produce full importer traces.

## Volumes reference

| Mount | Purpose | Required |
|-------|---------|----------|
| `/app/config.json` | Bank credentials + Actual Budget connection | Yes (mount `:ro`) |
| `/app/data` | Actual Budget local sync data | Yes |
| `/app/cache` | Scraper run cache | Recommended |
| `/app/chrome-data` | Legacy browser session (no-op with Camoufox v7.9.0+) | Optional |
| `/app/logs` | Rotating log files | Required for `/logs` Telegram command |

## See also

- [Schedule cheat sheet](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/scheduling.md)
- [Docker Compose setup](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/docker-compose.md)
- [Synology Container Manager](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/synology.md)
- [Oracle Cloud free tier](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/oracle-cloud.md)
