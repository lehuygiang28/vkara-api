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

RUN mkdir -p /app && \
    chown pptruser:pptruser /app
COPY --chown=pptruser:pptruser --from=build /app/server2 server
RUN chmod +x /app/server && \
    chown pptruser:pptruser /app/server

RUN apk update && \
    apk add --no-cache supervisor redis

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
