# Commission Management — multi-stage Dockerfile.
#
# All targets share a single `install` stage so bun install runs once and its
# layer is reused across every target build on the same host.
#
# Targets
# -------
#   dev        — oven/bun:1 with shell, hot-reload (source volume-mounted at runtime)
#   production — distroless server bundle (API only, no web assets)
#   release    — distroless server + baked Vite frontend
#   worker     — distroless background job runner (guarantee expiry, clawback triggers)
#
# Usage examples
# ---------------
#   docker build --target dev        -t commission-dev .
#   docker build --target production -t commission-api:latest .
#   docker build --target release    -t commission-release:latest .
#   docker build --target worker     -t commission-worker:latest .
#
# Architecture constraints:
#   - Production and worker targets use distroless images (no shell) — WORKER-C-001
#   - CI smoke test: docker run --rm <image> sh → assert exit 126 or 127
#   - ENTRYPOINT uses array form (no shell interpolation) — WORKER-C-007
#   - Single bun install stage; all targets copy node_modules from install
#
# Canonical docs: docs/architecture.md — Infrastructure/hosting, Phase 1 Foundation

# ── Pinned base images ──────────────────────────────────────────────────────

ARG BUN_VERSION=1.2
ARG BUN_BUILDER_DIGEST=sha256:6ebf306367da43ad75c4d5119563e24de9b66372929ad4fa31546be053a16f74
ARG BUN_DISTROLESS_DIGEST=sha256:e2c3f36733fa2c2c9c80d89b481d9fc7629558cac2533c776f6285ae1ba6b8fa

# ── Stage: install — shared dependency installation ─────────────────────────
# All subsequent build stages copy node_modules from here so bun install
# executes exactly once per cache key across all targets.

FROM oven/bun:${BUN_VERSION}@${BUN_BUILDER_DIGEST} AS install

WORKDIR /app

# Copy workspace manifests and lockfile first for layer caching.
# All workspace member package.json files must be present so bun can resolve
# the full workspace graph against the frozen lockfile.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

# Install all workspace dependencies with frozen lockfile for reproducibility.
RUN bun install --frozen-lockfile --ignore-scripts

# ── Stage: build-server — compile the server bundle ─────────────────────────

FROM install AS build-server

# Copy source files needed for the server bundle.
COPY apps/server/ apps/server/
COPY packages/ packages/
COPY tsconfig.json ./

# Compile the server entry-point to a single bundle targeting the bun runtime.
# postgres is marked external so its native bindings are loaded at runtime.
RUN bun build apps/server/src/index.ts \
      --target bun \
      --outfile dist/server.js \
      --external postgres

# ── Stage: build-web — compile the Vite frontend ────────────────────────────

FROM build-server AS build-web

# Copy web source files and build the frontend.
COPY apps/web/ apps/web/

RUN cd apps/web && bun run build

# ── Stage: build-worker — compile the worker bundle ─────────────────────────

FROM install AS build-worker

# Copy only what the worker bundle needs.
COPY apps/worker/ apps/worker/
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY tsconfig.json ./

# Compile the worker entry-point to a single bundle targeting the bun runtime.
RUN bun build apps/worker/src/index.ts \
      --target bun \
      --outfile dist/worker.js \
      --external postgres

# ── Stage: production — distroless server (API only, no web assets) ──────────
# Blueprint: WORKER-C-001 (no-shell distroless runtime)

FROM oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS production

WORKDIR /app

COPY --from=build-server /app/dist/server.js ./dist/server.js
COPY --from=build-server /app/packages/db ./packages/db
COPY --from=install /app/node_modules ./node_modules

ENV PORT=31415

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 31415) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 31415

ENTRYPOINT ["bun", "run", "dist/server.js"]

# ── Stage: release — distroless server + baked Vite frontend ─────────────────
# Serves both API and compiled frontend from one container.
# Blueprint: WORKER-C-001 (no-shell distroless runtime)

FROM oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS release

WORKDIR /app

COPY --from=build-web /app/dist/server.js ./dist/server.js
COPY --from=build-web /app/apps/web/dist ./apps/web/dist
COPY --from=build-web /app/packages/db ./packages/db
COPY --from=install /app/node_modules ./node_modules

ENV PORT=31415

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 31415) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 31415

ENTRYPOINT ["bun", "run", "dist/server.js"]

# ── Stage: worker — distroless background job runner ────────────────────────
# Processes guarantee-expiry, clawback-trigger, and related tasks.
# Network-isolated: no DB write grants; all mutations go via the API.
# Blueprint: WORKER-C-001, WORKER-P-001/P-002, WORKER-A-001

FROM oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS worker

WORKDIR /app

COPY --from=build-worker /app/dist/worker.js ./dist/worker.js
COPY --from=install /app/node_modules ./node_modules

ENTRYPOINT ["bun", "run", "dist/worker.js"]

# ── Stage: dev — hot-reload development server ───────────────────────────────
# Source is volume-mounted at runtime via docker-compose.
# Entrypoint starts both migration and the hot-reload server.

FROM oven/bun:${BUN_VERSION} AS dev

WORKDIR /app

# Install git for any postinstall hooks that require it.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests and lockfile for dependency installation.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

# Install all workspace dependencies.
RUN bun install --frozen-lockfile

# Source is volume-mounted at runtime via docker-compose; copying here provides
# a fallback for plain `docker run` without a volume.
COPY . .

ENV PORT=31415

EXPOSE 31415

# Start the server with hot-reload.
CMD ["bun", "run", "--hot", "apps/server/src/index.ts"]
