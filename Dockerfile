# Use Node.js 26 (current release line; LTS from October 2026).
# Runtime dependencies set a floor, not a ceiling: israeli-bank-scrapers
# requires >= 22.14.0 and @actual-app/api requires >= 20, so 26 satisfies both.
# Using slim variant for smaller image size
# Pin to digest for reproducibility and security
#
# Two stages on the same pinned base. The build stage holds npm 12,
# devDependencies, the TypeScript build and the Camoufox install; the runtime
# stage copies out only what the app runs. A single-stage build shipped every
# layer it ever wrote: Camoufox (1.2 GB) three times and the devDependency
# tree once, about 2.5 GB compressed. Both FROM lines must stay identical
# (tests/deployment/DockerImageLayout.test.ts).
FROM node:26-slim@sha256:deae974a69e140f44f434ab29cb519fb5f8fe250fd364b8ca446bd0761acdc6a AS build

WORKDIR /app

# Build with npm 12. The npm 11 bundled with the base image only warns
# about the package.json allowScripts allowlist and still runs every
# dependency install script. better-sqlite3 v13 ships prebuilt binaries,
# yet npm 11 still runs a default `node-gyp rebuild` for it, which fails
# because the image has no Python. npm 12 enforces the allowlist and skips
# that build (see docs/CONTRIBUTING.md). The exact version is pinned so
# builds are reproducible and no npm release changes install behaviour
# unreviewed. npm 12 lives only in this build stage, and the runtime stage
# deletes the base image's npm, so no npm reaches the final image.
# lockfile-sync.yml installs this same version
# (.github/actions/ci/pin-npm reads the line below), so keep it one exact
# x.y.z with no quotes.
ARG NPM_VERSION=12.2.1
RUN npm install -g "npm@${NPM_VERSION}" \
    && echo "Using npm $(npm --version)" \
    && if [ "$(npm --version)" != "${NPM_VERSION}" ]; then \
         echo "ERROR: expected npm ${NPM_VERSION}, got $(npm --version)" >&2; \
         exit 1; \
       fi

