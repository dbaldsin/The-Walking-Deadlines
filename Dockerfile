# Builds our fork of opencode from source and serves it with `opencode web`.
#
# The build stage compiles a single native binary with the web UI from
# packages/app embedded in it. Without the embedded UI the server proxies the
# frontend from app.opencode.ai, so our own frontend changes would not show.

FROM oven/bun:1.3.14 AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

# Skip git hooks, and pin the channel/version so the build script neither shells
# out to git nor queries npm for the latest release.
ENV HUSKY=0 \
    OPENCODE_CHANNEL=deploy \
    OPENCODE_VERSION=0.0.0-deploy

RUN bun install --frozen-lockfile
RUN bun run --cwd packages/opencode script/build.ts --single \
  && mkdir -p /out \
  && cp packages/opencode/dist/opencode-linux-*/bin/opencode /out/opencode

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# `opencode web` tries to open a browser on startup and crashes when xdg-open
# is missing, so stub it out on this headless server.
RUN ln -s /bin/true /usr/local/bin/xdg-open

COPY --from=build /out/opencode /usr/local/bin/opencode
RUN opencode --version

# Sessions opened from the browser start in this directory.
WORKDIR /workspace

EXPOSE 4096
ENTRYPOINT ["opencode", "web", "--hostname", "0.0.0.0", "--port", "4096"]
