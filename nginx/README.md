# nginx

Route local apps by hostname and browse the webroot through a file explorer.
Every directory URL is the explorer, so
`http://localhost:80/example/` opens that directory. Four extras ride
on top of the file server: the explorer with search, rendered Markdown, rendered
JSON, and Inspect AI eval logs.

## Layout

```
install.sh     builds the app, copies it and the rendered confs into the nginx config dir, then reloads
package.json   the @dev-setup/nginx-viewers package: build, dev, check, test
build.mts      esbuild driver; writes dist/app/
src/           the React app, one component per viewer (TypeScript)
test/          node:test suites and fixtures
conf/          nginx config templates; @...@ fields are filled at install time
scripts/       helper commands (dev.sh, explorer.sh, explorer-server.py, inspect.sh, service.sh)
scripts/review_store.py, mdreview.py   review comment store and its command line
scripts/platform.sh   OS and package detection shared by every script
systemd/       user unit for the explorer API (Linux)
launchd/       launch agent for the explorer API (macOS)
dist/          build output, not in git
```

- `conf/nginx.conf` — main config template.
- `conf/hosts.conf` — hostname-based virtual servers.
- `conf/proxy-dev.conf` — shared proxy headers, including websockets.
- `conf/maps.conf` — `$render_page`, which separates browser navigations from
  raw fetches. Included in the `http` block.
- `conf/explorer.conf`, `conf/md.conf`, `conf/json.conf`, `conf/ipynb.conf`,
  `conf/text.conf`, `conf/inspect.conf` — feature snippets included in the
  default server. Every viewer snippet rewrites a navigation to
  `/__app/index.html`; the app picks the viewer from the URL.

Installed layout:

```
<config dir>/
  nginx.conf                  rendered; includes dev-setup/conf/*.conf
  nginx.conf.pre-dev-setup    one-time backup of the original
  dev-setup/
    manifest.json             source checkout, git SHA, platform, file hashes
    conf/                     rendered confs and a copy of the hosts file
    app/                      index.html, app.js, app.css, chunks/, source maps
```

Nothing in the config dir links back to the checkout.

On Linux nginx runs as `user root`, so a webroot symlinked to a build directory
under `$HOME` serves without chmod. With Homebrew on macOS nginx runs as the
login user on port 8080, which reads the same files without root.

## Install

```bash
./install.sh              # build, render, copy, validate, reload
./install.sh --show       # print the detected layout and the installed manifest
./install.sh --uninstall  # remove dev-setup/, restore the backup, stop the explorer
```

The installer needs `node` 22.18 or newer, because `build.mts` runs as
TypeScript through node's type stripping. If `node` is missing or older, the
installer stops and prints the install command.

The script:

- detects the OS and how nginx was installed, and reads the compiled paths from
  `nginx -V`
- backs up the existing main config once as `nginx.conf.pre-dev-setup` in the
  config dir
- runs `npm install` and `npm run build` when `dist/` is missing or older than
  `src/`
- deletes `dev-setup/` and writes it again: the rendered confs, a copy of the
  hosts file, the built app, and `manifest.json`
- removes the files and symlinks of the previous flat layout, one time
- runs `nginx -t`
- enables and starts nginx, or reloads it when already running
- installs the explorer API as a user service (systemd) or launch agent (launchd)

### Platforms

| | Linux, apt | Linux, yum / dnf | macOS, Homebrew |
| :-- | :-- | :-- | :-- |
| config dir | `/etc/nginx` | `/etc/nginx` | `$(brew --prefix)/etc/nginx` |
| webroot | `/var/www/html` | `/usr/share/nginx/html` | `$(brew --prefix)/var/www` |
| logs | `/var/log/nginx` | `/var/log/nginx` | `$(brew --prefix)/var/log/nginx` |
| modules | `/etc/nginx/modules-enabled` | `/usr/share/nginx/modules` | none |
| port | 80 | 80 | 8080 |
| runs as | root (`user root`) | root (`user root`) | login user |
| service | `systemctl` | `systemctl` | `brew services` |
| explorer API | systemd user unit | systemd user unit | launch agent |

