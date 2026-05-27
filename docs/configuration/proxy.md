# Proxy

!!! warning "Not yet wired"
    Proxy support is **not currently wired** to Camoufox (scraper v7.9.0+). The config keys below are preserved for forward compatibility and will be honored once the scraper library re-adds proxy passthrough.

## Configuration

In `config.json`:

```json
"proxy": {
  "server": "socks5://localhost:1080"
}
```

Or via environment variable:

```bash
PROXY_SERVER=socks5://localhost:1080
```

## Supported protocols (when wired)

- `socks5://host:port`
- `socks4://host:port`
- `http://host:port`
- `https://host:port`

## Workaround today

If a proxy is essential, run the entire container behind a network-level proxy:

```yaml
# docker-compose.yml
services:
  importer:
    networks:
      - via-proxy
networks:
  via-proxy:
    driver: bridge
    # configure your bridge / VPN / gluetun upstream
```

Or use [gluetun](https://github.com/qdm12/gluetun) as a sidecar container and route the importer through its network namespace.

See [issue tracker](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues) for the current status of native proxy support.
