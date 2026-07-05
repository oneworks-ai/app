FROM node:24-bookworm-slim

ENV CI=1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV npm_config_nodedir=/usr/local

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /opt/oneworks-daemon
