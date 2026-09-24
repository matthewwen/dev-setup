# Plan: nginx viewers as an npm package

Status: approved, revision 4. Implementation is underway in the `npm-setup`
worktree (`.claude/worktrees/npm-setup`).

Revision 2 applies three review comments: TypeScript for all source, one React
app built to static files instead of one page per viewer, and a copy-only
install with no symlinks. Upgrade is `git pull` then `./install.sh`.

Revision 4 drops the phased legacy-fallback migration. All work happens in a
worktree and is verified against the throwaway dev-loop nginx; nothing installs
to a real `/etc/nginx` until every viewer works, at which point there is one
cutover install instead of five phased conf flips. `nginx/html/*.html` stays in
the repo, unreferenced by any conf, purely as the source material each viewer
is ported from.

## Problem

`nginx/html/` holds five viewer pages and one shared script. Each page is one
file of 300 to 800 lines with CSS, markup, and JS inline. The pages repeat the
same code:

| Repeated block | Copies | Where |
| :-- | :-- | :-- |
| theme boot script (`md-theme` in localStorage) | 5 | every page, lines 12 to 16 |
| `:root` color tokens and dark overrides | 5 | 12 to 18 tokens each, mostly identical |
| `esc`, `human`, `tooBig`, `BIG_BYTES` | 3 to 4 | md, json, ipynb, text |
| `buildToc`, TOC toggle | 2 | md, ipynb |
| `runFind`, `findTimer` | 2 | json, text |
| `wireCopy` | 2 | md, ipynb |
| toolbar markup and button CSS | 5 | every page |

A manual change to a shared behavior means the same edit in up to five files.
A bug in one page is hard to isolate because the page is one script block with
no module boundary. The only test path is a README recipe that slices the
renderer out of an HTML file with string offsets.

On the install side, `install.sh` writes nine rendered confs and six page
symlinks flat into the nginx config dir. It finds its own files later by a
`# dev-setup:rendered` marker or by symlink target. The symlinks tie the
running server to the checkout path, so a moved or deleted checkout breaks the
server, and the layout gives no single place to look at what the repo owns on
a machine.

## Goals

1. One React app in TypeScript. One component per viewer, shared components
   for the toolbar, theme, size guard, find box, and copy buttons.
2. A build step that emits three static files: `index.html`, `app.js`,
   `app.css`, plus a source map. Every viewer URL serves the same page. The
   app picks the viewer from `location.pathname`.
3. An install that copies the build and the rendered confs under one directory
   in the nginx config dir, with a manifest that says what is there and where
   it came from. No symlinks. Upgrade is `git pull` and `./install.sh`.
4. A dev loop that rebuilds on save and serves through a throwaway nginx on a
   high port, without touching the installed server.
5. The site stays usable on a disconnected host. React ships inside `app.js`;
   nothing loads from a CDN.

## Non-goals

- No change to URLs the browser sees: `/<dir>/`, `/<file>.md`, `?raw=1`,
  `?view=text`, `/__raw/`, `/__api/`. The internal page paths
  (`/__md/viewer.html`, `/__explorer.html`) do change; nothing links to them.
- No change to `scripts/explorer-server.py`, `service.sh`, `inspect.sh`, or
  the systemd and launchd units beyond path constants.
- `install.sh` stays bash. Node builds; bash does sudo, systemctl, launchctl.
- No server-side rendering. The HTML shell is static and the app renders from
  fetched bytes, the same as today. "Static files" here means the build output
  is plain files nginx serves; there is no node process at request time.

## Package layout

`nginx/` becomes the package root. `package.json` lives here, not in `html/`,
because the confs and the installer consume the build output.