`scripts/platform.sh` derives these and exports them as `NGINX_OS`,
`NGINX_PKG`, `NGINX_DIR`, `NGINX_ROOT`, `NGINX_LOG_DIR`, `NGINX_PID`,
`NGINX_MODULES_DIR`, `INSPECT_VIEWER_DIR`, `NGINX_PORT`, and `NGINX_BASE_URL`.
Set any of them before running a script to override the detection. `--port <n>`
sets the listen port; the next run reads the port back from the installed
config, so `explorer.sh` and `inspect.sh` print matching URLs.

On macOS install nginx first with `brew install nginx`. The installer needs no
sudo there, because Homebrew's tree belongs to the user. A port under 1024
needs root; either keep 8080 or start nginx with `sudo brew services start
nginx`, in which case the config carries `user root` again.

On Linux the installer uses sudo for the config dir and manages nginx with
`systemctl`. Debian and Ubuntu (apt) get `/var/www/html` as the webroot;
Amazon Linux, Fedora, and RHEL (yum / dnf) get `/usr/share/nginx/html`.

### Turn the services on and off

```bash
./scripts/service.sh off       # stop nginx and the explorer API, keep them off after reboot
./scripts/service.sh on        # enable and start both
./scripts/service.sh restart
./scripts/service.sh status    # unit state plus a health check of both URLs
```

`dev/common.sh` exposes the same script as `nginxctl`, with tab completion.
On Linux it drives `systemctl` (nginx as a system unit, the explorer as a user
unit). On macOS it drives `brew services` for nginx and `launchctl` for the
explorer launch agent. Run `install.sh` once first; it creates the units.

### Host routes per machine

`conf/hosts.conf` is version controlled, so machine-specific routes belong
somewhere else. The installer takes an override:

```bash
./install.sh --hosts ~/my-hosts.conf      # any path
HOSTS_CONF=~/my-hosts.conf ./install.sh   # same, through the environment
```

Without an override, `conf/hosts.local.conf` wins when it exists, else
`conf/hosts.conf`. Keep `hosts.local.conf` out of git for a personal file.

The installer copies the hosts file into `dev-setup/conf/hosts.conf`. After an
edit to your hosts file, run `./install.sh` again. Inside a hosts file, include
the proxy headers as `include dev-setup/conf/proxy-dev.conf;`. nginx resolves
a relative include against the config dir.

Entry points after install:

| URL | What |
| :-- | :-- |
| `http://localhost/<dir>/` | file explorer showing that directory |
| `http://localhost/<file>.md` | rendered Markdown |
| `http://localhost/<file>.json` | rendered JSON |
| `http://localhost/<file>.ipynb` | rendered Jupyter notebook |
| `http://localhost/<file>.eval` | Inspect AI log viewer |
| `http://localhost/<file>.log` | buffered text viewer |
| `http://localhost/__raw/<path>` | plain nginx index and raw bytes |
| `http://inspect.localhost/` | live Inspect AI viewer |

The installer enables and starts the explorer API as a user service, so it
survives terminal exits and restarts after login. Everything else is served by
nginx alone. Check it with:

```bash
systemctl --user status nginx-explorer                 # Linux
launchctl print gui/$(id -u)/com.dev-setup.nginx-explorer   # macOS
./scripts/explorer.sh status
```

On macOS the agent logs to `~/Library/Logs/nginx-explorer.log`.

## Reaching the site on another port

nginx serves this on port 80 on Linux and 8080 with Homebrew. When the site is
reached through a tunnel or a forwarded port, such as `http://localhost:8002/`,
the browser must stay on that port. Two settings keep that true:

- `absolute_redirect off` in `conf/nginx.conf` makes every redirect a path, such
  as `Location: /fmr_gyms/`. The default absolute form is built from
  `$server_port`, which reports 80 and drops the forwarded port.
