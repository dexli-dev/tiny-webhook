# Multi-stage build: tiny final image, full devDeps only during build.

# ---- Stage 0: fetch dexli-family library at pinned SHA ------------------
# We can't `git submodule update --init` inside the main build stage
# because `.dockerignore` excludes `.git/` (intentional — keeps the
# runtime image slim) and node:22-alpine doesn't ship `git`. A tiny
# alpine stage with `git` does the clone + checkout, and the build
# stage COPYs the result in.
#
# Why git-clone instead of curl tarball: GitHub's archive tarball
# endpoint (`github.com/<owner>/<repo>/archive/<sha>.tar.gz`) returns
# 404 on this specific repo despite anonymous git-clone working fine
# (verified 2026-05-28). git-clone is the working path for fetching
# the snapshot in a Dockerfile without `.git/` in the parent context.
#
# The SHA is duplicated between this Dockerfile and .gitmodules /
# git submodule pin. **CTO discipline: when bumping the submodule pin,
# bump DEXLI_FAMILY_SHA in lockstep.** Drift causes a build failure
# (SHA doesn't exist) or behavioral divergence between local-tested
# code and deployed code. Catch at code review.
FROM alpine:3.20 AS submodules
ARG DEXLI_FAMILY_SHA=b430f39c0ce95d762407a6ed18b61d4f6474a466
RUN apk add --no-cache git
RUN git clone https://github.com/Milkslayer/dexli-family.git /vendored-dexli-family \
    && cd /vendored-dexli-family \
    && git checkout ${DEXLI_FAMILY_SHA} \
    && rm -rf .git

# ---- Stage 1: build the app -----------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install all deps. `--ignore-scripts` skips the cycle-3 postinstall hook
# (scripts/init-vendored.mjs) — it relies on `git submodule update` which
# requires git + .git/, neither present in this build context. The
# submodule content arrives from stage 0 instead (next COPY block).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

# Copy the rest of the repo (everything except .dockerignore exclusions).
# The `vendored/dexli-family/` directory comes through here as the empty
# submodule mount-point that `git clone` produces; the next COPY
# overwrites it with the actual fetched content.
COPY . .
COPY --from=submodules /vendored-dexli-family ./vendored/dexli-family

# Produce the adapter-node build output at /app/build.
RUN npm run build

# Drop dev dependencies so we copy only runtime deps into the final stage.
RUN npm prune --omit=dev

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="TinyWebhook" \
      org.opencontainers.image.description="Temporary webhook inbox — capture, inspect, replay HTTP requests in real time. Part of the dexli.dev tiny-tools family." \
      org.opencontainers.image.source="https://github.com/Milkslayer/tiny-webhook" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# adapter-node ships a self-contained `build/` directory; we still need the
# pruned node_modules and package.json for module resolution at runtime.
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

EXPOSE 3000

USER node

CMD ["node", "build"]
