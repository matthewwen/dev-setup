#!/usr/bin/env python3
"""Browse and search API for the nginx file server.

Serves /api/list, /api/search, /api/review, and /api/health on 127.0.0.1.
nginx proxies /__api/ to it, and explorer.html is the browser client. Every
request stays inside the webroot, following its top-level symlinks. Content
search uses ripgrep when it is installed. Review comments live in the store
that review_store.py describes.
"""

import argparse
import getpass
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import review_store

DEFAULT_ROOT = os.environ.get("NGINX_ROOT", "/usr/share/nginx/html")
DEFAULT_PORT = int(os.environ.get("EXPLORER_PORT", os.environ.get("SEARCH_PORT", "7576")))

MAX_RESULTS = 400
MAX_PER_FILE = 20
TIMEOUT_S = 25
MAX_FILESIZE = "8M"
MAX_WRITE_BYTES = 8 * 1024 * 1024
MAX_REVIEW_BYTES = 64 * 1024
REVIEW_AUTHOR = os.environ.get("MD_REVIEW_AUTHOR") or getpass.getuser()
SKIP_GLOBS = ["!.git", "!node_modules", "!__pycache__"]
# Archives and build output are noise in content search but valid file names.
CONTENT_SKIP_GLOBS = ["!*.eval", "!*.zip", "!*.safetensors", "!build/private"]

ROOT = DEFAULT_ROOT
HAVE_RG = shutil.which("rg") is not None
EDIT_TOKEN = ""


def allowed_roots():
    """Real paths that a search may touch: the webroot and what it links to."""
    roots = [os.path.realpath(ROOT)]
    try:
        for entry in os.scandir(ROOT):
            roots.append(os.path.realpath(entry.path))
    except OSError:
        pass
    return roots


def resolve_scope(rel):
    """Map a webroot-relative path to a real directory, or raise ValueError."""
    rel = (rel or "").strip().lstrip("/")
    target = os.path.realpath(os.path.join(ROOT, rel))
    if not any(target == r or target.startswith(r + os.sep) for r in allowed_roots()):
        raise ValueError("scope is outside the webroot")
    if not os.path.isdir(target):
        raise ValueError("scope is not a directory")
    return rel, target


def resolve_file(rel, must_exist=False):
    """Resolve one webroot-relative file path without allowing an escape."""
    rel = (rel or "").strip().lstrip("/")
    if not rel or "\0" in rel:
        raise ValueError("path is required")
    raw = os.path.abspath(os.path.join(ROOT, rel))
    target = os.path.realpath(raw)
    if not any(target == root or target.startswith(root + os.sep) for root in allowed_roots()):
        raise ValueError("path is outside the webroot")
    if target == os.path.realpath(ROOT):
        raise ValueError("the webroot itself cannot be changed")
    if os.path.islink(raw):
        raise ValueError("refusing to change a symlink")
    if must_exist and not os.path.lexists(raw):
        raise FileNotFoundError("path does not exist")
    return target