- The helper scripts print URLs from `NGINX_BASE_URL`, which defaults to
  `http://localhost` plus the installed port. Export it to match the port you
  browse on:

```bash
export NGINX_BASE_URL=http://localhost:8002
```

Every link inside the viewers and the explorer is already path-relative, so no
page carries a host name.

## Host-based apps

`conf/hosts.conf` contains this commented template for a local app:

```nginx
# server {
#     listen 80;
#     listen [::]:80;
#     server_name app.localhost;
#
#     location / {
#         proxy_pass http://127.0.0.1:8000;
#         include dev-setup/conf/proxy-dev.conf;
#     }
# }
```

Match `listen` to the port in `nginx.conf`. Add another `server` block to expose another local port under its own hostname.

## Raw versus rendered

`conf/maps.conf` sets `$render_page` to 1 only for a page view: a request that
sends `Sec-Fetch-Mode: navigate`, or one that accepts HTML and omits that
header. Everything else — `fetch()`, `curl`, `wget`, the Inspect viewer reading
`listing.json` — receives the raw bytes. `?raw=1` always returns the source.

## Markdown

`conf/md.conf` rewrites a navigation to `*.md` to the app shell. The Markdown
viewer (`src/viewers/MdViewer.tsx`) fetches the same path with `?raw=1` and
renders it:

```
http://localhost/scratch/gym/auctioneer-capacity-planning/README.md
```

The viewer renders headings with anchors, tight and loose lists, task lists,
tables with alignment, fenced code with a language label and a copy button,
`diff` blocks, `mermaid` diagrams, blockquotes, `<details>` sections, images,
and YAML front matter. It builds a contents sidebar, follows the OS light/dark preference, and keeps a
manual theme toggle in `localStorage`.

- The renderer is one pure function in `src/markdown/render.ts`. It needs no
  network and no third-party code, so it works on a disconnected host.
- A `mermaid` fence renders as its source first. Then `src/markdown/mermaid.ts`
  replaces the source with the diagram. If the source does not parse, the
  block shows the parse error above the source.
- The build puts Mermaid in `dist/app/chunks/`. A page loads it only when the
  page has a diagram. The chunks ship with the app, so diagrams also work on a
  disconnected host.
- Unsupported by design: footnotes and LaTeX. They render as literal text.
- `test/fixtures/markdown-demo.md` exercises every construct. `npm test`
  checks it by assertion; open it through nginx to check an install by eye.

## Review comments

A reviewer comments on a rendered Markdown page in the browser. An agent reads
the comments with `mdreview`, edits the file, and replies. The page shows each
reply the next time the reader returns to the tab.

The comments stay outside the document and outside git. The document gets no
markers.

### Comment in the browser

1. Open a `.md` file through nginx.
2. Click **Comments** in the toolbar. The panel opens on the right, and the
   button shows the open count.
3. Start a comment in one of three ways:
   - Select text inside one paragraph, list, table, or code block, then click
     **Comment** under the selection.
   - Move the pointer over a block, then click **+** in the left margin.
   - Click **Add a note on the document** at the foot of the panel.
4. Type the comment. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or
   <kbd>Cmd</kbd>+<kbd>Enter</kbd> to post it. Press <kbd>Esc</kbd> to cancel.

A block with an open comment gets a yellow tint and a bar in the margin. Click
the header of a comment to scroll to its block. Each comment has **Reply**,
**Resolve**, **Reopen**, and **Delete**. Resolved comments collect in a closed
**Resolved** group.

The author is the login name of the user that runs the explorer API. To use a
different name, set `MD_REVIEW_AUTHOR` in the service environment.

When the window gets focus again, the page fetches the document and the
comments again. If the file changes while you type a comment, the server
refuses the comment and the panel shows **Reload the document**.

### Answer the comments

`dev/common.sh` defines the `mdreview` command, with tab completion for the
subcommands and the comment ids:

