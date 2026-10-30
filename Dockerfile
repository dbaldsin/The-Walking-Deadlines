# Builds our fork of opencode from source and serves it with `opencode web`.
#
# The build stage compiles a single native binary with the web UI from
# packages/app embedded in it. Without the embedded UI the server proxies the
# frontend from app.opencode.ai, so our own frontend changes would not show.

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build

# Debian removes superseded package versions from its mirrors, so exact apt
# pins (DL3008) would break rebuilds; the base image digest is pinned instead.
# Review when a base image is bumped, and no later than 2027-01-31.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

# Skip git hooks and use the checked-in package version, so the build script
# neither shells out to git nor queries npm for the latest release.
ENV HUSKY=0 \
    OPENCODE_CHANNEL=deploy

RUN bun install --frozen-lockfile
RUN OPENCODE_VERSION="$(bun -p 'require("./packages/opencode/package.json").version')" \
    bun run --cwd packages/opencode script/build.ts --single --skip-install \
  && mkdir -p /out \
  && cp packages/opencode/dist/opencode-linux-*/bin/opencode /out/opencode

FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3

# Debian removes superseded package versions from its mirrors, so exact apt
# pins (DL3008) would break rebuilds; the base image digest is pinned instead.
# Review when a base image is bumped, and no later than 2027-01-31.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install --no-install-recommends git ripgrep ca-certificates \
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
