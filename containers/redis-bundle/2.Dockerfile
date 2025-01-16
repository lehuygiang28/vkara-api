FROM oven/bun

ARG REFRESH=3

# install curl for healthchecks
# install supervisor for running multiple processes
# install redis for caching
RUN apt-get update && apt-get install -y --no-install-recommends curl supervisor redis && apt-get clean && rm -rf /var/lib/apt/lists/*

# Installing required chrome dependencies manually
# goto https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-on-wsl-windows-subsystem-for-linux
RUN apt-get update && apt-get install -y --no-install-recommends libgtk-3-dev libnotify-dev libgconf-2-4 libnss3 libxss1 libasound2

# Set the working directory
RUN mkdir app
WORKDIR /app
COPY ./src /app/src
COPY package.json bun.lockb tsconfig.json /app/

# Add user so we don't need --no-sandbox
# same layer as npm install to keep re-chowned files from using up several hundred MBs more space
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

COPY --chown=pptruser:pptruser ./containers/redis-bundle/supervisord-2.conf ./supervisord.conf
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

# Run everything after as non-privileged user.
USER pptruser

# install packages
RUN bun i
RUN bun x puppeteer browsers install chrome

EXPOSE 8001

ENTRYPOINT ["./entrypoint.sh"]