# syntax=docker/dockerfile:1.7
# Two runtime images from one build (PRD Q-2): `--target api` and `--target web`.
#
#   api  ONE compiled executable (`bun build --compile`) on plain alpine — no bun, no sources, no
#        node_modules. The ops one-offs are subcommands of the same binary (apps/api/src/cli.ts):
#        `api serve` (default) · `api migrate` · `api seed` · `api health` (HEALTHCHECK) · `api version`.
#   web  SvelteKit adapter-node output bundled into ONE file next to its client assets, served by
#        the bun runtime — no node_modules either.
#
# Multi-stage, non-root, HEALTHCHECK. The database dialect is chosen at build time (§4.3): the
# generated schema (and the embedded migrations) bind one driver — build one image per dialect.

ARG BUN_VERSION=1.4
ARG ALPINE_VERSION=3.21
ARG DB_DIALECT=mysql
# Build identity for /version (M-5): pass --build-arg APP_COMMIT=$(git rev-parse HEAD) APP_BUILT_AT=$(date -u +%FT%TZ)
ARG APP_COMMIT=dev
ARG APP_BUILT_AT=

# ---------------------------------------------------------------------------------------------
# build: full install, generate registries + embedded migrations, build the web app, then
# compile api and bundle web. Nothing from node_modules leaves this stage.
# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ARG DB_DIALECT
ENV DB_DIALECT=${DB_DIALECT} NODE_ENV=production
RUN bun run bootstrap && bun run --cwd apps/web build
# api → one self-contained executable for THIS stage's platform (same arch/libc as the runtime
# stage below). Elysia's route compiler needs identifiers intact: minify whitespace + syntax only.
RUN bun build --compile --minify-whitespace --minify-syntax apps/api/src/index.ts --outfile /out/api
# web → adapter-node's server + all its dependencies in one file. It must sit next to `client/`
# (and `prerendered/` when present): the handler serves static assets relative to its own path.
RUN mkdir -p /out/web \
 && bun build --target=bun --minify-whitespace --minify-syntax apps/web/build/index.js --outfile /out/web/index.js \
 && cp -r apps/web/build/client /out/web/client \
 && { [ ! -d apps/web/build/prerendered ] || cp -r apps/web/build/prerendered /out/web/prerendered; }

# ---------------------------------------------------------------------------------------------
# api: the compiled binary on alpine
# ---------------------------------------------------------------------------------------------
FROM alpine:${ALPINE_VERSION} AS api
ARG APP_COMMIT
ARG APP_BUILT_AT
ENV APP_COMMIT=${APP_COMMIT} APP_BUILT_AT=${APP_BUILT_AT}
# libstdc++/libgcc: Bun's musl build links them dynamically. ca-certificates: outbound TLS
# (SMTP, AI providers). uid 1000 = the `bun` user of the previous image, so an existing uploads
# volume keeps its owner.
RUN apk add --no-cache ca-certificates libstdc++ libgcc \
 && addgroup -g 1000 app && adduser -D -H -u 1000 -G app app \
 && mkdir -p /data/uploads && chown app:app /data/uploads
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY --from=build --chown=app:app /out/api /app/api
USER app
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD ["/app/api", "health"]
ENTRYPOINT ["/app/api"]
CMD ["serve"]

# ---------------------------------------------------------------------------------------------
# web: one bundled server file + client assets, served by Bun
# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS web
ARG APP_COMMIT
ARG APP_BUILT_AT
ENV APP_COMMIT=${APP_COMMIT} APP_BUILT_AT=${APP_BUILT_AT}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=bun:bun /out/web ./
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "index.js"]