```
nginx/
  package.json            name: @dev-setup/nginx-viewers, private: true
  package-lock.json
  tsconfig.json           strict, jsx: react-jsx, noEmit (esbuild emits)
  build.mts               esbuild driver; `node build.mts [--watch] [--dev] [--out <dir>]`
  .gitignore              dist/  node_modules/
  README.md               user docs (existing, updated)
  PLAN.md                 this file; delete after implementation
  install.sh              existing; gains a build step and the new target layout
  conf/                   nginx templates; include paths and one shared rewrite target change
  scripts/                unchanged
  systemd/ launchd/       unchanged
  src/
    index.html            the one shell: theme boot, <div id=root>, app.css, app.js
    main.tsx              mounts <App/>
    app/
      App.tsx             reads location, picks a viewer, renders Toolbar + viewer
      route.ts            pickViewer(pathname, search): "explorer" | "md" | "json" | "ipynb" | "text" | "eval"
      theme.ts            boot() before first paint; useTheme() hook; md-theme in localStorage
      tokens.css          :root palette, [data-theme=dark] overrides, --sans, --mono
      base.css            body reset, toolbar, buttons, kbd, card, muted
    shared/
      Toolbar.tsx         title, Raw link, theme toggle, per-viewer action slot
      SizeGuard.tsx       HEAD the file; over the limit, show the three-way card
      FindBox.tsx         debounce, highlight, match count
      CopyButton.tsx      copy on code blocks
      fetch.ts            fetchRaw(path), headSize(path), rawUrl(), textViewUrl()
      format.ts           esc(), human(), pathParts()
    markdown/
      render.ts           renderMarkdown(src): { fm, html }; pure, no DOM; today's md-render.js
      highlight.ts        KEYWORDS, highlight(code, lang)
      toc.ts              headings -> TOC model
      Markdown.tsx        <Markdown src/>: renderMarkdown + dangerouslySetInnerHTML + CopyButton wiring
    notebook/
      render.ts           renderNotebook(json): cells model; ANSI strip; HTML sanitize
      Notebook.tsx
    viewers/
      MdViewer.tsx        TOC sidebar, front matter, Markdown
      JsonViewer.tsx      tree, filter, path chip, Source/Copy
      IpynbViewer.tsx
      TextViewer.tsx      range requests, End, Load more, Wrap
      explorer/
        Explorer.tsx      layout; owns the listing cache
        api.ts            /__api/list, /__api/search typed clients
        useRouting.ts     pushState, query-string options
        Directory.tsx     sortable table, chunked paint
        Tree.tsx          lazy sidebar, hover prefetch
        Search.tsx        modes, options, grouped results
        Preview.tsx       side pane
        useKeys.ts        keyboard map
  test/
    markdown.test.ts      node:test; renders fixtures and asserts on HTML
    notebook.test.ts
    route.test.ts
    build.test.ts         builds to a temp dir; asserts no external URL in the output
    fixtures/
      markdown-demo.md    the file the README already names as the smoke test
      sample.ipynb
  dist/                   build output, not in git
    app/
      index.html
      app.js
      app.css
      app.js.map          every build; copied by the installer
```

The explorer module split follows the section headers already in
`explorer.html` (`helpers`, `routing`, `directory`, `tree`, `search`,
`preview`, `events`, `keyboard`, `startup`). Each header becomes a file.

## Build

esbuild is the bundler. It compiles TypeScript and TSX natively, so there is
no separate tsc emit step. `tsc --noEmit` runs under `npm run check` for
types; esbuild does not type check.

Dependencies:

| Package | Kind | Why |
| :-- | :-- | :-- |
| react, react-dom | runtime, bundled into app.js | the UI |
| esbuild | dev | bundle TS, TSX, CSS |
| typescript | dev | type check only |
| @types/react, @types/react-dom | dev | types |

`build.mts`:

1. Bundle `src/main.tsx` to `dist/app/app.js` as one IIFE. `jsx: automatic`,
   `target: es2020`, `define process.env.NODE_ENV`.
2. Bundle `src/app/tokens.css`, `src/app/base.css`, and every CSS imported from
   a component into `dist/app/app.css`.
3. Copy `src/index.html` to `dist/app/index.html`. The shell references
   `/__app/app.css` and `/__app/app.js` by absolute path and carries the theme
   boot inline, because the theme must set before the stylesheet applies.
