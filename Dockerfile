# Multi-stage build: tiny final image, full devDeps only during build.
# Satisfies bar items 16-17: single-command build + single-command run.

# ---- Build stage ----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install all deps (including dev) for the build. Using npm ci against the
# committed package-lock keeps builds reproducible across machines.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest and produce the adapter-node build output at /app/build.
COPY . .
RUN npm run build

# Drop dev dependencies so we copy only runtime deps into the final stage.
RUN npm prune --omit=dev

# ---- Runtime stage --------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# OCI image metadata. `source` will be filled in when the GitHub repo is
# created; leave it as the canonical clone URL so registries can link back.
LABEL org.opencontainers.image.title="TinyWebhook" \
      org.opencontainers.image.description="Temporary webhook inbox — capture, inspect, replay HTTP requests in real time. Part of the dexli.dev tiny-tools family." \
      org.opencontainers.image.source="https://github.com/Milkslayer/tiny-webhook" \
      org.opencontainers.image.licenses="UNLICENSED"

# Fallback defaults only — every value is overridable at run time via -e.
# See README "Configuration" / .env.example for the full operator surface.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# adapter-node ships a self-contained `build/` directory; we still need the
# pruned node_modules and package.json for module resolution at runtime.
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

EXPOSE 3000

# Run as the unprivileged `node` user that the official image already provides.
USER node

CMD ["node", "build"]
