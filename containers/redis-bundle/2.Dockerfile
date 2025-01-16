FROM oven/bun

ARG REFRESH=3

# install curl for healthchecks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Installing required chrome dependencies manually
# goto https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-on-wsl-windows-subsystem-for-linux
RUN apt-get update && apt-get install -y libgtk-3-dev libnotify-dev libgconf-2-4 libnss3 libxss1 libasound2

# Set the working directory
RUN mkdir app
WORKDIR /app
COPY ./src ./
COPY package.json bun.lockb tsconfig.json ./

# Add user so we don't need --no-sandbox
# same layer as npm install to keep re-chowned files from using up several hundred MBs more space
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

# Run everything after as non-privileged user.
USER pptruser

# install packages
RUN bun i
RUN bun x puppeteer browsers install chrome

EXPOSE 4010

CMD ["bun", "run", "dev2"]