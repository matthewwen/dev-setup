"""Comment store for the review of rendered Markdown.

One append-only JSONL file per document lives under
${XDG_STATE_HOME:-~/.local/state}/dev-setup/md-review/, keyed by the
document's webroot-relative path. explorer-server.py and mdreview.py both
import this module, so the browser and the command line share one
implementation of the format, of the path mapping, and of the re-anchoring.

The store never holds the document. A comment anchors to a line range plus a
whitespace-insensitive hash of those lines. resolve() finds where that text
lives in the current document on every read and never writes back.
"""

import fcntl
import hashlib
import json
import os
import re
import secrets
import time

MAX_BODY_CHARS = 8 * 1024
MAX_SELECTION_CHARS = 2 * 1024
MAX_AUTHOR_CHARS = 64
MAX_EVENTS = 2000
MAX_DOC_BYTES = 8 * 1024 * 1024
QUOTE_WINDOW_LINES = 8

ID_RE = re.compile(r"^[a-z2-7]{6}$")
ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
EVENTS = ("comment", "reply", "status", "delete")
STATUSES = ("open", "resolved")
ACTIONS = ("fixed", "answered", "wontfix")


# ============================================================================
# Paths
# ============================================================================

def store_dir():
    override = os.environ.get("MD_REVIEW_DIR")
    if override:
        return override
    state = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(state, "dev-setup", "md-review")


def allowed_roots(root):
    """(real path, key prefix) pairs: the webroot and each top-level entry."""
    roots = [(os.path.realpath(root), "")]
    try:
        for entry in os.scandir(root):
            roots.append((os.path.realpath(entry.path), entry.name))
    except OSError:
        pass
    return roots


def key_for(path, root):
    """Map a filesystem path to its store key, the webroot-relative path.

    The webroot is a farm of symlinks, so one file has a path on disk and a
    different path under the webroot. Take the longest real-path match among
    the webroot and its top-level entries. Raise ValueError outside them all.
    """
    real = os.path.realpath(path)
    candidates = sorted(allowed_roots(root), key=lambda pair: (-len(pair[0]), pair[1]))
    for real_dir, prefix in candidates:
        base = real_dir.rstrip(os.sep) + os.sep
        if real == real_dir or real.startswith(base):
            rest = real[len(real_dir):].strip(os.sep).replace(os.sep, "/")
            key = "/".join(part for part in (prefix, rest) if part)
            if key:
                return key
    raise ValueError("%s is outside the webroot %s" % (path, root))


def store_path(key):
    key = key.strip("/")
    parts = key.split("/")
    if not key or any(part in ("", ".", "..") for part in parts):
        raise ValueError("invalid store key: %r" % key)
    return os.path.join(store_dir(), *parts) + ".jsonl"


def list_keys(prefix=""):
    """Store keys under a key prefix, in sorted order."""
    base = store_dir()
    prefix = prefix.strip("/")
    keys = []
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if not name.endswith(".jsonl"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), base)[: -len(".jsonl")]
            key = rel.replace(os.sep, "/")
            if not prefix or key == prefix or key.startswith(prefix + "/"):
                keys.append(key)
    return sorted(keys)


def move(old_key, new_key):
    """Rename a document's store file after the document moved."""
    src = store_path(old_key)
    dst = store_path(new_key)
    if not os.path.exists(src):
        raise FileNotFoundError("no comments stored for %s" % old_key)
    if os.path.exists(dst):
        raise ValueError("%s already has comments; merge them by hand" % new_key)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.replace(src, dst)


# ============================================================================
# Documents
# ============================================================================