# Install ALL project dependencies (devDependencies included for build).
# npm ci installs exact versions from package-lock.json, giving reproducible
# builds. Dependency updates are managed by Dependabot (weekly grouped PRs
# with full CI validation before merge).
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Install the Camoufox browser (Firefox-based anti-detect): the build pinned
# in config/camoufox-pin.json, never upstream's newest. CI installs it on the
# runner (.github/actions/docker/camoufox-cache) and an amd64 build with
# SKIP_BROWSER_FETCH=true copies that from .camoufox-cache/; every other build
# (arm64, local) downloads it with the pinned installer, which checks its
# SHA-256. Both paths must pass --verify, so a stale precache cannot ship, and
# the ELF e_machine check confirms the binary matches the build architecture.
# The final modes are set here, inside the same RUN: a later chmod/chown RUN
# would rewrite the whole 1.2 GB tree into another layer.
ARG SKIP_BROWSER_FETCH=false
COPY .camoufox-cache/ /tmp/camoufox-precache/
COPY config/camoufox-pin.json ./config/camoufox-pin.json
COPY scripts/camoufox-fetch.mjs scripts/camoufox-pin-logic.mjs scripts/camoufox-pinned-fetcher.mjs ./scripts/

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN set -e; \
    ARCH=$(uname -m); \
    export CAMOUFOX_INSTALL_DIR=/home/node/.cache/camoufox; \
    echo "Building for architecture: $ARCH"; \
    if [ "$SKIP_BROWSER_FETCH" = "true" ] && [ "$ARCH" = "x86_64" ] && \
       [ -f /tmp/camoufox-precache/camoufox-bin ] && [ -f /tmp/camoufox-precache/version.json ]; then \
      echo "Using pre-cached Camoufox binary (x86_64)"; \
      mkdir -p "$CAMOUFOX_INSTALL_DIR"; \
      cp -r /tmp/camoufox-precache/* "$CAMOUFOX_INSTALL_DIR"/; \
    else \
      echo "Installing the pinned Camoufox for $ARCH..."; \
      node scripts/camoufox-fetch.mjs; \
    fi; \
    rm -rf /tmp/camoufox-precache; \
    echo "Validating Camoufox binary for $ARCH..."; \
    node scripts/camoufox-fetch.mjs --verify; \
    BIN="$CAMOUFOX_INSTALL_DIR/camoufox-bin"; \
    if ! head -c 4 "$BIN" | grep -qP '\x7fELF'; then \
      echo "ERROR: Camoufox binary is not a valid ELF executable"; exit 1; \
    fi; \
    EXPECTED_HEX=$([ "$ARCH" = "aarch64" ] && echo "b700" || echo "3e00"); \
    ACTUAL_MACHINE=$(od -An -tx1 -j18 -N2 "$BIN" | tr -d ' \n'); \
    if [ "$ACTUAL_MACHINE" != "$EXPECTED_HEX" ]; then \
      echo "ERROR: ELF e_machine mismatch — expected $EXPECTED_HEX ($ARCH) got $ACTUAL_MACHINE"; exit 1; \
    fi; \
    chmod -R 755 "$CAMOUFOX_INSTALL_DIR"; \
    echo "Camoufox binary validated OK ($ARCH, e_machine=$ACTUAL_MACHINE, $(cat "$CAMOUFOX_INSTALL_DIR/version.json"))"

# Copy source code and build config
COPY src ./src
COPY config/tsc-strict-src.sh ./config/tsc-strict-src.sh

# Build TypeScript, then drop devDependencies so only the production tree
# is copied into the runtime stage.
RUN npm run build && npm prune --omit=dev

# Runtime stage: same pinned base as the build stage.
FROM node:26-slim@sha256:deae974a69e140f44f434ab29cb519fb5f8fe250fd364b8ca446bd0761acdc6a

# Security labels and metadata
LABEL maintainer="Israeli Bank Importer Contributors"
LABEL org.opencontainers.image.title="Israeli Bank Importer"
LABEL org.opencontainers.image.description="Import transactions from 19 Israeli banks into Actual Budget"
LABEL org.opencontainers.image.source="https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.url="https://hub.docker.com/r/sergienko4/israeli-bank-importer"
LABEL org.opencontainers.image.documentation="https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget#readme"
LABEL org.opencontainers.image.vendor="Israeli Bank Importer Contributors"
LABEL security.capabilities="Camoufox (Firefox) runs without SYS_ADMIN"

# SHELL is per stage. The shell-form HEALTHCHECK below runs through it, so
# the runtime stage repeats the build stage's bash + pipefail.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# One Camoufox layer, owned by node with the modes set in the build stage.
# It comes before the apt layer so APT_CACHE_BUST (a fresh value on every CI
# run) does not invalidate the largest layer in any build cache.
COPY --from=build --chown=node:node /home/node/.cache/camoufox /home/node/.cache/camoufox

# Install minimal system deps (fonts, certs, Firefox/Camoufox libs)
# APT_CACHE_BUST is set by CI to force fresh packages on every release
#
# The same RUN removes the package managers bundled with the base image.
# The runtime only runs `node`, but npm ships a private dependency tree that
# Trivy scans and that app updates cannot patch, so every CVE in it (for
# example postcss-selector-parser, code-scanning alert #37) needed a manual
# image patch. Deleting npm, npx, corepack and yarn removes that tree.
#
# It also creates the data directories with node ownership; /app/logs lets
# the node user write log files without a volume mount. ~/.cache stays
# root-owned as before: BuildKit creates it for the Camoufox COPY with the
# --chown owner, the legacy builder as root.
ARG APT_CACHE_BUST=1
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    fonts-liberation \
    ca-certificates \
    curl \
    libgtk-3-0 \
    libx11-xcb1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/corepack \
              /usr/local/bin/yarn /usr/local/bin/yarnpkg \
              /opt/yarn-* \
    && if command -v npm || command -v npx || command -v corepack \
          || command -v yarn; then \
         echo "ERROR: a package manager is still on PATH" >&2; exit 1; \
       fi \
    && mkdir -p /app/data /app/cache /app/logs \
    && chown node:node /app/data /app/cache /app/logs \
    && chmod 755 /app/data /app/cache /app/logs \
    && chown root:root /home/node/.cache \
    && chmod 755 /home/node/.cache

WORKDIR /app

# Runtime files only. package.json carries "type": "module" for dist/.
# src/Portal/Public is served by the config portal; tsc does not copy it
# into dist/, so PortalServer falls back to the source path.
# The application files stay root-owned, so the node user cannot modify them.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/Portal/Public ./src/Portal/Public

# Note: config.json should be mounted as a volume at runtime, not copied into the image
# This prevents credentials from being baked into the Docker image

# Run as non-root user for security
USER node

# Production logging mode.
# Scraper 8.7.1 only attaches its pino-pretty transport when PRETTY_LOGS=true.
# Keep that opt-in disabled to avoid its worker thread in long-running
# containers. Override PRETTY_LOGS only for a short diagnostic run.
# See docs/deployment/docker-run.md before overriding this.
ENV NODE_ENV=production
ENV PRETTY_LOGS=false

# Health check (basic process check)
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD ps aux | grep -q "[n]ode dist/Scheduler.js" || exit 1

# Expose the optional config-portal port (only used when portal.enabled/PORTAL_ENABLED)
EXPOSE 8080

# Start the scheduler (which will run dist/Index.js based on SCHEDULE env var)
CMD ["node", "dist/Scheduler.js"]