4. Always write `app.js.map`. `--dev`: no minify. Default: minify. React in
   production mode is about 45 KB gzipped; the whole bundle stays under 100 KB.
5. `--out <dir>` writes somewhere other than `dist/app`, which the dev loop
   uses to write straight into a throwaway nginx tree.

Scripts in `package.json`:

| Script | Runs |
| :-- | :-- |
| `npm run build` | `node build.mts` |
| `npm run watch` | `node build.mts --dev --watch` |
| `npm run check` | `tsc --noEmit` |
| `npm test` | `npm run check && node --test test/` |
| `npm run dev` | watch plus a throwaway nginx on port 8089 (see Dev loop) |

## Install target layout

`install.sh` copies. It writes one directory it owns, plus the main config
beside it. No file in the config dir points back at the checkout.

```
<nginx config dir>/                         /etc/nginx or $(brew --prefix)/etc/nginx
  nginx.conf                                rendered; includes dev-setup/conf/*.conf
  nginx.conf.pre-dev-setup                  one-time backup, unchanged behavior
  dev-setup/
    manifest.json
    conf/
      hosts.conf                            copied from the chosen hosts file
      proxy-dev.conf  maps.conf  explorer.conf  md.conf  json.conf
      ipynb.conf  text.conf  inspect.conf
    app/
      index.html  app.js  app.css  app.js.map   copied from dist/app
```

Because `hosts.conf` is copied too, the PrivateTmp special case in
`install.sh` (a link into `/tmp` that the service cannot see) goes away.

`manifest.json` records:

```json
{
  "package": "@dev-setup/nginx-viewers",
  "version": "0.1.0",
  "source": "/home/mattwen/workspaces/MegaT/src/dev-setup/nginx",
  "git": "7c0fd12",
  "installedAt": "2026-09-24T18:02:11Z",
  "hosts": "/home/mattwen/workspaces/MegaT/src/dev-setup/nginx/conf/hosts.local.conf",
  "platform": { "os": "linux", "pkg": "apt", "port": 80, "webroot": "/var/www/html" },
  "render": { "NGINX_DIR": "/etc/nginx", "PKG_DIR": "/etc/nginx/dev-setup", "WEBROOT": "/var/www/html", "PORT": "80" },
  "files": { "conf/explorer.conf": "sha256:...", "app/app.js": "sha256:..." }
}
```

`install.sh --show` prints the installed manifest next to the detected
platform, so "what version is on this box" is one command. `install.sh
--uninstall` removes `dev-setup/` and restores the backup, which the README
today spells out by hand.

Changes to `conf/`:

- `nginx.conf`: the eight `include x.conf;` lines become
  `include dev-setup/conf/x.conf;`.
- One new `@`-field: `@PKG_DIR@` = `<config dir>/dev-setup`.
- New `location ^~ /__app/ { alias @PKG_DIR@/app/; }` in `explorer.conf`,
  with `Cache-Control: no-cache` as the pages have today.
- `md.conf`, `json.conf`, `ipynb.conf`, `text.conf`: the rewrite target
  changes from the per-viewer page to `/__app/index.html`. The extension
  matching and the `$render_page` gate stay as they are.
- `explorer.conf`: `index index.html /__app/index.html;`. The
  `location = /__explorer.html` block and the five `location = /__x/viewer.html`
  blocks are removed.
- `md.conf`: the `/__md/render.js` alias is removed. Nothing fetches it.

The stale-file sweep in `install.sh` (the marker grep over `*.conf` and
`*.html`) is replaced by `rm -rf dev-setup/` and a fresh copy on every run.
Flat files and symlinks from the previous layout are removed once when they
carry the old marker or point into a checkout, so an upgrade leaves nothing
behind.

## Data flow

Build time:

```
src/main.tsx ─┬─ src/app/*  src/shared/*  src/viewers/*  react  ─ esbuild ─► dist/app/app.js
              └─ *.css imports ─────────────────────────────────── esbuild ─► dist/app/app.css
src/index.html ──────────────────────────────────────────────────── copy ────► dist/app/index.html
```

Install time:

