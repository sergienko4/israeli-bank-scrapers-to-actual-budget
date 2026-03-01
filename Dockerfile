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
LABEL security.capabilities="SYS_ADMIN required for Chromium sandboxing"

# Install minimal system deps (fonts, certs)
# Playwright install chromium --with-deps handles browser-specific libs
# APT_CACHE_BUST is set by CI to force fresh packages on every release
ARG APT_CACHE_BUST=1
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    fonts-liberation \
    ca-certificates \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Update npm to latest version for security patches
# Patch minimatch in npm's bundled packages: CVE-2026-27903/CVE-2026-27904 (DoS, HIGH)
# npm bundles minimatch@10.2.2; fix is 10.2.3 — install globally and replace npm's copy
RUN npm install -g npm@latest \
    && npm install -g minimatch@10.2.3 \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/minimatch \
    && cp -r /usr/local/lib/node_modules/minimatch \
             /usr/local/lib/node_modules/npm/node_modules/minimatch

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Install Playwright Chromium with system dependencies
# Use shared path so both root (build) and node (runtime) can access it
ENV PLAYWRIGHT_BROWSERS_PATH=/app/browsers
RUN npx playwright install chromium --with-deps

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Note: config.json should be mounted as a volume at runtime, not copied into the image
# This prevents credentials from being baked into the Docker image

# Create directories for data persistence with proper ownership
# /app/logs is created here so the node user can write log files without a volume mount
RUN mkdir -p /app/data /app/cache /app/logs && \
    chown -R node:node /app/data /app/cache /app/logs /app/browsers && \
    chmod -R 755 /app/data /app/cache /app/logs /app/browsers

# Run as non-root user for security
USER node

# Security: Remove write permissions from application files
RUN chmod -R a-w /app/dist /app/node_modules 2>/dev/null || true

# Health check (basic process check)
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD ps aux | grep -q "[n]ode dist/scheduler.js" || exit 1

# Expose no ports (all communication via volumes and external APIs)
# This reduces attack surface

# Start the scheduler (which will run dist/index.js based on SCHEDULE env var)
CMD ["node", "dist/scheduler.js"]