```zsh
mdreview list                                      # documents with open comments
mdreview list --path ~/html/notes/plan.md          # open comments on one document
mdreview list --path /notes/plan.md --json         # the same, for an agent
mdreview add --path /notes/plan.md --line 12 --body "Cite the source."
mdreview reply k3f9a2 --body "Added the link." --author agent
mdreview resolve k3f9a2 --action fixed --author agent   # or answered, wontfix
mdreview reopen k3f9a2
mdreview rm k3f9a2
mdreview mv /notes/plan.md /notes/plan-v2.md       # after you rename a document
```

`--path` takes a filesystem path or a webroot path. The webroot comes from
`--root`, then `$NGINX_ROOT`, then `~/html`.

`list --json` prints every comment with its current position in
`resolved.line`, `resolved.endLine`, and `resolved.text`. An agent reads only
this output. The store format is not a contract.

The `md-review` skill in `skills/md-review/SKILL.md` gives an agent the
procedure. Link it into Claude Code once, from the main checkout. A link into
a worktree breaks when you remove the worktree.

```bash
ln -s "$(git rev-parse --show-toplevel)/skills/md-review" ~/.claude/skills/md-review
```

Then ask the agent to "address the comments on plan.md", or run `/md-review`.

### Anchors

A comment anchors to one top-level block: a paragraph, a heading, a whole
list, a whole table, a whole blockquote, or a whole fenced code block. The
selected text is kept as a quote inside that block. On every read, the server
finds where the block is now:

| Result | Meaning | Panel |
| :-- | :-- | :-- |
| `exact` | the lines still hold the commented text | in place |
| `moved` | the same text is at other lines | in place, **moved** badge |
| `quote` | the block changed, and the quote is still in the file | in place, **quote** badge |
| `orphan` | the commented text is gone | **Orphaned** group, with the original quote |

Whitespace does not count in the match. A change of indentation, tabs, or
spaces keeps a comment `exact`. A reflow that changes the line count gives
`quote`. The server never rewrites an anchor.

### Storage

Each document has one append-only JSONL file:

```
${XDG_STATE_HOME:-~/.local/state}/dev-setup/md-review/<webroot path>.jsonl
```

Each line is one event: `comment`, `reply`, `status`, or `delete`. The current
state is the replay of the events in order. A delete hides a comment and keeps
its events. Set `MD_REVIEW_DIR` to use a different directory.

### Limits

- The endpoint needs no token and accepts any origin. It writes only into the
  store, and the request cannot name a target file.
- A request is at most 64 KiB, a comment at most 8 KiB, and a document at most
  8 MiB. A document keeps at most 2000 events.
- A selection must stay inside one block. A comment on a list item anchors to
  the whole list.
- Only the Markdown viewer takes comments. Notebooks, JSON, and text do not.

## JSON

`conf/json.conf` renders `.json`, `.jsonl`, and `.ndjson` with the JSON viewer
(`src/viewers/JsonViewer.tsx`):

- collapsible tree, colored by type, with `{ n items }` previews on closed nodes
- nodes past depth 2 and nodes over 100 children start collapsed, so large
  documents stay responsive
- `Expand` / `Collapse` for the whole document
- filter box that highlights matching keys and values, opens their ancestors,
  and reports a match count. Press <kbd>/</kbd> to focus it
- click any row to fold it; click the path chip to copy a JSONPath such as
  `data.runs[3].score`
- `Source` shows the re-indented document, `Copy` copies it, `Raw` opens the
  original bytes
- a `.jsonl` or `.ndjson` file, or any file that fails to parse as one JSON
  document, is parsed line by line and shown as an array of records
- header line reports type, node count, size, and parse time

## File explorer

`conf/explorer.conf` makes every directory URL the explorer and proxies
`/__api/` to `scripts/explorer-server.py`, a stdlib-only service on
`127.0.0.1:7576`. There is one page: search is a mode of the explorer, and the
old `/__files` and `/__search` paths redirect to `/`.

The routing is one `index` directive:

```nginx
index index.html /__app/index.html;
```

