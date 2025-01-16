FROM oven/bun:alpine AS build

WORKDIR /app

COPY package.json package.json
COPY bun.lockb bun.lockb
COPY ./tsconfig.json ./tsconfig.json
COPY ./src ./src

RUN bun install

ENV NODE_ENV=production

RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile server \
    ./src/index.ts

# Use a Debian/Ubuntu-based image for production
FROM node:22 AS production

USER root
WORKDIR /app

RUN mkdir -p /app && \
    chown node:node /app
COPY --chown=node:node --from=build /app/server server
RUN chmod +x /app/server && \
    chown node:node /app/server

# Replace apk with apt-get for package installation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    supervisor redis && \
    rm -rf /var/lib/apt/lists/*

COPY --chown=node:node ./containers/redis-bundle/supervisord.conf ./supervisord.conf
COPY --chown=node:node ./containers/redis-bundle/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create necessary files and directories with proper permissions
RUN touch /app/supervisord.pid && \
    chown node:node /app/supervisord.pid && \
    touch /app/supervisord.log && \
    chown node:node /app/supervisord.log && \
    chmod 755 /app/supervisord.conf && \ 
    chmod 644 /app/supervisord.log && \
    chmod 644 /app/supervisord.pid && \
    mkdir -p ./log && \
    chown node:node ./log

RUN chown node:node /app
RUN npm i -g bun puppeteer
RUN npx puppeteer browsers install --platform=linux --install-deps

ENV NODE_ENV=production

USER node

ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 8000
