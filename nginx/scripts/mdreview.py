#!/usr/bin/env python3
"""Read and answer review comments left on rendered Markdown.

The browser writes comments through POST /__api/review. This command reads
the same store, so an agent can list the open comments with their current
source excerpt, edit the document, reply, and resolve. `list --json` is the
contract; the store layout stays an implementation detail.

Usage:
  mdreview list    [--path P | --scope DIR] [--status open|resolved|all] [--json]
  mdreview show    <id> [--path P] [--json]
  mdreview add     --path P [--line N] [--end-line M] --body TEXT
  mdreview reply   <id> --body TEXT [--author agent] [--path P]
  mdreview resolve <id> --action fixed|answered|wontfix [--body TEXT] [--path P]
  mdreview reopen  <id> [--path P]
  mdreview rm      <id> [--path P]
  mdreview mv      <old> <new>

--path accepts a filesystem path or a webroot-relative path. The webroot comes
from --root, then $NGINX_ROOT, then ~/html, then /usr/share/nginx/html.
"""

import argparse
import getpass
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import review_store as store  # noqa: E402


def default_root():
    env = os.environ.get("NGINX_ROOT")
    if env:
        return env
    home_link = os.path.join(os.path.expanduser("~"), "html")
    if os.path.isdir(home_link):
        return home_link
    return "/usr/share/nginx/html"


def default_author():
    return os.environ.get("MD_REVIEW_AUTHOR") or getpass.getuser()


def locate(arg, root, must_exist=True):
    """(store key, real path) for a filesystem path or a webroot-relative one."""
    for candidate in (arg, os.path.join(root, arg.lstrip("/"))):
        if os.path.exists(candidate):
            return store.key_for(candidate, root), os.path.realpath(candidate)
    if must_exist:
        raise SystemExit("no such document: %s (webroot %s)" % (arg, root))
    return store.key_for(os.path.join(root, arg.lstrip("/")), root), None


def document_lines(real_path):
    if real_path and os.path.isfile(real_path):
        return store.read_document(real_path)
    return None


def find_comment(cid, root, path=None):
    """(key, comment) for an id, searching every document unless --path is set."""
    keys = [locate(path, root)[0]] if path else store.list_keys()
    hits = [(key, comments[cid]) for key in keys for comments in [store.load(key)] if cid in comments]
    if not hits:
        raise SystemExit("no comment %s" % cid)
    if len(hits) > 1:
        raise SystemExit("comment %s exists in %d documents; pass --path" % (cid, len(hits)))
    return hits[0]


# ============================================================================
# Output
# ============================================================================

def first_line(text, width=100):
    line = (text or "").strip().split("\n")[0]
    return line if len(line) <= width else line[: width - 1] + "…"


def print_comment(comment, indent="  "):
    resolved = comment.get("resolved") or {}
    confidence = resolved.get("confidence", "unknown")
    if resolved.get("line"):
        where = "L%d" % resolved["line"]
        if resolved.get("endLine", resolved["line"]) != resolved["line"]:
            where += "-%d" % resolved["endLine"]
    else:
        where = "L-"
    status = comment["status"] + ("/" + comment["action"] if comment.get("action") else "")
    print("%s%s  %-16s %-8s %-8s %s  %s" % (indent, comment["id"], status, where, confidence, comment["author"], comment["ts"]))
    for line in comment["body"].strip().split("\n"):
        print("%s    %s" % (indent, line))
    selection = (comment.get("anchor") or {}).get("selection")
    if selection:
        print("%s    selected: %s" % (indent, first_line(selection)))
    if confidence == "orphan":
        print("%s    quote:    %s" % (indent, first_line((comment.get("anchor") or {}).get("quote", ""))))
    elif resolved.get("text") is not None:
        print("%s    source:   %s" % (indent, first_line(resolved["text"])))
    for reply in comment.get("replies", []):
        print("%s    reply %s %s: %s" % (indent, reply["author"], reply["ts"], first_line(reply["body"])))


def print_report(report):
    counts = report["counts"]
    print("%s  (%d open, %d resolved, %d orphan)" % (report["path"], counts["open"], counts["resolved"], counts["orphan"]))
    for comment in report["comments"]:
        print_comment(comment)


