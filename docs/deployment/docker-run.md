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

Drop `--rm`, add `--restart unless-stopped`, and run detached:

```bash
docker run -d \
  --name israeli-bank-importer \
  --restart unless-stopped \
  --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Jerusalem \
  -e SCHEDULE="0 */8 * * *" \
  sergienko4/israeli-bank-importer
```

## Hardened defaults

```bash
docker run -d \
  --name israeli-bank-importer \
  --restart unless-stopped \
  --cap-drop ALL \
  --cap-add SYS_ADMIN \
  --security-opt no-new-privileges:true \
  --tmpfs /dev/shm:size=256m \
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
