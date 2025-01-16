FROM oven/bun:alpine AS build

WORKDIR /app

COPY package.json package.json
COPY bun.lockb bun.lockb
COPY ./tsconfig.json ./tsconfig.json

COPY ./src ./src

RUN bun install

ENV NODE_ENV=production

RUN bun run build2

RUN apk update && \
    apk add --no-cache supervisor redis

FROM ghcr.io/puppeteer/puppeteer:16.1.0 AS production

WORKDIR /app

RUN mkdir -p /app && \
    chown pptruser:pptruser /app
COPY --from=build --chown=pptruser:pptruser  /app/server2 server

COPY --from=build --chown=pptruser:pptruser /usr/bin/supervisord /usr/bin/supervisord
COPY --from=build --chown=pptruser:pptruser /usr/bin/redis-server /usr/bin/redis-server

RUN chmod +x /usr/bin/supervisord && \
    chmod +x /usr/bin/redis-server
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

EXPOSE 8000