def emit_json(payload):
    json.dump(payload, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


# ============================================================================
# Commands
# ============================================================================

def cmd_list(opts):
    if opts.path:
        key, real = locate(opts.path, opts.root)
        keys = [key]
        reals = {key: real}
    else:
        prefix = ""
        if opts.scope:
            prefix = locate(opts.scope, opts.root)[0]
        keys = store.list_keys(prefix)
        reals = {key: os.path.join(opts.root, key) for key in keys}
    reports = []
    for key in keys:
        report = store.document_report(key, document_lines(reals[key]), opts.status)
        if opts.path or report["comments"]:
            reports.append(report)
    if opts.json:
        if opts.path:
            emit_json(dict(reports[0], ok=True))
        else:
            emit_json({"ok": True, "documents": reports})
        return
    if not reports:
        print("no %s comments" % ("" if opts.status == "all" else opts.status))
        return
    for report in reports:
        print_report(report)


def cmd_show(opts):
    key, comment = find_comment(opts.id, opts.root, opts.path)
    comment = dict(comment)
    comment["resolved"] = store.resolve(comment["anchor"], document_lines(os.path.join(opts.root, key)))
    if opts.json:
        emit_json(dict(comment, ok=True, path="/" + key))
        return
    print("/" + key)
    print_comment(comment)


def cmd_add(opts):
    key, real = locate(opts.path, opts.root)
    lines = document_lines(real)
    anchor = None
    if opts.line is not None:
        anchor = {"line": opts.line, "endLine": opts.end_line or opts.line}
    payload = {"author": opts.author, "body": opts.body, "anchor": anchor}
    cid = store.apply(key, "comment", payload, lines)
    print(cid)


def mutate(opts, op, extra):
    key, _comment = find_comment(opts.id, opts.root, opts.path)
    payload = dict(extra, id=opts.id, author=opts.author)
    store.apply(key, op, payload, None)


def cmd_reply(opts):
    mutate(opts, "reply", {"body": opts.body})
    print(opts.id)


def cmd_resolve(opts):
    if opts.body:
        mutate(opts, "reply", {"body": opts.body})
    mutate(opts, "status", {"status": "resolved", "action": opts.action})
    print(opts.id)


def cmd_reopen(opts):
    mutate(opts, "status", {"status": "open"})
    print(opts.id)


def cmd_rm(opts):
    mutate(opts, "delete", {})
    print(opts.id)


def cmd_mv(opts):
    old_key, _old = locate(opts.old, opts.root, must_exist=False)
    new_key, _new = locate(opts.new, opts.root)
    store.move(old_key, new_key)
    print("%s -> %s" % (old_key, new_key))


# ============================================================================
# Argument parsing
# ============================================================================

def build_parser():
    parser = argparse.ArgumentParser(prog="mdreview", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=default_root(), help="webroot (default: $NGINX_ROOT, ~/html, or /usr/share/nginx/html)")
    sub = parser.add_subparsers(dest="command", required=True)

    def with_target(p, path_help="document, as a filesystem or webroot-relative path"):
        p.add_argument("--path", help=path_help)

    def with_author(p):
        p.add_argument("--author", default=default_author(), help="author name (default: $MD_REVIEW_AUTHOR or the login name)")

    p = sub.add_parser("list", help="list comments")
    with_target(p)
    p.add_argument("--scope", help="directory; list every document under it")
    p.add_argument("--status", choices=("open", "resolved", "all"), default="open")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("show", help="show one comment")
    p.add_argument("id")
    with_target(p)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("add", help="add a comment")
    with_target(p)
    p.add_argument("--line", type=int, help="first line of the anchored block; omit for a document-level note")
    p.add_argument("--end-line", type=int, help="last line of the anchored block (default: --line)")
    p.add_argument("--body", required=True)
    with_author(p)
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("reply", help="reply to a comment")
    p.add_argument("id")
    p.add_argument("--body", required=True)
    with_author(p)
    with_target(p, "document, only needed when the id exists in several documents")
    p.set_defaults(func=cmd_reply)

    p = sub.add_parser("resolve", help="resolve a comment")
    p.add_argument("id")
    p.add_argument("--action", choices=store.ACTIONS, required=True)
    p.add_argument("--body", help="reply to record before resolving")
    with_author(p)
    with_target(p, "document, only needed when the id exists in several documents")
    p.set_defaults(func=cmd_resolve)

    p = sub.add_parser("reopen", help="reopen a resolved comment")
    p.add_argument("id")
    with_author(p)
    with_target(p, "document, only needed when the id exists in several documents")
    p.set_defaults(func=cmd_reopen)

    p = sub.add_parser("rm", help="delete a comment")
    p.add_argument("id")
    with_author(p)
    with_target(p, "document, only needed when the id exists in several documents")
    p.set_defaults(func=cmd_rm)

    p = sub.add_parser("mv", help="move stored comments after a document moved")
    p.add_argument("old")
    p.add_argument("new")
    p.set_defaults(func=cmd_mv)
    return parser


def main(argv=None):
    opts = build_parser().parse_args(argv)
    if getattr(opts, "path", None) is None and opts.command == "add":
        raise SystemExit("add needs --path")
    try:
        opts.func(opts)
    except (ValueError, FileNotFoundError) as err:
        raise SystemExit("mdreview: %s" % err)


if __name__ == "__main__":
    main()
