# Oracle Cloud (free tier)

Oracle Cloud's "Always Free" ARM Ampere VMs work great for the importer — but the network egress to Israeli banks is slow enough that default scraper timeouts trip up Amex, Isracard, and Visa Cal. This guide documents the tuning that's reliably worked.

## Provision the VM

- Ampere A1 (ARM): `2 OCPU / 12 GB RAM` free tier is plenty.
- Ubuntu 22.04 or 24.04 LTS.
- Open the inbound port for Actual Budget UI (e.g. 5006) only to your IP — or skip it and reverse-proxy via Cloudflare Tunnel.

## Install Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
exit && ssh ...   # reconnect for group membership
```

## Tune per-bank scraper

The default `timeout` of 30 000 ms is too tight from many Oracle Cloud regions to Israeli WAFs. Set higher per-bank values for the heaviest banks:

```json
"amex": {
  "id": "...",
  "card6Digits": "...",
  "password": "...",
  "timeout": 60000,
  "navigationRetryCount": 2,
  "daysBack": 14,
  "targets": [...]
},
"isracard": {
  "id": "...",
  "card6Digits": "...",
  "password": "...",
  "timeout": 60000,
  "navigationRetryCount": 2,
  "daysBack": 14,
  "targets": [...]
},
"visaCal": {
  "username": "...",
  "password": "...",
  "timeout": 60000,
  "navigationRetryCount": 2,
  "daysBack": 14,
  "targets": [...]
}
```

| Option | Default | Oracle Cloud value |
|--------|---------|---------------------|
| `timeout` | 30 000 ms | **60 000 ms** for Amex / Isracard / Visa Cal |
| `navigationRetryCount` | 0 | **2** for all three |

## Rate limiting

Increase the inter-bank delay to give the IP some quiet time between scrapes — Oracle Cloud public IPs sometimes look bot-ish to Israeli bank WAFs:

```json
"delayBetweenBanks": 5000
```

## Resources

ARM Ampere has plenty of RAM but limited single-thread performance. Camoufox is happy on Ampere; expect each bank to take 20–40 % longer than on x86. Allow that in your `SCHEDULE` cadence — every 8 hours is comfortable; every 2 hours back-to-back is risky.

## See also

- [Bank options — scraper tuning](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md#scraper-tuning)
- [Rate limiting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/rate-limiting.md)
- [Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/troubleshooting.md)
