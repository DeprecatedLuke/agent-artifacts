# syntax=docker/dockerfile:1.7
#
# Multi-stage build for agent-reports (linux/amd64 in production):
#   render/ + web/  -> static bundles built with bun
#   server/         -> Rust release binary (axum + rusqlite)
# Runtime is distroless: only the binary, the two bundles and the guide.

# ---------------------------------------------------------------------------
# render: in-iframe runtime (runtime.js, report.css)
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM oven/bun:1 AS render
WORKDIR /src/render
# Dependencies first so source edits do not invalidate the install layer.
COPY render/package.json render/bun.lock ./
RUN bun install --frozen-lockfile
COPY render/ ./
RUN bun run build

# ---------------------------------------------------------------------------
# web: Svelte SPA (index.html + share.html + assets)
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM oven/bun:1 AS web
WORKDIR /src/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# ---------------------------------------------------------------------------
# server: Rust release build, dependency layer cached behind a stub main
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS server
WORKDIR /src
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir -p src \
 && printf 'fn main() {}\n' > src/main.rs \
 && cargo build --release --locked
COPY server/ ./
RUN touch src/main.rs && cargo build --release --locked \
 && cp target/release/agent-reports /out-agent-reports

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM --platform=$TARGETPLATFORM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=server /out-agent-reports /app/agent-reports
COPY --from=render /src/render/dist/ /app/render/
COPY --from=web /src/web/dist/ /app/web/
COPY docs/guide.html /app/docs/guide.html
EXPOSE 8080
ENTRYPOINT ["/app/agent-reports"]
