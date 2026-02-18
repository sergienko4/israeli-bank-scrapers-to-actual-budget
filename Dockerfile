# Use Node.js 22 (required by israeli-bank-scrapers)
FROM node:22-slim

# Install dependencies for Chromium (required by israeli-bank-scrapers)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY index.js scheduler.js ./

# Note: config.json should be mounted as a volume at runtime, not copied into the image
# This prevents credentials from being baked into the Docker image

# Create directories for data persistence
RUN mkdir -p /app/data /app/cache /app/chrome-data && \
    chmod 777 /app/data /app/cache /app/chrome-data

# Run as non-root user
USER node

# Start the scheduler (which will run index.js based on SCHEDULE env var)
CMD ["node", "scheduler.js"]
