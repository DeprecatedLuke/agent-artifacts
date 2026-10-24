# artifacts

A self-hosted store for HTML reports that coding agents write for humans.

Agents publish with a `report://` URL and edit the same URL in place; the human gets a web app with live
updates, split view, light/dark themes and expiring share links. Reports are one text document each, so
they live in version-like revisions and can be re-read as Markdown by another agent.

```
agent ── report://project/slug ──┐
                                 ├──► Rust server ──► SQLite + assets on disk
human ── https://host/r/p/s ─────┘         │
                                           └──► websocket: every open viewer updates in place
```

## What a report gets

- A fixed page header (project, title, description, revision, time); agents write only the body.
- Bodies may be an HTML fragment or GitHub-flavoured Markdown (with raw HTML mixed in); the server
  detects the format and renders both.
- Components that need no JavaScript from the author: math (`$…$`, `$$…$$`), Mermaid diagrams, Vega-Lite
  charts, syntax-highlighted code in any Shiki language, unified diffs with line numbers and word-level
  highlights, before/after comparisons, sortable tables, callouts, tabs, grids and metric cards.
- Heroicons via `<x-icon name="…">`; unicode arrows, symbols and emoji are rejected at write time.
- A Markdown rendition of every report (`/text`, `report://p/s.md`) for other agents.
- Reports render inside a sandboxed iframe with its own CSP, so a report cannot touch the app.

## Repo layout

| Path | What |
|---|---|
| `server/` | axum API, storage, websockets, validation, document wrapper, text version |
| `web/` | Svelte 5 SPA: list, report, split view, share page |
| `render/` | the in-iframe runtime and the one stylesheet every report uses |
| `plugin/` | omp plugin: `report://` scheme, `report_upload`, `/artifacts login` |
| `deploy/` | kustomize manifests: Traefik basic auth + remember cookie, cert-manager, PVC |
| `docs/guide.html` | the writing guide, also published as the report `artifacts/guide` |

## Local development

```sh
task dev        # render (watch) + server on 127.0.0.1:8787 + Vite on :5173
task check      # biome/tsc/svelte-check + cargo fmt/clippy/test
```

`task dev` needs no secrets; the dev server trusts the `X-Artifacts-Owner` header that the Vite proxy adds.

## Deploy

Kubernetes with an ingress controller that can run Traefik middlewares (basic auth, a remember cookie and
an owner header), plus cert-manager for TLS. Copy `.env.example` to `.env`, fill it in, then:

```sh
task secrets    # pull secret + DNS-01 API token into the namespace
task release    # build, push, pin the tag, apply, wait for the rollout
```

Authentication is entirely at the ingress: basic auth, then a `__Host-artifacts` cookie, then an
`X-Artifacts-Owner` header the server requires on `/api/*`. Share links and render assets are served on
routes with no auth at all, which is why the app itself never sets cookies.

## Using it from an agent

```sh
cd plugin && bun install && omp plugin link "$PWD"
omp plugin config set artifacts url https://artifacts.example.com
/artifacts login
```

| URL | Meaning |
|---|---|
| `report://list`, `report://list?project=<name>`, `?project=*` | listings, current project by default |
| `report://<project>/<slug>` | editable source (hashline `edit`, `write` creates) |
| `report://<project>/<slug>.md` | read-only Markdown |
| `report://guide` | the writing guide |

`docs/guide.html` documents the writing rules and every component with live examples.