```
git pull                        (upgrade path; nothing else to do first)
./install.sh
  ├─ npm install && npm run build   when node_modules/ or dist/ is missing or older than src/
  ├─ scripts/platform.sh        NGINX_DIR, NGINX_ROOT, NGINX_PORT, ...
  ├─ rm -rf <NGINX_DIR>/dev-setup
  ├─ render conf/*.conf ──────► <NGINX_DIR>/dev-setup/conf/
  ├─ cp hosts file ───────────► <NGINX_DIR>/dev-setup/conf/hosts.conf
  ├─ cp dist/app/* ───────────► <NGINX_DIR>/dev-setup/app/
  ├─ render conf/nginx.conf ──► <NGINX_DIR>/nginx.conf
  ├─ write manifest.json
  ├─ nginx -t
  └─ reload nginx; restart explorer service       (existing logic)
```

Request time:

```
browser GET /notes/README.md  (Sec-Fetch-Mode: navigate)
  → nginx  maps.conf sets $render_page=1
  → md.conf rewrites to /__app/index.html; the URL stays /notes/README.md
  → shell loads /__app/app.css and /__app/app.js
  → route.ts: pathname ends in .md, no ?view=text  →  <MdViewer path=...>
  → fetchRaw("/notes/README.md")  →  GET ...?raw=1  →  raw bytes
  → renderMarkdown() → <Markdown>

browser GET /notes/
  → explorer.conf index falls through to /__app/index.html
  → route.ts: trailing slash  →  <Explorer path="/notes/">
  → /__api/list?path=/notes/&tree=1
```

A `curl` or `fetch()` without the navigate header never reaches the app; it
gets raw bytes from nginx, as today.

Edit loop after a change to `src/`:

```
save src/shared/Toolbar.tsx
  → esbuild --watch rewrites dist/app in under 100 ms
  → ./install.sh              copies dist/app, nginx -t, reload; about 2 s
  → reload the browser
```

Or, for a change that should not touch the installed server yet, use the dev
loop below and never run `install.sh` until the change is done.

## Dev loop

`npm run dev` codifies the README recipe for a second nginx:

1. `mktemp -d` with `etc/`, `www/`, `log/`; copy `mime.types` in.
2. `NGINX_DIR=$T/etc NGINX_ROOT=$T/www ... ./install.sh --port 8089 --no-services`
3. `nginx -c $T/etc/nginx.conf -p $T` in the background.
4. `node build.mts --dev --watch --out $T/etc/dev-setup/app` in the
   foreground. Every save lands in the throwaway config dir; nginx serves the
   new file on the next request. Ctrl-C stops both.
5. Print `http://localhost:8089/` and a hint to symlink a directory into
   `$T/www` for content.

The installed server on port 80 is untouched until `./install.sh` runs.

## Tests

`node --test`, no framework. The renderers stay pure functions from string to
model or HTML, so they test without a DOM. React components get
`renderToString` smoke tests from `react-dom/server`, also without a DOM.

- `markdown.test.ts`: render `fixtures/markdown-demo.md`; assert on headings,
  anchors, table alignment, fenced code language label, front matter split,
  and that footnote and LaTeX syntax pass through as literal text. Replaces the
  README's string-offset extraction.
- `notebook.test.ts`: render `fixtures/sample.ipynb`; assert on `In [n]`
  gutters, an HTML output sanitized of `<script>`, and ANSI stripped from a
  traceback.
- `route.test.ts`: every extension and `?view=text` maps to the right viewer;
  a trailing slash maps to the explorer.
- `build.test.ts`: build into a temp dir; assert `index.html` references only
  `/__app/` paths and the bundle contains no `http://` or `https://` string
  other than the React license header. This is the "no network" guard.
- `install.sh` smoke: render into a temp dir and run `nginx -t` against it
  when `nginx` is on PATH; skip otherwise.

## Implementation plan

All work happens in the `npm-setup` worktree, one commit per phase. Every
phase is verified against the throwaway dev-loop nginx (`npm run dev` /
the temp-dir recipe), never against a real `/etc/nginx`. The one exception is
the final cutover in Phase 4, which is also the first time this plan touches
a live install.

