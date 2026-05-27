# Docker Compose

The recommended way to run the importer. The repo ships a `docker-compose.yml` that starts **both** Actual Budget and the importer as a single stack.

## Files in the repo

```text
docker-compose.yml          # Actual Budget + importer
config.json.example         # template — copy to config.json
```

## First-time setup

```bash
# 1. Start Actual Budget only
docker compose up -d actual-server

# 2. Open http://localhost:5006
#    - Sign in or create your account
#    - Create a budget
#    - Settings → Show Advanced Settings → Sync ID → copy

# 3. Edit config.json:
#      "serverURL": "http://actual-server:5006"   ← internal service name
#      "syncId": "<your Sync ID>"

# 4. Start the importer
docker compose up -d importer
```

## Daily operations

```bash
docker compose up -d                            # start everything
docker compose logs -f                          # tail logs
docker compose pull && docker compose up -d     # update both services
docker compose down                             # stop everything
```

## `serverURL` inside compose vs outside

- **Inside docker-compose:** `http://actual-server:5006` (internal Docker network DNS).
- **From a browser / standalone `docker run`:** `http://localhost:5006`.

## Customize schedule and timezone

Edit `docker-compose.yml`:

```yaml
services:
  importer:
    environment:
      - TZ=Asia/Jerusalem
      - SCHEDULE=0 */8 * * *    # Every 8 hours
```

## Persistence

Named volumes are used by default — data survives container recreation. To use host bind mounts instead, edit the `volumes:` block in `docker-compose.yml`:

```yaml
volumes:
  - ./config.json:/app/config.json:ro
  - ./data:/app/data
  - ./cache:/app/cache
  - ./chrome-data:/app/chrome-data
  - ./logs:/app/logs
```

## Health

```bash
docker compose ps        # both services up?
docker compose top       # process tree per container
docker compose stats     # CPU / mem / IO
```

For long-term operations, see [VM deployment](vm.md).
