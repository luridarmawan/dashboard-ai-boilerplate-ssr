# syntax=docker/dockerfile:1.7
# Two runtime images from one build (PRD Q-2): `--target api` and `--target web`.
# Multi-stage, non-root, HEALTHCHECK, alpine runtime. The database dialect is chosen at build
# time (§4.3): the generated schema binds one driver — build one image per dialect you deploy.

ARG BUN_VERSION=1.4
ARG DB_DIALECT=mysql
# Build identity for /version (M-5): pass --build-arg APP_COMMIT=$(git rev-parse HEAD) APP_BUILT_AT=$(date -u +%FT%TZ)
ARG APP_COMMIT=dev
ARG APP_BUILT_AT=

# ---------------------------------------------------------------------------------------------
# build: full install, generate registries, build the web app, then prune devDependencies
# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ARG DB_DIALECT
ENV DB_DIALECT=${DB_DIALECT} NODE_ENV=production
RUN bun run bootstrap && bun run --cwd apps/web build
# Same lockfile, production only. A CLEAN install: pruning in place leaves dev packages in the
# node_modules/.bun store (Biome, TypeScript, Vite, drizzle-kit…) and quadruples the image.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
 && bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------------------------
# api: Elysia, run from TypeScript sources by Bun
# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS api
ARG APP_COMMIT
ARG APP_BUILT_AT
ENV APP_COMMIT=${APP_COMMIT} APP_BUILT_AT=${APP_BUILT_AT}
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock /app/modules.json /app/tsconfig.base.json ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/modules ./modules
COPY --from=build --chown=bun:bun /app/apps/api ./apps/api
COPY --from=build --chown=bun:bun /app/scripts ./scripts
RUN mkdir -p /data/uploads && chown bun:bun /data/uploads
USER bun
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3001/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "apps/api/src/index.ts"]

# ---------------------------------------------------------------------------------------------
# web: SvelteKit adapter-node output, served by Bun
# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS web
ARG APP_COMMIT
ARG APP_BUILT_AT
ENV APP_COMMIT=${APP_COMMIT} APP_BUILT_AT=${APP_BUILT_AT}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=bun:bun /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=bun:bun /app/apps/web/build ./apps/web/build
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "apps/web/build/index.js"]