### Phase 1: package scaffold and an empty app shell — done

- Added `package.json`, `tsconfig.json`, `build.mts`, `.gitignore`, and the
  dependencies. `build.mts` builds an empty React shell to `dist/app/`; there
  is no `dist/legacy` and no copy step for `html/*`.
- `install.sh`: added `@PKG_DIR@`, writes to `dev-setup/{conf,app}/`, copies
  the hosts file, writes `manifest.json`, runs `npm install` and the build
  when stale, removed the marker sweep and the `PrivateTmp` branch, added a
  one-time sweep of old flat files and symlinks from the pre-npm layout.
- `conf/`: updated the eight includes; every per-type location rewrites
  straight to `/__app/index.html`; the `?view=text` special-casing that used
  to pick between two physical pages is gone, since one shell now serves every
  viewer and the app reads the query string itself. Added the `/__app/`
  location.
- `scripts/platform.sh`: exports `NGINX_PKG_DIR`.
- Verified: temp-dir install plus `nginx -t`; the throwaway nginx serves the
  app shell for `/`, a `.md` navigation, and the app's own assets; a raw fetch
  of the same `.md` path still returns raw bytes; `ls -la` on the installed
  dir shows no symlink.

### Phase 2: app shell, routing, shared components — done

- Added `src/app/route.ts`, `theme.ts`, `tokens.css`, `base.css`, `App.tsx`
  (moved from `src/App.tsx`), and `src/shared/Toolbar.tsx`, `SizeGuard.tsx`,
  `fetch.ts`, `format.ts`. `main.tsx` now imports `app/tokens.css` and
  `app/base.css` instead of the Phase 1 placeholder `app.css`, which is
  removed.
- Unified the five `:root` blocks from `html/*.html` into `tokens.css`: every
  token name that appeared on more than one page carried the same light and
  dark value on every page it appeared on, so the merge is a plain union with
  no color change. `bg/bg-soft/bg-inset/fg/fg-muted/border/link/del/sans/mono`
  are shared by every page; `accent/quote/code-str/code-kw/code-num/code-com/
  add/shadow` came from md and ipynb; `key/str/num/bool/null` from json; `ok`
  from text; `sel/dir` from explorer; `mark` from every page but md.
- `base.css` carries the sticky header, `#crumbs`, and `.btn` rules verbatim
  from `md-viewer.html`'s chrome block, plus `kbd`/`.card`/`.muted`/`.error`
  for viewers to share in Phase 3. json/text/explorer had minor variations on
  the same rules (non-sticky header, different padding); those did not carry
  over, since one toolbar now serves every viewer.
- `route.ts` exports `pickViewer(pathname, search)`; a trailing slash is
  `explorer`, `?view=text` overrides the extension, and the extension map
  covers every suffix `conf/*.conf` rewrites on, plus `.eval` for
  `route.test.ts` completeness (nginx 302s `.eval` navigations to `/__inspect/`
  before the app ever sees them, so that branch is unreachable in practice).
- `Toolbar.tsx` renders crumbs as JSX children instead of the old
  `innerHTML` + `esc()`, so escaping is automatic. `SizeGuard.tsx` takes a
  `limitBytes` prop rather than a hardcoded `BIG_BYTES`, since the three
  ported pages used three different limits (2/4/8 MiB).
- `npm test` added (`tsc --noEmit && node --test test/`); `route.test.ts` and
  `build.test.ts` added. `build.test.ts` checks `index.html` for `/__app/`-only
  asset references and greps `app.js` for known CDN hostnames and remote
  dynamic imports; it does not assert on the literal absence of `http://`,
  since React's production bundle harmlessly embeds SVG/XML namespace URIs and
  a `reactjs.org` error-decoder link in never-fetched strings. `tsconfig.json`
  gained `allowImportingTsExtensions` for the tests' explicit `.ts` imports
  and now includes `test/`.
