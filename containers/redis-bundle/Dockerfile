FROM oven/bun:alpine AS build

WORKDIR /app

COPY package.json package.json
COPY bun.lockb bun.lockb
COPY ./tsconfig.json ./tsconfig.json

COPY ./src ./src
COPY ./bin ./bin

RUN bun remove puppeteer
RUN bun install

ENV NODE_ENV=production

RUN bun run build

FROM build AS production

WORKDIR /app

RUN mkdir -p /app && \
    chown nobody:nobody /app
COPY --chown=nobody:nobody --from=build /app/server server
RUN chmod +x /app/server && \
    chown nobody:nobody /app/server

RUN apk update && \
    apk add --no-cache supervisor redis

COPY --chown=nobody:nobody ./containers/redis-bundle/supervisord.conf ./supervisord.conf
COPY --chown=nobody:nobody ./containers/redis-bundle/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN touch /app/supervisord.pid && \
    chown nobody:nobody /app/supervisord.pid && \
    touch /app/supervisord.log && \
    chown nobody:nobody /app/supervisord.log && \
    chmod 755 /app/supervisord.conf && \ 
    chmod 644 /app/supervisord.log && \
    chmod 644 /app/supervisord.pid

RUN mkdir -p ./log && \
    chown nobody:nobody ./log

RUN chown nobody:nobody /app

ENV NODE_ENV=production

USER nobody

ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 8000
