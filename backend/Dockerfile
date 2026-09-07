# ── SK Agent — Render-ready Dockerfile ────────────────────────────────────────
# Base: Node 20 on Debian Bullseye (has apt, needed for Chromium)
FROM node:20-bullseye-slim

# Install Chromium + all libs Puppeteer needs
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

# Tell Puppeteer to use the system Chromium, not download its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Copy package files first (layer cache — only reinstalls if package.json changes)
COPY package*.json ./

# Install dependencies (no dev deps in production)
RUN npm ci --omit=dev

# Copy source
COPY . .

# Render assigns PORT via env var
EXPOSE 3001

# Run as non-root for security (Puppeteer --no-sandbox is set in client.js)
RUN groupadd -r skagent && useradd -r -g skagent -G audio,video skagent \
    && mkdir -p /home/skagent/Downloads \
    && chown -R skagent:skagent /home/skagent \
    && chown -R skagent:skagent /app

USER skagent

CMD ["node", "src/index.js"]