A directory serves its own `index.html` when it has one, which the Inspect
embedded viewer needs. Otherwise nginx falls back to the app shell, which
renders the explorer for a path that ends in a slash. The
URL stays `/example/` and the page reads its path from
`location.pathname`. nginx cannot template its own autoindex output, which is
why the explorer replaces the listing rather than restyling it.

Inside the explorer, opening a directory uses `pushState`, so navigation does not
reload the page and Back and Forward walk the directories and searches already
visited. Search options ride in the query string, such as
`/scratch/?q=Karpenter&mode=content`.

### Raw mode

`/__raw/<path>` serves the plain nginx index for a directory and the untouched
bytes for a file — no Markdown or JSON viewer, no explorer. Use it to see a
listing when the API is down, or to read a file exactly as stored. The `Raw`
button opens the current directory there, and each raw listing links back.

```bash
./scripts/explorer.sh start    # manual background start, logs to /tmp/nginx-explorer.log
./scripts/explorer.sh status   # process state plus an API health check
./scripts/explorer.sh stop
./scripts/explorer.sh run      # foreground
```

The normal install path manages this through the systemd user unit or the
launch agent; use the manual commands for a temporary setup.

### Editing files

The explorer API can create, replace, and remove files under the webroot. The
installer makes the webroot writable by the installing user and creates
`~/html -> <webroot>` when that link does not already exist.

Mutations require the per-user token in
`~/.config/nginx-explorer/edit-token`. The service listens on loopback, but the
token also prevents a request through nginx from changing files unintentionally.

```bash
TOKEN="$(<~/.config/nginx-explorer/edit-token)"

# Create or replace a file.
curl -X POST http://localhost/__api/files \
  -H "X-Explorer-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data '{"op":"write","path":"hello.html","content":"<h1>Hello</h1>"}'

# Create one directory, or remove a file / empty directory.
curl -X POST http://localhost/__api/files \
  -H "X-Explorer-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data '{"op":"mkdir","path":"drafts"}'
curl -X POST http://localhost/__api/files \
  -H "X-Explorer-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data '{"op":"delete","path":"drafts"}'
```

The API accepts only `write`, `mkdir`, and `delete`; it rejects paths outside
the webroot, symlinks themselves, and non-empty directory deletes.

### Browsing

- Lazy directory tree on the left, expanded down to the current directory.
- Breadcrumb, parent button, and a sortable table: name, size, modified. Click a
  header to sort; directories always group ahead of files.
- Icons by extension, symlinks flagged with an arrow, and a `hidden` toggle for
  dotfiles.
- A directory row opens it. A file row opens its viewer: Markdown and JSON get
  their renderers, other text and images open inline, and the rest download.
- `Preview` opens a side pane. It renders the selected file with the same
  viewers, and shows the plain index for a directory.
- `Raw` opens the current directory under `/__raw/`, the plain nginx listing.
- The current directory is the URL, so a location is shareable and survives
  reload.

### Filtering and search

Typing filters the current directory by name as you type. Pressing
<kbd>Enter</kbd> runs a real search:

- **Content** — ripgrep over file contents, grouped by file with line numbers
  and highlighted matches.
- **Names** — path match, sorted by modification time.
- **Both** — name matches merged with their content matches.

Options: `this subtree` limits a search to the current directory, a
comma-separated `glob` such as `*.md,*.yaml`, `regex`, and `case`.

### Keys

<kbd>/</kbd> focus the query · <kbd>j</kbd> <kbd>k</kbd> move · <kbd>g</kbd>
<kbd>G</kbd> first and last · <kbd>Enter</kbd> open · <kbd>p</kbd> preview ·
<kbd>u</kbd> parent directory · <kbd>r</kbd> refresh the cached listing ·
<kbd>Esc</kbd> clear the search or close the preview.

### Performance

