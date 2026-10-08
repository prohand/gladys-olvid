# -----------------------------------------------------------------------------
# Integration image.
#
# Gladys sandbox constraints ("the sandbox is the defense"):
#   - rootfs mounted READ-ONLY -> never write outside /data
#   - a single writable volume: /data
#   - runs as a non-root user
#   - multi-arch image (linux/amd64 + linux/arm64), see the CI workflow
# -----------------------------------------------------------------------------

FROM node:24-alpine

# dumb-init: handles signals (SIGTERM) correctly for a graceful shutdown.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install the PROD dependencies first (better build cache).
# @olvid/bot-node lists tsx (and through it esbuild, ~12 MB of native binary)
# as a runtime dependency, while its published build never loads either: they
# only serve its own TypeScript sources. Checked by importing the package with
# both removed; the CI image job imports it again from the built image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && rm -rf node_modules/tsx node_modules/esbuild node_modules/@esbuild \
    node_modules/.bin/tsx node_modules/.bin/esbuild \
  && npm cache clean --force

# Then the integration code.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json ./

# The only writable location allowed at runtime.
ENV NODE_ENV=production
VOLUME ["/data"]

# Run as an unprivileged user (already present in the node image).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