def write_file(rel, content):
    """Atomically create or replace a UTF-8 file inside an allowed webroot."""
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    data = content.encode("utf-8")
    if len(data) > MAX_WRITE_BYTES:
        raise ValueError("content exceeds the %d MiB limit" % (MAX_WRITE_BYTES // (1024 * 1024)))
    target = resolve_file(rel)
    if os.path.isdir(target):
        raise ValueError("path is a directory")
    parent = os.path.dirname(target)
    if not os.path.isdir(parent):
        raise ValueError("parent directory does not exist")
    fd, temporary = tempfile.mkstemp(prefix=".explorer-write-", dir=parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(temporary, target)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    return target


def make_directory(rel):
    """Create one new directory inside an allowed webroot."""
    target = resolve_file(rel)
    if os.path.lexists(target):
        raise ValueError("path already exists")
    parent = os.path.dirname(target)
    if not os.path.isdir(parent):
        raise ValueError("parent directory does not exist")
    os.mkdir(target)
    return target


def delete_path(rel):
    """Delete one file or an empty directory inside an allowed webroot."""
    target = resolve_file(rel, must_exist=True)
    if os.path.isdir(target):
        os.rmdir(target)
    else:
        os.unlink(target)
    return target


def url_for(rel_scope, rel_path):
    parts = [p for p in (rel_scope, rel_path) if p]
    return "/" + "/".join(parts)


def run(cmd):
    proc = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=TIMEOUT_S
    )
    # ripgrep exits 1 when it finds nothing, which is not an error here.
    if proc.returncode not in (0, 1):
        raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip() or "search failed")
    return proc.stdout.decode("utf-8", "replace").splitlines()


def glob_args(globs, extra_skips=()):
    args = []
    for pattern in list(SKIP_GLOBS) + list(extra_skips):
        args += ["--glob", pattern]
    for pattern in (globs or "").split(","):
        pattern = pattern.strip()
        if pattern:
            args += ["--glob", pattern]
    return args


def list_files(target, globs):
    if HAVE_RG:
        return run(["rg", "--files", "--hidden", "--follow", "--no-messages"]
                   + glob_args(globs) + ["--", target])
    out = []
    for dirpath, dirnames, filenames in os.walk(target, followlinks=True):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__")]
        out += [os.path.join(dirpath, f) for f in filenames]
    return out


def search_names(q, rel_scope, target, globs, regex, icase):
    matcher = build_matcher(q, regex, icase)
    results = []
    for abspath in list_files(target, globs):
        rel_path = os.path.relpath(abspath, target)
        if not matcher(rel_path):
            continue
        try:
            st = os.stat(abspath)
            size, mtime = st.st_size, st.st_mtime
        except OSError:
            size, mtime = 0, 0
        results.append({
            "url": url_for(rel_scope, rel_path),
            "path": rel_path,
            "name": os.path.basename(rel_path),
            "dir": os.path.dirname(rel_path),
            "size": size,
            "mtime": mtime,
            "matches": [],
        })
        if len(results) >= MAX_RESULTS:
            break
    results.sort(key=lambda r: -r["mtime"])
    return results


def build_matcher(q, regex, icase):
    if regex:
        rx = re.compile(q, re.IGNORECASE if icase else 0)
        return lambda s: rx.search(s) is not None
    if icase:
        needle = q.lower()
        return lambda s: needle in s.lower()
    return lambda s: q in s


def search_content(q, rel_scope, target, globs, regex, icase):
    if not HAVE_RG:
        raise RuntimeError("content search needs ripgrep (rg) on PATH")
    cmd = ["rg", "--line-number", "--with-filename", "--no-heading", "--color", "never",
           "--no-messages", "--hidden", "--follow",
           "--max-count", str(MAX_PER_FILE), "--max-filesize", MAX_FILESIZE,
           "--max-columns", "400", "--max-columns-preview"]
    cmd += ["--ignore-case"] if icase else ["--case-sensitive"]
    if not regex:
        cmd.append("--fixed-strings")
    cmd += glob_args(globs, CONTENT_SKIP_GLOBS)
    cmd += ["-e", q, "--", target]

    by_file = {}
    order = []
    total = 0
    for line in run(cmd):
        abspath, _, rest = line.partition(":")
        lineno, _, text = rest.partition(":")
        if not lineno.isdigit():
            continue
        rel_path = os.path.relpath(abspath, target)
        if rel_path not in by_file:
            by_file[rel_path] = {
                "url": url_for(rel_scope, rel_path),
                "path": rel_path,
                "name": os.path.basename(rel_path),
                "dir": os.path.dirname(rel_path),
                "matches": [],
            }
            order.append(rel_path)
        by_file[rel_path]["matches"].append({"line": int(lineno), "text": text[:400]})
        total += 1
        if total >= MAX_RESULTS:
            break
    return [by_file[p] for p in order]


def list_dir(rel_scope, target, dirs_only=False):
    """One directory level, directories first, then files, both by name."""
    dirs, files = [], []
    with os.scandir(target) as it:
        for entry in it:
            try:
                is_dir = entry.is_dir()
            except OSError:
                continue
            if is_dir and entry.name in ("__pycache__", ".git"):
                continue
            if not is_dir and dirs_only:
                continue
            try:
                st = entry.stat()
                size, mtime = st.st_size, st.st_mtime
            except OSError:
                size, mtime = 0, 0
            item = {
                "name": entry.name,
                "type": "dir" if is_dir else "file",
                "size": 0 if is_dir else size,
                "mtime": mtime,
                "url": url_for(rel_scope, entry.name) + ("/" if is_dir else ""),
                "path": "/".join(p for p in (rel_scope, entry.name) if p),
                "link": entry.is_symlink(),
                "ext": "" if is_dir else os.path.splitext(entry.name)[1].lower().lstrip("."),
                "hidden": entry.name.startswith("."),
            }
            (dirs if is_dir else files).append(item)
    key = lambda e: e["name"].lower()
    dirs.sort(key=key)
    files.sort(key=key)
    parent = "/".join(rel_scope.split("/")[:-1]) if rel_scope else None
    return {
        "path": "/" + rel_scope,
        "parent": None if parent is None else "/" + parent,
        "dirs": len(dirs),
        "files": len(files),
        "entries": dirs + files,
    }


def tree_levels(rel_scope):
    """Dirs-only listings for the webroot and every ancestor of rel_scope.

    One response fills the whole sidebar, so the client needs no request per
    level while it expands down to the current directory.
    """
    cumulative = [""]
    acc = ""
    for part in [p for p in rel_scope.split("/") if p]:
        acc = (acc + "/" + part).lstrip("/")
        cumulative.append(acc)

    levels = []
    for rel in cumulative:
        try:
            _, target = resolve_scope(rel)
            levels.append(list_dir(rel, target, dirs_only=True))
        except (ValueError, OSError):
            break
    return levels


def merge(name_hits, content_hits):
    """Fold content matches into name matches so each file appears once."""
    by_path = {r["path"]: r for r in name_hits}
    ordered = list(name_hits)
    for hit in content_hits:
        existing = by_path.get(hit["path"])
        if existing:
            existing["matches"] = hit["matches"]
        else:
            by_path[hit["path"]] = hit
            ordered.append(hit)
    return ordered


class Handler(BaseHTTPRequestHandler):
    server_version = "nginx-explorer/1.0"
    protocol_version = "HTTP/1.1"

    def send_json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("invalid Content-Length")
        if length <= 0:
            raise ValueError("JSON request body is required")
        if length > MAX_WRITE_BYTES + 4096:
            raise ValueError("request exceeds the %d MiB limit" % (MAX_WRITE_BYTES // (1024 * 1024)))
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as err:
            raise ValueError("invalid JSON: %s" % err.msg)

    def has_edit_access(self):
        supplied = self.headers.get("X-Explorer-Token", "")
        return bool(EDIT_TOKEN) and hmac.compare_digest(supplied, EDIT_TOKEN)

    def review_document(self, rel):
        """(store key, lines) for a webroot-relative document path."""
        target = resolve_file(rel, must_exist=True)
        if not os.path.isfile(target):
            raise ValueError("path is not a file")
        return review_store.key_for(target, ROOT), review_store.read_document(target)

    # POST /api/review needs no token and accepts any Origin. The handler
    # writes only into the review store: the request names a document to
    # comment on, never a target path to write. A missing author becomes the
    # login name of the user that runs this server, as in mdreview.py.
    def post_review(self):
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self.send_json(415, {"ok": False, "error": "Content-Type must be application/json"})
            return
        try:
            if int(self.headers.get("Content-Length", "0") or 0) > MAX_REVIEW_BYTES:
                raise ValueError("request exceeds the %d KiB limit" % (MAX_REVIEW_BYTES // 1024))
            payload = self.read_json()
            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object")
            operation = payload.get("op")
            if not str(payload.get("author") or "").strip():
                payload["author"] = REVIEW_AUTHOR
            key, lines = self.review_document(payload.get("path"))
            comment_id = review_store.apply(key, operation, payload, lines)
        except (ValueError, FileNotFoundError, OSError) as err:
            self.send_json(400, {"ok": False, "error": str(err)})
            return
        code = 201 if operation == "comment" else 200
        self.send_json(code, {"ok": True, "op": operation, "id": comment_id, "path": "/" + key})

    def get_review(self, get):
        status = get("status", "open")
        if status not in ("open", "resolved", "all"):
            status = "open"
        try:
            if get("path"):
                key, lines = self.review_document(get("path"))
                payload = review_store.document_report(key, lines, "all")
            else:
                rel_scope, scope_dir = resolve_scope(get("scope"))
                prefix = review_store.key_for(scope_dir, ROOT) if rel_scope else ""
                payload = review_store.scope_report(prefix, status)
        except (ValueError, FileNotFoundError, OSError) as err:
            self.send_json(400, {"ok": False, "error": str(err)})
            return
        payload["ok"] = True
        self.send_json(200, payload)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/review", "/review"):
            self.post_review()
            return
        if parsed.path not in ("/api/files", "/files"):
            self.send_json(404, {"ok": False, "error": "unknown endpoint"})
            return
        if not self.has_edit_access():
            self.send_json(403, {"ok": False, "error": "edit access denied"})
            return
        try:
            payload = self.read_json()
            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object")
            operation = payload.get("op")
            path = payload.get("path")
            if operation == "write":
                target = write_file(path, payload.get("content"))
                code = 200
            elif operation == "mkdir":
                target = make_directory(path)
                code = 201
            elif operation == "delete":
                target = delete_path(path)
                code = 200
            else:
                raise ValueError("op must be write, mkdir, or delete")
        except (ValueError, FileNotFoundError, OSError) as err:
            self.send_json(400, {"ok": False, "error": str(err)})
            return
        self.send_json(code, {"ok": True, "op": operation, "path": "/" + os.path.relpath(target, ROOT)})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        args = urllib.parse.parse_qs(parsed.query)
        get = lambda k, d="": (args.get(k, [d])[0] or "").strip()

        if parsed.path in ("/api/health", "/health"):
            self.send_json(200, {"ok": True, "root": ROOT, "ripgrep": HAVE_RG,
                                 "edit_enabled": bool(EDIT_TOKEN)})
            return

        if parsed.path in ("/api/review", "/review"):
            self.get_review(get)
            return

        if parsed.path in ("/api/list", "/list"):
            try:
                rel_scope, target = resolve_scope(get("path"))
            except ValueError as err:
                self.send_json(400, {"ok": False, "error": str(err)})
                return
            try:
                payload = list_dir(rel_scope, target, get("dirs") in ("1", "true"))
                if get("tree") in ("1", "true"):
                    payload["tree"] = tree_levels(rel_scope)
                    payload["ripgrep"] = HAVE_RG
            except OSError as err:
                self.send_json(400, {"ok": False, "error": err.strerror or str(err)})
                return
            payload["ok"] = True
            self.send_json(200, payload)
            return

        if parsed.path not in ("/api/search", "/search"):
            self.send_json(404, {"ok": False, "error": "unknown endpoint"})
            return

        q = get("q")
        if not q:
            self.send_json(400, {"ok": False, "error": "q is required"})
            return

        mode = get("mode", "content")
        if mode not in ("content", "names", "both"):
            mode = "content"
        regex = get("regex") in ("1", "true")
        icase = get("case") not in ("1", "true")

        try:
            rel_scope, target = resolve_scope(get("scope"))
        except ValueError as err:
            self.send_json(400, {"ok": False, "error": str(err)})
            return

        started = time.time()
        try:
            results = []
            if mode in ("names", "both"):
                results += search_names(q, rel_scope, target, get("glob"), regex, icase)
            if mode in ("content", "both"):
                results = merge(results, search_content(q, rel_scope, target, get("glob"), regex, icase))
        except subprocess.TimeoutExpired:
            self.send_json(504, {"ok": False, "error": "search timed out after %ds" % TIMEOUT_S})
            return
        except (RuntimeError, re.error) as err:
            self.send_json(400, {"ok": False, "error": str(err)})
            return

        matches = sum(max(len(r["matches"]), 1) for r in results)
        self.send_json(200, {
            "ok": True,
            "mode": mode,
            "query": q,
            "scope": "/" + rel_scope,
            "count": len(results),
            "matches": matches,
            "truncated": matches >= MAX_RESULTS,
            "took_ms": int((time.time() - started) * 1000),
            "results": results,
        })

    def log_message(self, fmt, *fmt_args):
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % fmt_args))


def main():
    global ROOT, EDIT_TOKEN
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=DEFAULT_ROOT, help="webroot to search")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--edit-token-file", default=os.environ.get("EXPLORER_EDIT_TOKEN_FILE"),
                        help="file containing the token required for POST /api/files")
    opts = parser.parse_args()

    ROOT = os.path.abspath(opts.root)
    if not os.path.isdir(ROOT):
        sys.exit("No such webroot: %s" % ROOT)
    if opts.edit_token_file:
        try:
            with open(opts.edit_token_file, encoding="utf-8") as handle:
                EDIT_TOKEN = handle.read().strip()
        except OSError as err:
            sys.exit("Unable to read edit token: %s" % err)
        if not EDIT_TOKEN:
            sys.exit("Edit token file is empty: %s" % opts.edit_token_file)

    engine = "ripgrep" if HAVE_RG else "python walk (names only)"
    print("Explorer API on http://%s:%d  root=%s  engine=%s" % (opts.host, opts.port, ROOT, engine))
    ThreadingHTTPServer((opts.host, opts.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