- Verified: `npm run check` and `node --test` (7/7 pass, no build warnings).
  Correction found in Phase 4: the `npm test` script (`node --test test/`)
  failed, because node reads `test/` as a module path. Phase 4 fixed it.
  Reinstalled into a fresh throwaway temp-dir nginx on port 8090: `/notes/`,
  a `.md` navigation, and a `.json` navigation all return the app shell
  (200, `text/html`); `/__app/app.js` and `/__app/app.css` serve with the
  right content types; `?raw=1` still bypasses the app. Not verified: actual
  browser rendering of the toolbar and placeholder card (no browser tool is
  available in this environment) - `curl` only confirms the static shell and
  asset delivery, not the React output. Open the URL in a real browser before
  trusting the visual result.

### Phase 3: port every viewer — done

Ported in order: text, json, md (plus the renderer), ipynb (notebook), explorer.

- **Shared additions along the way**: `shared/FindBox.tsx` (`FindBox` +
  `useDebounced`, first needed by the text viewer, reused by json and the
  explorer's search box), `shared/CopyButton.tsx` (json's toolbar Copy and
  every notebook code cell's copy button; the markdown renderer's own copy
  buttons are raw HTML inside `dangerouslySetInnerHTML`, so `Markdown.tsx`
  wires those through one delegated click listener instead).
- **`TextViewer`**: range-request reads, find-in-loaded-text, tail mode, wrap
  toggle. Verified range semantics directly against nginx (206 with
  `Content-Range: bytes X-Y/total`) with a 5,000-line log.
- **`JsonViewer`**: the tree is a typed node structure built once per parse
  (not raw HTML), so collapse state is `overrides: Record<path, boolean>`
  layered over each node's computed default. A search permanently expands
  matched ancestors, matching the original's one-way `classList.remove`.
  `SizeGuard` (from Phase 2) gates the parse.
- **`MdViewer` / `markdown/render.ts`**: `renderMarkdown()` is copied from
  `html/md-render.js` almost line for line, with one deliberate fix: the
  original's `headings`/`slugs` were module-level, which would leak
  between navigations in a persistent SPA. They are now per-call, with an
  optional shared `slugs` map parameter so a notebook can still dedupe anchor
  ids across cells the way the old module-level map did across a whole page.
  `tokens.css`'s union already carried every value md/ipynb need, so no new
  color decisions came up.
- **`notebook/render.ts`**: returns a typed `cells` model (markdown/raw/code,
  each output typed by kind) rather than one HTML string, so raw cells and
  most outputs render as plain JSX text with no `dangerouslySetInnerHTML` at
  all. `sanitize()` keeps the original's DOM-based pass for the browser and
  gained a regex-based fallback for when `DOMParser` is unavailable (this
  repo's own `node:test` environment) - the original's fallback there was a
  silent no-op, which is fine in production (`DOMParser` is always present in
  a browser) but made the sanitize-a-script-tag guarantee untestable.
- **Explorer**: split per the plan's file list (`api.ts`, `useRouting.ts`,
  `Directory.tsx` + `useChunked.ts`, `Tree.tsx`, `Search.tsx`, `Preview.tsx`,
  `useKeys.ts`, `Explorer.tsx`). Notable deviations from a literal port:
  - `Explorer.tsx` does not build its header from the shared `Toolbar`; its
    two-row header (tree/up/preview/theme/raw, then search options) is
    different enough that it never fit that component. This exposed a real
    scoping bug from Phase 2: `base.css`'s `header`/`#crumbs` rules were
    unscoped and would have applied to the explorer's very different header
    too. Fixed by scoping them to `header.toolbar` and giving `Toolbar.tsx`
    that class - the explorer's own `.explorer #crumbs` etc. in
    `Explorer.css` are unaffected either way.
  - The tree sidebar's lazy-loaded children persist in component state for
    the session; the original rebuilt the whole sidebar DOM on every
    navigation (cheap there, wasteful in React) and relied on a separate
    module-level cache Map for instant re-expansion. Same visible behavior
    (ancestor chain auto-expands per navigation, other branches collapse),
    same warm-cache-on-reopen property.
  - Startup and `popstate` call `openDirectory`/`performSearch` with the
    freshly-read route values directly, not through `qInput`/`searchOpts`
    state - `setState` inside the same tick would not be visible to a
    following read of that state in the same function.
