FROM oven/bun:alpine AS build

WORKDIR /app

COPY package.json package.json
COPY bun.lockb bun.lockb
COPY ./tsconfig.json ./tsconfig.json

COPY ./src ./src

RUN bun install

ENV NODE_ENV=production

RUN bun run build2

FROM ghcr.io/puppeteer/puppeteer:16.1.0 AS production

WORKDIR /app

USER root

RUN mkdir -p /app && \
    chown pptruser:pptruser /app
COPY --from=build --chown=pptruser:pptruser  /app/server2 server

RUN  apt-get install lsb-release curl gpg && \
    curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg && \
    chmod 644 /usr/share/keyrings/redis-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/redis.list && \
    apt-get update && \
    apt-get install redis

RUN apt-get update && \
    apt-get install -y supervisor redis-server && \
    chmod +x /usr/bin/supervisord && \
    chmod +x /usr/bin/redis-server && \
    chown pptruser:pptruser /usr/bin/supervisord && \
    chown pptruser:pptruser /usr/bin/redis-server

RUN chmod +x /app/server && \
    chown pptruser:pptruser /app/server

COPY --chown=pptruser:pptruser ./containers/redis-bundle/supervisord.conf ./supervisord.conf
COPY --chown=pptruser:pptruser ./containers/redis-bundle/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN touch /app/supervisord.pid && \
    chown pptruser:pptruser /app/supervisord.pid && \
    touch /app/supervisord.log && \
    chown pptruser:pptruser /app/supervisord.log && \
    chmod 755 /app/supervisord.conf && \ 
    chmod 644 /app/supervisord.log && \
    chmod 644 /app/supervisord.pid

RUN mkdir -p ./log && \
    chown pptruser:pptruser ./log

RUN chown pptruser:pptruser /app

ENV NODE_ENV=production

USER pptruser

ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 8001
