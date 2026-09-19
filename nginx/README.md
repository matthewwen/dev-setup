# nginx

Route local apps by hostname and browse the webroot through a file explorer.
Every directory URL is the explorer, so
`http://localhost/fmr_gyms/agentic-debt/` opens that directory. Four extras ride
on top of the file server: the explorer with search, rendered Markdown, rendered
JSON, and Inspect AI eval logs.

## Layout

```
install.sh   renders conf/ and links html/ into the nginx config dir, then reloads
conf/        nginx config templates; @...@ fields are filled at install time
html/        viewer pages, symlinked into the config dir
scripts/     helper commands (explorer.sh, explorer-server.py, inspect.sh)
scripts/platform.sh   OS and package detection shared by every script
systemd/     user unit for the explorer API (Linux)
launchd/     launch agent for the explorer API (macOS)
```

- `conf/nginx.conf` — main config copied from this machine.
- `conf/hosts.conf` — hostname-based virtual servers.
- `conf/proxy-dev.conf` — shared proxy headers, including websockets.
- `conf/maps.conf` — `$render_page`, which separates browser navigations from
  raw fetches. Included in the `http` block.
- `conf/explorer.conf`, `conf/md.conf`, `conf/json.conf`, `conf/text.conf`,
  `conf/inspect.conf` — feature snippets included in the default server.

On Linux nginx runs as `user root`, so a webroot symlinked to a build directory
under `$HOME` serves without chmod. With Homebrew on macOS nginx runs as the
login user on port 8080, which reads the same files without root.

## Install

```bash
./install.sh            # detect the platform, render, validate, reload
./install.sh --show     # print the detected layout and exit
```

The script:

- detects the OS and how nginx was installed, and reads the compiled paths from
  `nginx -V`
- backs up the existing main config once as `nginx.conf.pre-dev-setup` in the
  config dir
- renders every `conf/*.conf` into the config dir under its base name, with the
  paths and port filled in, and symlinks the `html/` pages beside them
- removes files it installed earlier and no longer owns, such as a renamed
  snippet
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

`nginx.service` usually runs with `PrivateTmp=true`, which gives it a private
`/tmp`. A link into `/tmp` passes `nginx -t`, which runs outside that sandbox,
and then fails the reload. The installer copies such a file instead of linking
it, and reports a failed reload with the log rather than leaving you guessing.

Entry points after install:

| URL | What |
| :-- | :-- |
| `http://localhost/<dir>/` | file explorer showing that directory |
| `http://localhost/<file>.md` | rendered Markdown |
| `http://localhost/<file>.json` | rendered JSON |
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

## Keeping the copies in step

`dev-setup/nginx` carries the same tree, so a teammate gets the same setup. The
files are identical on purpose:

```bash
diff -r "$MR_WS/nginx" "$DEV_WS/dev-setup/nginx"    # expect no output
```

Nothing in `conf/`, `html/`, or `scripts/` names a repo, so a change syncs with a
copy in either direction.

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
#         include proxy-dev.conf;
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

`conf/md.conf` rewrites a navigation to `*.md` to `html/md-viewer.html`, which
fetches the same path with `?raw=1` and renders it:

```
http://localhost/scratch/gym/auctioneer-capacity-planning/README.md
```

The viewer renders headings with anchors, tight and loose lists, task lists,
tables with alignment, fenced code with a language label and a copy button,
`diff` blocks, blockquotes, `<details>` sections, images, and YAML front matter.
It builds a contents sidebar, follows the OS light/dark preference, and keeps a
manual theme toggle in `localStorage`.

- The renderer is one self-contained file. It needs no network and no
  third-party code, so it works on a disconnected host.
- Unsupported by design: footnotes, LaTeX, and Mermaid. They render as literal
  text.
- `markdown-demo.md` exercises every construct. Open it to check an install.

## JSON

`conf/json.conf` renders `.json`, `.jsonl`, and `.ndjson` with
`html/json-viewer.html`:

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
index index.html /__explorer.html;
```

A directory serves its own `index.html` when it has one, which the Inspect
embedded viewer needs. Otherwise nginx falls back to the explorer page, so the
URL stays `/fmr_gyms/agentic-debt/` and the page reads its path from
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
- Rows paint in chunks: the first 200 immediately, then 400 per frame. A
  directory of 5,001 entries shows its first screen in about 4 ms and finishes in
  about 60 ms.
- The filter debounces at 60 ms, and keyboard movement reuses cached row handles
  instead of re-querying the DOM.
- The viewer pages are served `Cache-Control: no-cache`, so a repeat load
  revalidates to a 304 instead of downloading the page again. File bytes stay
  `no-store`, so an edited file always reads fresh.

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

## Large files

`conf/text.conf` renders `.log`, `.txt`, `.out`, `.err`, `.csv`, and `.tsv` with
`html/text-viewer.html`, which reads the file in 256 KiB HTTP range requests
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

Opening a `.eval` file in the browser opens it in the Inspect log viewer. One
shared copy of that viewer answers every log:

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

## Checking a change to a viewer

The Markdown renderer runs in node. Extract it and render a sample:

```bash
node - <<'EOF'
const fs = require("fs");
const src = fs.readFileSync("html/md-viewer.html", "utf8");
const start = src.indexOf("/* ============================ markdown renderer");
const end = src.indexOf("/* ================================= page");
fs.writeFileSync("/tmp/mdrender.mjs", src.slice(start, end) + "\nexport { renderMarkdown };");
EOF
node -e 'import("/tmp/mdrender.mjs").then(m => console.log(m.renderMarkdown("# hi\n\n- a\n- b\n").html))'
```

To test a config change without touching the running server, render into a temp
directory and run a second nginx on a high port:

```bash
T=$(mktemp -d); mkdir -p $T/etc $T/www $T/log; cp "$(nginx -V 2>&1 | tr ' ' '\n' | sed -n 's|--conf-path=||p' | xargs dirname)/mime.types" $T/etc/
NGINX_DIR=$T/etc NGINX_ROOT=$T/www NGINX_LOG_DIR=$T/log NGINX_PID=$T/nginx.pid \
  ./install.sh --port 8089 --no-services
nginx -c $T/etc/nginx.conf -p $T
```

## Revert

Restore the config saved by the installer:

```bash
# Linux
sudo rm -f /etc/nginx/nginx.conf
sudo mv /etc/nginx/nginx.conf.pre-dev-setup /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx

# macOS, Homebrew
D=$(brew --prefix)/etc/nginx
rm -f $D/nginx.conf && mv $D/nginx.conf.pre-dev-setup $D/nginx.conf
nginx -t && brew services restart nginx
launchctl bootout gui/$(id -u)/com.dev-setup.nginx-explorer
```

`nginx.conf.default` beside it holds the stock upstream config if you ever want
a clean baseline. It is not a backup of your current file.