- No unit tests for the explorer; it is API- and DOM-event-heavy rather than
  pure functions, and the Tests section of this plan does not list one.
- Verified: `npm run check` and `node --test` (20/20 pass, no build warnings).
  Reinstalled twice more into throwaway nginx instances: once with a 5,000-
  line log fixture for `TextViewer`'s range requests, and once pointed at the
  real webroot (through the already-running `explorer-server.py`) to check
  the explorer shell, `/__api/list`, a `.json` file end to end, and that
  `.eval` still 302s to `/__inspect/` untouched. `/__api/search` returned
  `{"ok":false,"error":"search failed"}` for every query - confirmed this is
  the already-running background service itself, not nginx or this port: the
  same call directly against `127.0.0.1:7576` (bypassing nginx) fails
  identically, and `scripts/explorer-server.py` is explicitly out of scope
  for this plan. Not verified: actual browser rendering of any viewer (no
  browser tool in this environment) - only asset delivery, status codes, and
  content types were checked by `curl`; open each viewer in a real browser
  before trusting the visual and interactive result. This includes the
  README's chunked-paint target (5,001 entries, first screen about 4 ms) -
  `useChunked` is wired up per the plan's fallback design, but the timing
  itself needs a real browser to measure.
- `html/*.html` and `md-render.js` are untouched, still the read-only
  reference material Phase 4 deletes.

### Phase 4: cutover, dev loop, docs

- Run `./install.sh` for real: one cutover, not five phased conf flips. The
  `/etc/nginx` on this host is a sandbox, so the cutover overwrites the stale
  install from revision 3 (its viewer confs still point at `legacy/*.html`).
  Verify every URL in the README's entry-point table on this host.
- Delete `html/*.html` and `md-render.js`. No conf, script, or build step
  reads them.
- `npm run dev` runs `scripts/dev.sh`, per the Dev loop section.
- `install.sh --show` prints the installed manifest. `install.sh --uninstall`
  removes `dev-setup/`, restores `nginx.conf.pre-dev-setup`, and stops the
  explorer service.
- Fix the `proxy-dev.conf` include in the `conf/hosts.conf` template. The
  file now lives at `dev-setup/conf/proxy-dev.conf`, and nginx resolves a
  relative include against the config dir.
- README: replace Layout, Install, Revert, and "Checking a change to a
  viewer". Add "Development" with the dev loop, the test commands, and the
  upgrade recipe (`git pull && ./install.sh`). Delete "Keeping the copies in
  step": since `a64f15d`, `MattWenScripts/nginx` holds only a per-machine
  `conf/hosts.conf`, not a copy of this tree.
- CLAUDE.md: delete "kept identical to `MattWenScripts/nginx`".
- Merge the `npm-setup` worktree branch and remove the worktree. Then rerun
  `./install.sh` from the main checkout, because the explorer unit points at
  the checkout that installed it.

Out of scope: `MattWenScripts/nginx/conf/hosts.conf` has the same stale
`include /etc/nginx/proxy-dev.conf;` in three server blocks. Fix it in that
repo before passing it to `--hosts`.

Status: every item is done except the merge and the worktree removal.

- Cutover: `./install.sh` to `/etc/nginx` passes `nginx -t` and reloads. Every
  README entry point responds on port 80: a directory, `.md`, `.json`,
  `.ipynb`, and `.log` return the app shell; `?raw=1` returns the bytes; `.eval`
  returns 302 to `/__inspect/`; `/__raw/` lists; `/__api/list` answers.
- The first run found an installer bug: the one-time sweep kept 7 old
  symlinks, because it removed only a link into the checkout that ran the
  installer. The sweep now matches the old layout's link names. A second run
  removed all 7.
