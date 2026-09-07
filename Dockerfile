# ── SK Agent — Render-ready Dockerfile ────────────────────────────────────────
# Sits at repo ROOT so Render finds it automatically on first deploy.
# Build context is also the repo root — COPY paths are relative to repo root.

FROM node:20-bullseye-slim

# Install Chromium + all libs Puppeteer needs on Debian
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium, not download its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy backend package files first (layer cache)
COPY backend/package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy backend source
COPY backend/src ./src

# Run as non-root (Puppeteer --no-sandbox is already set in client.js)
RUN groupadd -r skagent && useradd -r -g skagent skagent \
    && chown -R skagent:skagent /app
USER skagent

EXPOSE 3001
CMD ["node", "src/index.js"]
