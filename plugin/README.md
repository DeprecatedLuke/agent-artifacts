# artifacts omp plugin

Publishes and edits human-facing HTML reports on an artifacts server from omp.
Reports are readable at `report://` URLs, editable in place with hashline `edit`, and
render as live HTML for the human.

## Install

```sh
cd plugin
bun install
omp plugin link "$PWD"          # symlinks this package into ~/.omp/plugins
omp plugin config set artifacts url https://artifacts.example.com   # your deployment
```

The plugin loads from `package.json#omp.extensions` (`./src/index.ts`); no build step.

## Log in

```sh
/artifacts login     # Basic auth once; stores the Traefik __Host-artifacts remember cookie
/artifacts status    # url, project, whether the stored cookie is accepted
/artifacts logout    # clear the stored cookie
```

Non-interactive alternative (the cookie value is never echoed):

```sh
set -a; . ./.env; set +a
omp plugin config set artifacts session "$AGENT_REPORTS_SESSION_TOKEN"
```

Settings live in `~/.omp/plugins/omp-plugins.lock.json` under `settings.artifacts`
(`url`, secret `session`); project overrides in `.omp/plugin-overrides.json` win.

## URL scheme

| URL | Read | Write |
|---|---|---|
| `report://` / `report://list` | reports in the current project (`basename(cwd)` lowercased, other chars → `-`) | — |
| `report://list?project=<name>` / `report://list/<name>` | one project | — |
| `report://list?project=*` | every project, grouped | — |
| `report://guide` | the writing guide (`artifacts/guide`) | — |
| `report://<project>/<slug>` | editable source with hashline anchors | `write` = PUT (`If-Match` known rev, else `If-None-Match: *`); `edit` = patch the local mirror, pushed back automatically |
| `report://<project>/<slug>.md` | server text version (immutable) | — |

Reads of a report source resolve through a local mirror (`${XDG_CACHE_HOME:-~/.cache}/omp-artifacts/<project>/<slug>.md`)
because the host's hashline `edit` patches a real file; the mirror is refreshed from the
server on every read/`edit` and changes are PUT back after the tool result.

Errors are reported model-side: `412` → “report changed (or already exists) — read report://p/s again”,
`422` → validation problems with line numbers, `401` → “not logged in — run /artifacts login”.

## Tool

`report_upload {project, slug, path, name?}` uploads a local file (png/jpg/gif/webp/avif/svg,
csv, json, txt) to `…/assets/<name>` and returns `<img src="assets/<name>">` for images or the
`data.url: "assets/<name>"` hint for csv/json (use it inside an `<x-chart>` spec).

## Checks

```sh
bun run check   # tsc --noEmit
bun run lint    # biome check
```