One page load makes one API call. `/__api/list?path=X&tree=1` returns the
directory, a dirs-only level for the webroot and every ancestor, and whether
ripgrep is available, so the sidebar and the listing paint together. The earlier
shape needed seven serialized calls for a deep path: health, the tree root, the
listing, then one per level.

- Listings are cached for 10 seconds, so Back, Forward, and revisits paint with
  no request. `r` clears the cache and refetches.
- Hovering a directory row or a tree row prefetches that listing after 120 ms.
- Rows paint in chunks (`useChunked`): the first 200 immediately, then 400 per
  frame. The pre-React page showed the first screen of 5,001 entries in about
  4 ms and finished in about 60 ms. These numbers are not measured again for
  the React version yet.
- The filter debounces at 60 ms.
- The app files under `/__app/` are served `Cache-Control: no-cache`, so a
  repeat load revalidates to a 304 instead of downloading the files again. File
  bytes stay `no-store`, so an edited file always reads fresh.

Measured on this webroot: the API answers a listing in 1–4 ms, and 5,001 entries
with the tree in 46 ms.

### Limits

Every request stays inside the webroot. The service resolves each path against
the webroot and its top-level symlink targets, and rejects anything outside. It
skips `.git`, `node_modules`, and `__pycache__`; content search also skips
`*.eval`, `*.zip`, `*.safetensors`, and files over 8 MiB. Results cap at 400
matches and 25 seconds.

When the service is down, nginx answers the API with
`{"ok":false,"error":"search service is unreachable"}` and the UI prints the
start command instead of failing silently. Content search needs `rg` on PATH;
without it, browsing and name search still work.

### API

| Endpoint | Query | Returns |
| :-- | :-- | :-- |
| `/__api/health` | — | `{ok, root, ripgrep}` |
| `/__api/list` | `path`, `dirs=1` | one directory level, dirs then files |
| `/__api/search` | `q`, `mode`, `scope`, `glob`, `regex`, `case` | matches grouped by file |
| `GET /__api/review` | `path` | the comments on one document, with their current positions |
| `GET /__api/review` | `scope`, `status` | per-document comment counts under a directory |
| `POST /__api/review` | JSON `{op, path, ...}`; `op` is `comment`, `reply`, `status`, or `delete` | `{ok, op, id, path}` |

## Notebooks

Opening a `.ipynb` file in the browser renders the notebook. Markdown cells go
through the shared renderer, with Mermaid diagrams, code cells get the same highlighter with an
`In [n]` gutter, and outputs render as text, sanitized HTML (pandas tables),
images, or error tracebacks with ANSI codes stripped. The Raw button and
`?raw=1` return the notebook JSON. Notebooks over 8 MiB, usually from embedded
images, ask before rendering and offer the buffered text viewer.

The viewer is read only. Run cells and edit in Jupyter or VS Code.

## Large files

`conf/text.conf` renders `.log`, `.txt`, `.out`, `.err`, `.csv`, `.tsv`, and source and config
files (`.go`, `.py`, `.ts`, `.tsx`, `.jsx`, `.sh`, `.bash`, `.zsh`, `.yaml`, `.yml`, `.toml`) with
the text viewer (`src/viewers/TextViewer.tsx`), which reads the file in 256 KiB HTTP range requests
instead of downloading it. nginx answers ranges natively, so file size stops
mattering:

- The first screen appears after one 256 KiB request. Scrolling loads the next
  chunk, or `Load more` does it on demand.
- `End` jumps to the last 1 MiB of the file, for a log whose tail is the point.
  Line numbers are unavailable in that mode, and the card offers a read from the
  start.
- Find highlights matches in the loaded text and reports how many lines matched.
- `Wrap` toggles soft wrapping. `?raw=1` streams the bytes.

Measured on a 105.8 MiB log: the page opens with 256 KiB transferred, and `End`
adds one 1 MiB request.

The Markdown and JSON viewers check the size before they render. Over 2 MiB for
Markdown, or 4 MiB for JSON, the page offers three ways forward instead of
blocking: open the buffered text viewer, open the raw bytes, or render anyway.
Any path opens in the buffered viewer with `?view=text`.

