# syntax=docker/dockerfile:1
# Multi-arch base — pulls linux/arm64 automatically on the Raspberry Pi 5.

# ---- deps ---------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# Build toolchain for better-sqlite3's native addon: compiled from source when no
# prebuilt binary matches the target arch/ABI (notably on arm64). Discarded with
# this stage — the final runtime image stays slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# `postinstall` runs `prisma generate` (schema only, jamais de DB) : jamais de
# `db push` à l'install — l'application du schéma est réservée au service `migrate`.
# On garde un DATABASE_URL factice comme filet pour un éventuel accès Prisma
# incident ; ce layer n'atteint jamais l'image runtime.
ENV DATABASE_URL="file:/tmp/build.db"
COPY package.json package-lock.json* .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- builder ------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Dynamic (cookie-based) routes are never prerendered, so the build doesn't hit
# the DB — this URL is only a safety net for any incidental Prisma access.
ENV DATABASE_URL="file:/tmp/build.db"

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client (output: generated/prisma) explicitly: `prisma db
# push` in postinstall doesn't reliably emit it for the prisma-client generator.
# generate needs only the schema, never a DB connection.
# No public/ dir in the repo today; create it so the runner COPY never fails and
# future static assets are picked up automatically.
RUN npx prisma generate && mkdir -p public && npm run build

# Data dir owned by the runtime uid, so the named volume is initialised with the
# right ownership whichever service (app or migrate) mounts it first.
RUN mkdir -p /data && chown 1001:1001 /data

# ---- runner -------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# SQLite file lives on the persistent /data volume (see compose).
ENV DATABASE_URL="file:/data/dev.db"

# Dedicated non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Persistent SQLite dir, owned by the app user (initialises the named volume).
RUN mkdir -p /data && chown nextjs:nodejs /data

# Next.js "standalone" output: a self-contained server with only traced deps.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Belt-and-braces: guarantee the native SQLite driver, its Prisma adapter and the
# generated client are present even if file tracing misses the native .node binary
# or the out-of-node_modules generated client.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/adapter-better-sqlite3 ./node_modules/@prisma/adapter-better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated

USER nextjs
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
