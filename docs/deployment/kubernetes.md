# Kubernetes

Run the importer as a `CronJob` (run-once on a schedule) or a `Deployment` (long-running with internal cron). The `CronJob` pattern is more idiomatic for Kubernetes and avoids the `SCHEDULE` env var.

## Pattern 1 — `CronJob` (recommended)

Let Kubernetes own the schedule; let the importer be a one-shot job.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: israeli-bank-importer
spec:
  schedule: "0 */8 * * *"
  timeZone: "Asia/Jerusalem"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        spec:
          restartPolicy: OnFailure
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            runAsGroup: 1000
          containers:
            - name: importer
              image: sergienko4/israeli-bank-importer:latest
              imagePullPolicy: IfNotPresent
              securityContext:
                allowPrivilegeEscalation: false
                capabilities:
                  drop:
                    - ALL
                  add:
                    - SYS_ADMIN
                readOnlyRootFilesystem: false
              env:
                - name: TZ
                  value: Asia/Jerusalem
                - name: CREDENTIALS_ENCRYPTION_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: importer-encryption
                      key: password
              volumeMounts:
                - name: config
                  mountPath: /app/config.json
                  subPath: config.json
                  readOnly: true
                - name: data
                  mountPath: /app/data
                - name: cache
                  mountPath: /app/cache
                - name: logs
                  mountPath: /app/logs
                - name: shm
                  mountPath: /dev/shm
          volumes:
            - name: config
              secret:
                secretName: importer-config
            - name: data
              persistentVolumeClaim:
                claimName: importer-data
            - name: cache
              emptyDir: {}
            - name: logs
              emptyDir: {}
            - name: shm
              emptyDir:
                medium: Memory
                sizeLimit: 256Mi
```

## Pattern 2 — `Deployment` (long-running)

Use this if you want to keep the Telegram bot's long-polling alive 24/7.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: israeli-bank-importer
spec:
  replicas: 1
  strategy:
    type: Recreate          # never run two pollers at once
  selector:
    matchLabels: { app: israeli-bank-importer }
  template:
    metadata:
      labels: { app: israeli-bank-importer }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
      containers:
        - name: importer
          image: sergienko4/israeli-bank-importer:latest
          env:
            - name: TZ
              value: Asia/Jerusalem
            - name: SCHEDULE
              value: "0 */8 * * *"
            - name: CREDENTIALS_ENCRYPTION_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: importer-encryption
                  key: password
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
              add: [SYS_ADMIN]
          volumeMounts:
            - { name: config, mountPath: /app/config.json, subPath: config.json, readOnly: true }
            - { name: data,   mountPath: /app/data }
            - { name: cache,  mountPath: /app/cache }
            - { name: logs,   mountPath: /app/logs }
            - { name: shm,    mountPath: /dev/shm }
      volumes:
        - name: config
          secret: { secretName: importer-config }
        - name: data
          persistentVolumeClaim: { claimName: importer-data }
        - name: cache
          emptyDir: {}
        - name: logs
          emptyDir: {}
        - name: shm
          emptyDir: { medium: Memory, sizeLimit: 256Mi }
```

## Secrets

Use [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) or [SOPS](https://github.com/getsops/sops) for credentials in Git. Never commit raw `config.json`.

```bash
# Plain config-from-file (development)
kubectl create secret generic importer-config \
  --from-file=config.json=./config.json

# Production: encrypt with sealed-secrets or sops first
```

## Health and observability

- Container logs → stdout (`logConfig.format: "json"` for Loki/ELK ingestion).
- Annotate the namespace for Prometheus pod-scrape if you front the importer with a sidecar metrics exporter (not bundled — see [Roadmap](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/ROADMAP.md)).

## See also

- [Encrypted config](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/encrypted-config.md) (recommended even with k8s secrets)
- [Scheduling](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/scheduling.md)
- [Logging](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/logging.md)