## Inspect AI logs

Opening a `.eval` file in the browser opens it in the Inspect log viewer. In the
file explorer, a `.eval` file opens in the preview pane. One shared copy of that
viewer answers every log:

```bash
./scripts/inspect.sh viewer     # writes <webroot>/../inspect-view
```

`conf/inspect.conf` then redirects a navigation to `<log>.eval` to
`/__inspect/?log_file=<path>`, which the viewer reads with HTTP range
requests. The viewer assets are a build artifact of `inspect_ai`, so they live
outside the repo; until the command runs, a `.eval` URL explains how to install
them. `?raw=1` still downloads the archive.

A log directory that holds its own embedded viewer keeps serving that viewer,
because the `index` directive prefers `index.html`.

Per-directory viewer, useful for sharing a directory as a unit:

```bash
./scripts/inspect.sh embed <log-dir>     # writes index.html + assets into the log dir
./scripts/inspect.sh link <dir> [name]   # symlinks a directory under the webroot
./scripts/inspect.sh url <path>          # prints the http URL for a path
```

`embed` prints the URL when the log directory already resolves under the
webroot. Open it and the full viewer loads — task list, samples, transcript, and
scoring.

Live viewer, for a directory outside the webroot or for logs still being
written:

```bash
./scripts/inspect.sh serve <log-dir>
```

Then open `http://inspect.localhost/`. The viewer validates the browser origin,
so `serve` passes `--trusted-host inspect.localhost` and `--trusted-origin
http://inspect.localhost`. Without those flags the viewer answers `400` to every
proxied request.

`./scripts/inspect.sh bundle <log-dir> <out>` writes a standalone copy of the
viewer and the logs, for sharing a directory that outlives the source logs.

## Development

```bash
npm install          # once; if the internal mirror token is stale, add --registry https://registry.npmjs.org/
npm run lint         # ESLint: typescript-eslint, React hooks rules, braces on every if
npm test             # tsc --noEmit, then lint, then node --test, then the Python tests
npm run build        # release build to dist/app (minified, with source maps)
npm run dev          # rebuild on save, served by a throwaway nginx on port 8089
```

`npm run dev` runs `scripts/dev.sh`. The script installs into a temp config
dir with `--no-services`, starts a second nginx on that dir, and runs the
esbuild watcher with its output in the temp `dev-setup/app/`. A save is live
on the next browser reload. The installed server on port 80 does not change.
Ctrl-C stops the watcher and the second nginx, and deletes the temp dir.
To browse content, symlink a directory into the temp `www/` that the script
prints. Use `./scripts/dev.sh --port <n>` for another port.

The renderers in `src/markdown/render.ts` and `src/notebook/render.ts` are
pure functions, so `test/` checks them in node with no DOM.

To upgrade an install:

```bash
git pull && ./install.sh
```

A change reaches port 80 only through `./install.sh`, because the installer
copies the build and does not link it. The explorer API runs its scripts from
the checkout, so a change to `scripts/*.py` needs `nginxctl restart` instead.

## Revert

```bash
./install.sh --uninstall
```

The command removes `dev-setup/`, restores `nginx.conf.pre-dev-setup`, reloads
nginx, and stops the explorer service. To do the same by hand:

```bash
# Linux
sudo rm -rf /etc/nginx/dev-setup /etc/nginx/nginx.conf
sudo mv /etc/nginx/nginx.conf.pre-dev-setup /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx
systemctl --user disable --now nginx-explorer

# macOS, Homebrew
D=$(brew --prefix)/etc/nginx
rm -rf $D/dev-setup $D/nginx.conf && mv $D/nginx.conf.pre-dev-setup $D/nginx.conf
nginx -t && brew services restart nginx
launchctl bootout gui/$(id -u)/com.dev-setup.nginx-explorer
```

`nginx.conf.default` beside it holds the stock upstream config if you ever want
a clean baseline. It is not a backup of your current file.
