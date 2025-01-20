FROM oven/bun AS build

WORKDIR /app

COPY package.json bun.lockb tsconfig.json ./
COPY ./src ./src
COPY ./patches ./patches

# `puppeteer` only use for `check-youtube-available.ts`
# remove it for smaller image size
# `check-youtube-available.ts` will be built in other image
RUN bun remove puppeteer
RUN bun install

RUN bun run build

FROM gcr.io/distroless/base AS production

LABEL git="https://github.com/lehuygiang28/vkara-api"
LABEL author="lehuygiang28 <lehuygiang28@gmail.com>"
LABEL org.opencontainers.image.maintainer="lehuygiang28 <lehuygiang28@gmail.com>"

WORKDIR /app

COPY --from=build /app/server server

ENV NODE_ENV=production

CMD ["./server"]

EXPOSE 8000