def split_lines(text):
    """Lines the way render.ts sees them: one entry per newline-separated line."""
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def read_document(path):
    if os.path.getsize(path) > MAX_DOC_BYTES:
        raise ValueError("document exceeds the %d MiB limit" % (MAX_DOC_BYTES // (1024 * 1024)))
    with open(path, encoding="utf-8", errors="replace") as handle:
        return split_lines(handle.read())


def collapse(text):
    return " ".join(text.split())


def block_hash(text):
    """Hash of the block with every run of whitespace collapsed.

    render.ts turns tabs into spaces and drops carriage returns before it
    splits lines. Collapsing whitespace makes the hash independent of that
    normalization, so Python never has to reproduce it.
    """
    return hashlib.sha256(collapse(text).encode("utf-8")).hexdigest()


# ============================================================================
# Anchors
# ============================================================================

def make_anchor(lines, line, end_line, selection=None):
    """Anchor for lines[line-1:end_line] of the current document, 1-based."""
    if not (1 <= line <= end_line <= len(lines)):
        raise ValueError("lines %d-%d fall outside the document, which has %d lines" % (line, end_line, len(lines)))
    text = "\n".join(lines[line - 1:end_line])
    if not text.strip():
        raise ValueError("the anchored lines are blank")
    anchor = {"line": line, "endLine": end_line, "hash": block_hash(text), "quote": text}
    if selection:
        anchor["selection"] = selection
    return anchor


def find_quote(lines, quote):
    """Line range that contains the collapsed quote exactly once, or None."""
    collapsed = [collapse(line) for line in lines]
    for size in range(1, min(QUOTE_WINDOW_LINES, len(lines)) + 1):
        matches = []
        for start in range(len(lines) - size + 1):
            if quote in " ".join(collapsed[start:start + size]):
                matches.append(start)
        if len(matches) == 1:
            return matches[0] + 1, matches[0] + size
        if matches:
            return None
    return None


def resolve(anchor, lines):
    """Locate an anchor in the current document.

    Returns {"confidence": ...} plus line, endLine, and text when found.
    Confidence is exact, moved, quote, orphan, or document for a note that has
    no anchor. Never writes back to the store.
    """
    if not anchor or anchor.get("line") is None:
        return {"confidence": "document"}
    if lines is None:
        return {"confidence": "orphan"}
    line = int(anchor["line"])
    size = int(anchor.get("endLine") or line) - line + 1
    want = anchor.get("hash")
    count = len(lines)

    def window(start):
        return "\n".join(lines[start - 1:start - 1 + size])

    # A window must start and end on text. Collapsed hashing would otherwise
    # let a block plus a blank line match the block alone.
    def whole(start):
        return 1 <= start and start + size - 1 <= count and lines[start - 1].strip() and lines[start + size - 2].strip()

    def hit(confidence, start):
        return {"confidence": confidence, "line": start, "endLine": start + size - 1, "text": window(start)}

    if want and size > 0 and whole(line) and block_hash(window(line)) == want:
        return hit("exact", line)
    if want and size > 0:
        matches = [start for start in range(1, count - size + 2) if whole(start) and block_hash(window(start)) == want]
        if len(matches) == 1:
            return hit("moved", matches[0])
    quote = collapse(anchor.get("quote") or "")
    if quote:
        found = find_quote(lines, quote)
        if found:
            start, end = found
            return {"confidence": "quote", "line": start, "endLine": end, "text": "\n".join(lines[start - 1:end])}
    return {"confidence": "orphan"}


# ============================================================================
# Events
# ============================================================================

def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id(taken):
    while True:
        candidate = "".join(secrets.choice(ID_ALPHABET) for _ in range(6))
        if candidate not in taken:
            return candidate


def clean_author(author):
    author = " ".join(str(author or "").split())[:MAX_AUTHOR_CHARS]
    return author or "anonymous"


def clean_body(body):
    if not isinstance(body, str) or not body.strip():
        raise ValueError("body is required")
    if len(body) > MAX_BODY_CHARS:
        raise ValueError("body exceeds %d characters" % MAX_BODY_CHARS)
    return body.strip()


def validate_event(event):
    if event.get("ev") not in EVENTS:
        raise ValueError("ev must be one of %s" % ", ".join(EVENTS))
    if not ID_RE.match(str(event.get("id", ""))):
        raise ValueError("id must be six characters of a-z and 2-7")
    if event["ev"] == "status":
        if event.get("status") not in STATUSES:
            raise ValueError("status must be open or resolved")
        if event["status"] == "resolved" and event.get("action") not in ACTIONS:
            raise ValueError("action must be fixed, answered, or wontfix")


def read_events(key):
    path = store_path(key)
    events = []
    try:
        with open(path, encoding="utf-8") as handle:
            for number, raw in enumerate(handle, 1):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    events.append(json.loads(raw))
                except json.JSONDecodeError as err:
                    raise ValueError("%s:%d: %s" % (path, number, err.msg))
    except FileNotFoundError:
        pass
    return events


def append(key, event):
    """Append one event under an exclusive lock, as one write() call."""
    validate_event(event)
    path = store_path(key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    line = (json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            with open(path, "rb") as handle:
                existing = sum(1 for raw in handle if raw.strip())
            if existing >= MAX_EVENTS:
                raise ValueError("%s holds %d events; compact it before adding more" % (key, existing))
            os.write(fd, line)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def replay(events):
    """Fold events, in order, into the current comments keyed by id.

    The last status event wins. A delete event removes the comment from every
    listing. Events for an unknown id are ignored.
    """
    comments = {}
    for event in events:
        kind = event.get("ev")
        cid = event.get("id")
        if kind == "comment":
            comments[cid] = {
                "id": cid,
                "status": "open",
                "action": None,
                "author": event.get("author", ""),
                "ts": event.get("ts", ""),
                "body": event.get("body", ""),
                "anchor": event.get("anchor") or {"line": None},
                "replies": [],
            }
            continue
        comment = comments.get(cid)
        if comment is None:
            continue
        if kind == "reply":
            comment["replies"].append({
                "author": event.get("author", ""),
                "ts": event.get("ts", ""),
                "body": event.get("body", ""),
            })
        elif kind == "status":
            comment["status"] = event.get("status", "open")
            comment["action"] = event.get("action") if comment["status"] == "resolved" else None
        elif kind == "delete":
            del comments[cid]
    return comments


def load(key):
    return replay(read_events(key))


# ============================================================================
# Mutations shared by the API and the CLI
# ============================================================================

def apply(key, op, payload, lines):
    """Validate one mutation and append it. Returns the comment id.

    `payload` is the JSON object from the browser or the argparse namespace
    turned into a dict. `lines` is the current document, needed only for
    op=comment with an anchor.
    """
    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")
    author = clean_author(payload.get("author"))
    comments = load(key)
    stamp = now()

    if op == "comment":
        body = clean_body(payload.get("body"))
        anchor_in = payload.get("anchor")
        if anchor_in is None or anchor_in.get("line") is None:
            anchor = {"line": None}
        else:
            if lines is None:
                raise ValueError("the document is needed to anchor a comment")
            try:
                line = int(anchor_in["line"])
                end_line = int(anchor_in.get("endLine") or line)
            except (TypeError, ValueError):
                raise ValueError("anchor.line and anchor.endLine must be integers")
            selection = anchor_in.get("selection")
            if selection is not None:
                if not isinstance(selection, str) or len(selection) > MAX_SELECTION_CHARS:
                    raise ValueError("selection must be a string of at most %d characters" % MAX_SELECTION_CHARS)
                selection = selection.strip() or None
            anchor = make_anchor(lines, line, end_line, selection)
            seen = anchor_in.get("text")
            if seen is not None and collapse(str(seen)) != collapse(anchor["quote"]):
                raise ValueError("the document changed after the page loaded; reload it and comment again")
        cid = payload.get("id") or new_id(comments)
        if not ID_RE.match(str(cid)):
            raise ValueError("id must be six characters of a-z and 2-7")
        if cid in comments:
            raise ValueError("comment %s already exists" % cid)
        event = {"ev": "comment", "id": cid, "ts": stamp, "author": author, "body": body, "anchor": anchor}
        append(key, event)
        return cid

    cid = str(payload.get("id") or "")
    if cid not in comments:
        raise ValueError("no comment %s in %s" % (cid or "(none)", key))
    if op == "reply":
        event = {"ev": "reply", "id": cid, "ts": stamp, "author": author, "body": clean_body(payload.get("body"))}
    elif op == "status":
        status = payload.get("status")
        if status not in STATUSES:
            raise ValueError("status must be open or resolved")
        event = {"ev": "status", "id": cid, "ts": stamp, "author": author, "status": status}
        if status == "resolved":
            if payload.get("action") not in ACTIONS:
                raise ValueError("action must be fixed, answered, or wontfix")
            event["action"] = payload["action"]
    elif op == "delete":
        event = {"ev": "delete", "id": cid, "ts": stamp, "author": author}
    else:
        raise ValueError("op must be comment, reply, status, or delete")
    append(key, event)
    return cid


# ============================================================================
# Reports
# ============================================================================

def sort_key(comment):
    resolved = comment.get("resolved") or {}
    line = resolved.get("line") or (comment.get("anchor") or {}).get("line") or 0
    return (line, comment.get("ts", ""))


def document_report(key, lines, status="all"):
    """Comments for one document with their resolved positions and counts.

    `lines` is None when the document is missing; every anchored comment is
    then an orphan.
    """
    comments = []
    counts = {"open": 0, "resolved": 0, "orphan": 0}
    for comment in load(key).values():
        entry = dict(comment)
        entry["resolved"] = resolve(comment["anchor"], lines)
        counts[entry["status"]] += 1
        if entry["status"] == "open" and entry["resolved"]["confidence"] == "orphan":
            counts["orphan"] += 1
        if status == "all" or entry["status"] == status:
            comments.append(entry)
    comments.sort(key=sort_key)
    return {"path": "/" + key, "comments": comments, "counts": counts}


def scope_report(prefix, status="open"):
    """Per-document counts under a key prefix, without reading documents."""
    documents = []
    for key in list_keys(prefix):
        counts = {"open": 0, "resolved": 0}
        for comment in load(key).values():
            counts[comment["status"]] += 1
        if status == "all" or counts.get(status, 0):
            documents.append({"path": "/" + key, "open": counts["open"], "resolved": counts["resolved"]})
    return {"scope": "/" + prefix.strip("/"), "documents": documents}
