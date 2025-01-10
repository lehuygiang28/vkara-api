FROM oven/bun:alpine AS build

WORKDIR /app

# Cache packages installation
COPY package.json package.json
COPY bun.lockb bun.lockb

RUN bun install

COPY ./src ./src

ENV NODE_ENV=production

RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile server \
    ./src/index.ts

FROM build AS production

WORKDIR /app

COPY --from=build /app/server server
RUN chmod +x server && \
    chown nobody:nobody server

RUN apk update && \
    apk add --no-cache supervisor redis

COPY --chown=nobody:nobody ./containers/redis-bundle/supervisord.conf ./supervisord.conf
COPY --chown=nobody:nobody ./containers/redis-bundle/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
RUN chown nobody:nobody /app/supervisord.conf && \
    chmod 755 /app/supervisord.conf

# Create log directory
RUN mkdir -p ./log && \
    chown nobody:nobody ./log
RUN chown nobody:nobody /app

ENV NODE_ENV=production

USER nobody

ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 8000