- `npm run dev` found a second bug: a non-root nginx cannot create the temp
  dirs compiled into the rpm package (`/var/lib/nginx/tmp`), so `nginx -t`
  failed. `conf/nginx.conf` gained `@TEMP_PATHS@`. The installer fills it
  only when `NGINX_TEMP_DIR` is set, and `scripts/dev.sh` sets it. The
  installed config keeps the compiled-in paths.
- Verified the dev loop: it serves on 8089, a save reaches the served
  `app.js`, and SIGINT right after a save removes the temp dir and stops
  nginx. The first version of the trap left the temp dir behind in that case;
  the trap now stops the watcher and waits for it before the delete.
- Not fixed, out of scope: `/__api/search` answers "search failed" on this
  host. Two dangling symlinks in the webroot (`code/AGIStormGen`,
  `code/AGIOscar`) make `rg` exit 2, and `explorer-server.py` treats exit 2
  as a failure even when `rg` printed results.
- Not fixed: the cutover used the template `conf/hosts.conf`. The previous
  install linked `MattWenScripts/nginx/conf/hosts.conf`, so `docs.localhost`,
  `omnara.localhost`, and `inspect.localhost` do not route until that file
  gets the include fix and goes to `--hosts`.
- Not verified: browser rendering of each viewer, and the chunked-paint
  timing. No browser is available in this environment.

## Risks and notes

- **npm install needs the registry.** If `.npmrc` points at an internal
  mirror with a stale token, use
  `npm install --registry https://registry.npmjs.org/`. esbuild ships a native
  binary per platform through optional dependencies. The lockfile is not
  committed (the user's global `~/.gitignore` blanket-ignores
  `package-lock.json` in every repo), so the installer runs `npm install`,
  not `npm ci`, and resolves the platform binary fresh on each machine.
- **Node is a new prerequisite for install.** Today a teammate needs nginx and
  bash. After this, `install.sh` runs `npm install` and the build when `dist/` is
  missing or stale, and prints the `mise` or `brew install node` hint when
  `node` is absent, in the same style as the existing nginx hint. Node 22.18
  or newer is required: `build.mts` and the tests run as TypeScript through
  node's type stripping. The installer checks the version.
- **Copy means an edit needs `./install.sh`.** Today an edit to `html/` is
  live because of the symlink. After this, a change reaches port 80 only
  through the installer. That is the intent of the review comment; the dev
  loop on port 8089 covers iteration, and Phase 4 is the only phase that runs
  the installer against a real nginx.
- **No fallback while the app is incomplete.** Between Phase 1 and Phase 4, an
  `/etc/nginx` running this conf shows the "no viewer" placeholder for every
  path, not the real content — this is why nothing installs to a real host
  until Phase 4. If a real install is needed mid-migration for some other
  reason, keep the pre-`npm-setup` commit's `html/`-and-symlinks layout
  running there instead of this branch's confs.
- **`~/html -> <webroot>` is the one link left.** It is a user convenience
  outside the config dir, not part of the install format. It stays unless you
  want it gone too.
- **React and the 5,000-row listing.** See Phase 3. The fallback is a
  windowed list, not a rewrite.
- **One token set may change a color.** The five `:root` blocks differ in a
  few tokens. Unifying them is a small visual change on the pages that had
  fewer tokens. The Phase 2 commit records the diff.

## Decisions

All resolved by review.

1. TypeScript for all source. esbuild compiles it; `tsc --noEmit` checks it.
2. One React app built to `index.html`, `app.js`, `app.css`. Every viewer URL
   serves the same shell; the app routes by pathname.
3. No symlinks in the config dir. The installer copies. Upgrade is `git pull`
   then `./install.sh`.
4. `dist/` is not committed. `install.sh` builds when it is missing or stale.
5. The owned directory under the config dir is `dev-setup/`.
6. The release bundle is minified, with `app.js.map` written next to it and
   copied by the installer, so a built `app.js` in `/etc/nginx` is still
   debuggable in devtools. `--dev` builds do not minify.
7. `~/html -> <webroot>` stays. It is outside the config dir and the explorer
   edit API docs reference it.
