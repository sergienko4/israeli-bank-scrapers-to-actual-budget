# Use Node.js 22 LTS (required by israeli-bank-scrapers)
# Using slim variant for smaller image size
# Pin to digest for reproducibility and security
FROM node:22-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94

# Security labels and metadata
LABEL maintainer="Israeli Bank Importer Contributors"
LABEL org.opencontainers.image.title="Israeli Bank Importer"
LABEL org.opencontainers.image.description="Import transactions from 18 Israeli banks into Actual Budget"
LABEL org.opencontainers.image.source="https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.url="https://hub.docker.com/r/sergienko4/israeli-bank-importer"
LABEL org.opencontainers.image.documentation="https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget#readme"
LABEL org.opencontainers.image.vendor="Israeli Bank Importer Contributors"
LABEL security.capabilities="Camoufox (Firefox) runs without SYS_ADMIN"

# Install minimal system deps (fonts, certs, Firefox/Camoufox libs)
# APT_CACHE_BUST is set by CI to force fresh packages on every release
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
    && apt-get clean

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Update npm to latest, then refresh ALL npm-bundled packages to @latest.
# npm ships its own private node_modules (minimatch, tar, etc.) that are independent
# of our project deps and can't be updated via npm update. The proven fix: install
# each package globally at @latest, then replace npm's bundled copy.
# Add new packages to the install line whenever Trivy flags a new npm-bundled CVE.
RUN npm install -g npm@latest \
    && npm install -g minimatch@latest tar@latest \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/minimatch \
    && cp -r /usr/local/lib/node_modules/minimatch \
             /usr/local/lib/node_modules/npm/node_modules/minimatch \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/tar \
    && cp -r /usr/local/lib/node_modules/tar \
             /usr/local/lib/node_modules/npm/node_modules/tar

# Install ALL project dependencies (devDependencies included for build).
# npm update --no-save brings every dep to its latest patch version within
# the semver ranges declared in package.json — picks up security fixes
# without requiring a manual lock-file update in the repo.
RUN npm install \
    && npm update --no-save

# Install Camoufox browser (Firefox-based anti-detect)
# CI pre-downloads the binary into .camoufox-cache/ for amd64 smoke test only.
# Production multi-arch build (amd64+arm64) fetches fresh per-platform via npx.
# ELF e_machine check validates the binary matches the build architecture.
ARG SKIP_BROWSER_FETCH=false
COPY .camoufox-cache/ /tmp/camoufox-precache/

RUN ARCH=$(uname -m) && \
    echo "Building for architecture: $ARCH" && \
    if [ "$SKIP_BROWSER_FETCH" = "true" ] && [ "$ARCH" = "x86_64" ] && \
       [ -f /tmp/camoufox-precache/camoufox-bin ] && [ -f /tmp/camoufox-precache/version.json ]; then \
      echo "Using pre-cached Camoufox binary (x86_64)" && \
      mkdir -p /home/node/.cache/camoufox && \
      cp -r /tmp/camoufox-precache/* /home/node/.cache/camoufox/; \
    else \
      echo "Fetching Camoufox for $ARCH..." && \
      npx @hieutran094/camoufox-js fetch && \
      mkdir -p /home/node/.cache && \
      mv /root/.cache/camoufox /home/node/.cache/camoufox; \
    fi && \
    rm -rf /tmp/camoufox-precache && \
    echo "Validating Camoufox binary for $ARCH..." && \
    head -c 4 /home/node/.cache/camoufox/camoufox-bin | grep -qP '\x7fELF' || \
      (echo "ERROR: Camoufox binary is not a valid ELF executable" && exit 1) && \
    EXPECTED_MACHINE=$([ "$ARCH" = "aarch64" ] && echo "b7 00" || echo "3e 00") && \
    ACTUAL_MACHINE=$(od -An -tx1 -j18 -N2 /home/node/.cache/camoufox/camoufox-bin | tr -d ' \n') && \
    EXPECTED_HEX=$(echo "$EXPECTED_MACHINE" | tr -d ' ') && \
    [ "$ACTUAL_MACHINE" = "$EXPECTED_HEX" ] || \
      (echo "ERROR: ELF e_machine mismatch — expected $EXPECTED_HEX ($ARCH) got $ACTUAL_MACHINE" && exit 1) && \
    chmod +x /home/node/.cache/camoufox/camoufox-bin && \
    echo "Camoufox binary validated OK ($ARCH, e_machine=$ACTUAL_MACHINE)"

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --omit=dev

# Note: config.json should be mounted as a volume at runtime, not copied into the image
# This prevents credentials from being baked into the Docker image

# Create directories for data persistence with proper ownership
# /app/logs is created here so the node user can write log files without a volume mount
RUN mkdir -p /app/data /app/cache /app/logs && \
    chown -R node:node /app/data /app/cache /app/logs /home/node/.cache/camoufox && \
    chmod -R 755 /app/data /app/cache /app/logs /home/node/.cache/camoufox

# Run as non-root user for security
USER node

# Security: Remove write permissions from application files
RUN chmod -R a-w /app/dist /app/node_modules 2>/dev/null || true

# Health check (basic process check)
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD ps aux | grep -q "[n]ode dist/Scheduler.js" || exit 1

# Expose no ports (all communication via volumes and external APIs)
# This reduces attack surface

# Start the scheduler (which will run dist/Index.js based on SCHEDULE env var)
CMD ["node", "dist/Scheduler.js"]
