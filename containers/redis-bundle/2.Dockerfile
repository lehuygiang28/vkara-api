FROM oven/bun:alpine AS build

WORKDIR /app

# Copy dependencies and source files
COPY package.json bun.lockb tsconfig.json ./
COPY ./src ./src

# Install dependencies
RUN bun install

ENV NODE_ENV=production

# Build the application
RUN bun run build2

# --- Production stage ---
FROM ghcr.io/puppeteer/puppeteer:16.1.0 AS production

WORKDIR /app

USER root

# Prepare application directory
RUN mkdir -p /app && chown pptruser:pptruser /app

# Copy built server files
COPY --from=build --chown=pptruser:pptruser /app/server2 ./server

# Fix GPG error for Google Chrome repository
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# Install Redis
RUN apt-get update && apt-get install -y lsb-release curl gpg && \
    curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" > /etc/apt/sources.list.d/redis.list && \
    apt-get update && apt-get install -y redis && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Supervisor
RUN apt-get update && apt-get install -y supervisor && \
    chmod +x /usr/bin/supervisord /usr/bin/redis-server && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Prepare Supervisor configuration and scripts
COPY --chown=pptruser:pptruser ./containers/redis-bundle/supervisord.conf ./supervisord.conf
COPY --chown=pptruser:pptruser ./containers/redis-bundle/entrypoint.sh ./entrypoint.sh

# Set permissions for scripts and log files
RUN chmod +x ./entrypoint.sh && \
    touch /app/supervisord.pid /app/supervisord.log && \
    chown pptruser:pptruser /app/supervisord.pid /app/supervisord.log && \
    chmod 644 /app/supervisord.conf /app/supervisord.log /app/supervisord.pid && \
    mkdir -p ./log && chown pptruser:pptruser ./log

# Set application permissions
RUN chmod +x /app/server && \
    chown pptruser:pptruser /app && \
    chown pptruser:pptruser /home/pptruser && \
    mkdir -p /home/pptruser/Downloads && \
    chown pptruser:pptruser /home/pptruser/Downloads

RUN bun x puppeteer browsers install chrome

ENV NODE_ENV=production

USER pptruser

ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 8001
