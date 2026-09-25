"""Tests for review_store.py, mdreview.py, and the /api/review endpoints.

Run with `npm run test:py` or `python3 -m unittest scripts/test_review_store.py`.
Stdlib only. Every test gets a fresh store and a fresh webroot whose top-level
entry `proj` is a symlink, the way an installed webroot is laid out.
"""

import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import mdreview  # noqa: E402
import review_store as store  # noqa: E402

DOC = """# Title

First paragraph
second line.

- item one
- item two

Measured on a 105.8 MiB log.
"""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def load_server():
    spec = importlib.util.spec_from_file_location("explorer_server", os.path.join(HERE, "explorer-server.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mdreview-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        os.environ["MD_REVIEW_DIR"] = os.path.join(self.tmp, "store")
        self.addCleanup(os.environ.pop, "MD_REVIEW_DIR", None)

        self.root = os.path.join(self.tmp, "www")
        os.mkdir(self.root)
        self.project = os.path.join(self.tmp, "elsewhere", "project")
        os.makedirs(os.path.join(self.project, "docs"))
        os.symlink(self.project, os.path.join(self.root, "proj"))
        self.doc = os.path.join(self.project, "docs", "notes.md")
        write(self.doc, DOC)
        write(os.path.join(self.root, "local", "a.md"), DOC)
        self.key = "proj/docs/notes.md"
        self.lines = store.split_lines(DOC)

    def rewrite(self, text):
        write(self.doc, text)
        self.lines = store.split_lines(text)

    def add(self, line, end_line=None, body="note", **extra):
        payload = dict({"author": "matt", "body": body, "anchor": {"line": line, "endLine": end_line or line}}, **extra)
        return store.apply(self.key, "comment", payload, self.lines)


class KeyForTest(StoreCase):
    def test_filesystem_path_behind_a_symlink_maps_to_the_webroot_name(self):
        self.assertEqual(store.key_for(self.doc, self.root), "proj/docs/notes.md")

    def test_webroot_path_and_filesystem_path_agree(self):
        via_root = os.path.join(self.root, "proj", "docs", "notes.md")
        self.assertEqual(store.key_for(via_root, self.root), store.key_for(self.doc, self.root))

    def test_real_directory_inside_the_webroot(self):
        self.assertEqual(store.key_for(os.path.join(self.root, "local", "a.md"), self.root), "local/a.md")

    def test_outside_every_root_raises(self):
        with self.assertRaises(ValueError):
            store.key_for(os.path.join(self.tmp, "stray.md"), self.root)

    def test_the_webroot_itself_raises(self):
        with self.assertRaises(ValueError):
            store.key_for(self.root, self.root)

    def test_store_path_rejects_escapes(self):
        with self.assertRaises(ValueError):
            store.store_path("../x")
        with self.assertRaises(ValueError):
            store.store_path("")


class ReplayTest(unittest.TestCase):
    def test_last_status_wins_and_delete_hides(self):
        events = [
            {"ev": "comment", "id": "aaaaaa", "author": "m", "ts": "1", "body": "one", "anchor": {"line": 3}},
            {"ev": "comment", "id": "bbbbbb", "author": "m", "ts": "2", "body": "two", "anchor": {"line": None}},
            {"ev": "reply", "id": "aaaaaa", "author": "agent", "ts": "3", "body": "done"},
            {"ev": "status", "id": "aaaaaa", "author": "agent", "ts": "4", "status": "resolved", "action": "fixed"},
            {"ev": "status", "id": "aaaaaa", "author": "m", "ts": "5", "status": "open"},
            {"ev": "delete", "id": "bbbbbb", "author": "m", "ts": "6"},
            {"ev": "reply", "id": "zzzzzz", "author": "m", "ts": "7", "body": "ignored"},
        ]
        comments = store.replay(events)
        self.assertEqual(sorted(comments), ["aaaaaa"])
        self.assertEqual(comments["aaaaaa"]["status"], "open")
        self.assertIsNone(comments["aaaaaa"]["action"])
        self.assertEqual([r["body"] for r in comments["aaaaaa"]["replies"]], ["done"])


class ResolveTest(StoreCase):
    def test_exact(self):
        anchor = store.make_anchor(self.lines, 3, 4)
        self.assertEqual(store.resolve(anchor, self.lines)["confidence"], "exact")

    def test_moved_after_an_insertion_above(self):
        anchor = store.make_anchor(self.lines, 9, 9)
        self.rewrite("# Title\n\nNew intro.\n\n" + DOC.split("\n", 2)[2])
        found = store.resolve(anchor, self.lines)
        self.assertEqual((found["confidence"], found["line"]), ("moved", 11))
        self.assertEqual(found["text"], "Measured on a 105.8 MiB log.")

    def test_reflowed_paragraph_resolves_by_quote(self):
        anchor = store.make_anchor(self.lines, 3, 4)
        self.rewrite(DOC.replace("First paragraph\nsecond line.", "First paragraph second line."))
        found = store.resolve(anchor, self.lines)
        self.assertEqual((found["confidence"], found["line"], found["endLine"]), ("quote", 3, 3))

    def test_tabs_and_trailing_spaces_still_match_exactly(self):
        anchor = store.make_anchor(self.lines, 6, 7)
        self.rewrite(DOC.replace("- item one\n- item two", "-\titem one   \n- item two"))
        self.assertEqual(store.resolve(anchor, self.lines)["confidence"], "exact")

    def test_deleted_block_is_an_orphan(self):
        anchor = store.make_anchor(self.lines, 9, 9)
        self.rewrite(DOC.replace("Measured on a 105.8 MiB log.\n", ""))
        self.assertEqual(store.resolve(anchor, self.lines), {"confidence": "orphan"})

    def test_duplicated_block_is_ambiguous(self):
        anchor = store.make_anchor(self.lines, 9, 9)
        self.rewrite(DOC.replace("# Title\n", "# Title\n\nMeasured on a 105.8 MiB log.\n"))
        self.assertEqual(store.resolve(anchor, self.lines)["confidence"], "orphan")

    def test_document_level_note(self):
        self.assertEqual(store.resolve({"line": None}, self.lines), {"confidence": "document"})
        self.assertEqual(store.resolve(None, self.lines), {"confidence": "document"})

    def test_missing_document_orphans_anchors(self):
        anchor = store.make_anchor(self.lines, 1, 1)
        self.assertEqual(store.resolve(anchor, None), {"confidence": "orphan"})

    def test_make_anchor_rejects_bad_ranges(self):
        with self.assertRaises(ValueError):
            store.make_anchor(self.lines, 0, 1)
        with self.assertRaises(ValueError):
            store.make_anchor(self.lines, 2, 2)
        with self.assertRaises(ValueError):
            store.make_anchor(self.lines, 5, 3)


class ApplyTest(StoreCase):
    def test_comment_reply_resolve_delete(self):
        cid = self.add(9, body="This number is stale.", anchor={"line": 9, "endLine": 9, "selection": "105.8 MiB"})
        self.assertRegex(cid, r"^[a-z2-7]{6}$")
        store.apply(self.key, "reply", {"id": cid, "author": "agent", "body": "Re-measured."}, None)
        store.apply(self.key, "status", {"id": cid, "author": "agent", "status": "resolved", "action": "fixed"}, None)
        comment = store.load(self.key)[cid]
        self.assertEqual((comment["status"], comment["action"]), ("resolved", "fixed"))
        self.assertEqual(comment["anchor"]["selection"], "105.8 MiB")
        self.assertEqual(comment["anchor"]["quote"], "Measured on a 105.8 MiB log.")
        self.assertEqual(len(comment["replies"]), 1)
        store.apply(self.key, "delete", {"id": cid, "author": "matt"}, None)
        self.assertEqual(store.load(self.key), {})
        self.assertEqual(len(store.read_events(self.key)), 4, "events stay on disk")

    def test_stale_page_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            self.add(9, anchor={"line": 9, "endLine": 9, "text": "Measured on a 99 MiB log."})
        self.assertIn("document changed", str(caught.exception))
        self.add(9, anchor={"line": 9, "endLine": 9, "text": "  Measured   on a 105.8 MiB log.  "})

    def test_document_level_comment(self):
        cid = store.apply(self.key, "comment", {"author": "matt", "body": "Overall: good."}, None)
        self.assertEqual(store.load(self.key)[cid]["anchor"], {"line": None})

    def test_invalid_input(self):
        with self.assertRaises(ValueError):
            store.apply(self.key, "comment", {"body": "   "}, self.lines)
        with self.assertRaises(ValueError):
            store.apply(self.key, "reply", {"id": "nosuch", "body": "x"}, None)
        with self.assertRaises(ValueError):
            store.apply(self.key, "bogus", {"id": "aaaaaa"}, None)
        cid = self.add(1)
        with self.assertRaises(ValueError):
            store.apply(self.key, "status", {"id": cid, "status": "resolved", "action": "later"}, None)
        with self.assertRaises(ValueError):
            store.apply(self.key, "comment", {"body": "x" * (store.MAX_BODY_CHARS + 1)}, None)

    def test_event_cap(self):
        original = store.MAX_EVENTS
        store.MAX_EVENTS = 2
        self.addCleanup(setattr, store, "MAX_EVENTS", original)
        self.add(1)
        self.add(3)
        with self.assertRaises(ValueError):
            self.add(9)

    def test_reports(self):
        first = self.add(1, body="heading")
        self.add(9, body="number")
        self.add(3, body="para")
        store.apply(self.key, "status", {"id": first, "status": "resolved", "action": "answered"}, None)
        self.rewrite(DOC.replace("Measured on a 105.8 MiB log.\n", ""))
        report = store.document_report(self.key, self.lines)
        self.assertEqual(report["path"], "/proj/docs/notes.md")
        self.assertEqual(report["counts"], {"open": 2, "resolved": 1, "orphan": 1})
        self.assertEqual([c["body"] for c in report["comments"]], ["heading", "para", "number"])
        self.assertEqual([c["resolved"]["confidence"] for c in report["comments"]], ["exact", "exact", "orphan"])
        scope = store.scope_report("proj")
        self.assertEqual(scope["documents"], [{"path": "/proj/docs/notes.md", "open": 2, "resolved": 1}])
        self.assertEqual(store.scope_report("local")["documents"], [])
        self.assertEqual(store.scope_report("pro")["documents"], [], "a prefix matches whole path segments only")

    def test_move(self):
        self.add(1)
        store.move(self.key, "proj/docs/renamed.md")
        self.assertEqual(store.list_keys(), ["proj/docs/renamed.md"])
        with self.assertRaises(FileNotFoundError):
            store.move(self.key, "proj/docs/other.md")


class CliTest(StoreCase):
    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mdreview.main(["--root", self.root] + list(args))
        return out.getvalue()

    def test_round_trip(self):
        cid = self.run_cli("add", "--path", self.doc, "--line", "9", "--body", "Stale number.", "--author", "matt").strip()
        listing = json.loads(self.run_cli("list", "--path", "/proj/docs/notes.md", "--json"))
        self.assertTrue(listing["ok"])
        self.assertEqual(listing["comments"][0]["id"], cid)
        self.assertEqual(listing["comments"][0]["resolved"]["confidence"], "exact")

        self.rewrite("# Title\n\nAdded above.\n\n" + DOC.split("\n", 2)[2])
        text = self.run_cli("list", "--path", self.doc)
        self.assertIn("L11", text)
        self.assertIn("moved", text)

        self.run_cli("reply", cid, "--body", "Re-measured at 118 MiB.", "--author", "agent")
        self.run_cli("resolve", cid, "--action", "fixed", "--author", "agent")
        self.assertIn("no open comments", self.run_cli("list"))
        resolved = json.loads(self.run_cli("list", "--status", "resolved", "--json"))
        comment = resolved["documents"][0]["comments"][0]
        self.assertEqual((comment["status"], comment["action"]), ("resolved", "fixed"))
        self.assertEqual(comment["replies"][0]["author"], "agent")

        self.run_cli("reopen", cid)
        self.assertIn(cid, self.run_cli("show", cid))
        self.run_cli("rm", cid)
        with self.assertRaises(SystemExit):
            self.run_cli("show", cid)

    def test_move_and_missing_document(self):
        self.run_cli("add", "--path", self.doc, "--body", "Document note.")
        renamed = os.path.join(self.project, "docs", "renamed.md")
        os.rename(self.doc, renamed)
        with self.assertRaises(SystemExit) as caught:
            self.run_cli("add", "--path", self.doc, "--body", "x")
        self.assertIn("no such document", str(caught.exception))
        self.run_cli("mv", "/proj/docs/notes.md", renamed)
        listing = json.loads(self.run_cli("list", "--path", renamed, "--json"))
        self.assertEqual(listing["comments"][0]["resolved"]["confidence"], "document")


class ApiTest(StoreCase):
    def setUp(self):
        super().setUp()
        self.server_module = load_server()
        self.server_module.ROOT = self.root
        self.server_module.Handler.log_message = lambda *args: None
        self.server = self.server_module.ThreadingHTTPServer(("127.0.0.1", 0), self.server_module.Handler)
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, body=None, headers=None):
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        request = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path), data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, dict(response.headers), json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), json.loads(err.read())

    JSON = {"Content-Type": "application/json"}

    def test_comment_round_trip_through_the_api(self):
        body = {"op": "comment", "path": "/proj/docs/notes.md", "author": "matt", "body": "Stale.",
                "anchor": {"line": 9, "endLine": 9, "text": "Measured on a 105.8 MiB log.", "selection": "105.8 MiB"}}
        code, headers, payload = self.request("POST", "/api/review", body, self.JSON)
        self.assertEqual((code, payload["ok"], payload["path"]), (201, True, "/proj/docs/notes.md"))
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        cid = payload["id"]

        code, _headers, payload = self.request("POST", "/api/review", {"op": "reply", "path": "/proj/docs/notes.md", "id": cid, "author": "agent", "body": "Fixed."}, self.JSON)
        self.assertEqual(code, 200)
        code, _headers, payload = self.request("GET", "/api/review?path=/proj/docs/notes.md")
        self.assertEqual(code, 200)
        self.assertEqual(payload["counts"], {"open": 1, "resolved": 0, "orphan": 0})
        self.assertEqual(payload["comments"][0]["resolved"]["confidence"], "exact")
        self.assertEqual(payload["comments"][0]["replies"][0]["body"], "Fixed.")

        code, _headers, payload = self.request("GET", "/api/review?scope=/proj")
        self.assertEqual(payload["documents"], [{"path": "/proj/docs/notes.md", "open": 1, "resolved": 0}])
        code, _headers, payload = self.request("GET", "/api/review")
        self.assertEqual(len(payload["documents"]), 1)

        listing = json.loads(self.run_cli("list", "--path", self.doc, "--json"))
        self.assertEqual(listing["comments"][0]["id"], cid, "the CLI reads what the browser wrote")

    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mdreview.main(["--root", self.root] + list(args))
        return out.getvalue()

    def test_wrong_content_type_is_415(self):
        code, _headers, payload = self.request("POST", "/api/review", {"op": "comment", "path": "/proj/docs/notes.md", "body": "x"}, {"Content-Type": "text/plain"})
        self.assertEqual((code, payload["ok"]), (415, False))
        code, _headers, _payload = self.request("POST", "/api/review", {"op": "comment", "path": "/proj/docs/notes.md", "body": "x"})
        self.assertEqual(code, 415, "urllib's default form content type is refused")

    def test_any_origin_is_accepted(self):
        body = {"op": "comment", "path": "/proj/docs/notes.md", "body": "x"}
        for origin in ("http://evil.example", "null", "http://dev-dsk.example:8080"):
            code, _headers, _payload = self.request("POST", "/api/review", body, dict(self.JSON, Origin=origin))
            self.assertEqual(code, 201, origin)

    def test_a_missing_author_becomes_the_login_name(self):
        for author in (None, "", "   "):
            body = {"op": "comment", "path": "/proj/docs/notes.md", "body": "x"}
            if author is not None:
                body["author"] = author
            self.request("POST", "/api/review", body, self.JSON)
        authors = {c["author"] for c in store.load(self.key).values()}
        self.assertEqual(authors, {self.server_module.REVIEW_AUTHOR})
        self.assertTrue(self.server_module.REVIEW_AUTHOR)

    def test_no_response_carries_a_cors_header(self):
        for method, path, body, headers in (
            ("GET", "/api/health", None, None),
            ("GET", "/api/review?path=/proj/docs/notes.md", None, None),
            ("POST", "/api/review", {"op": "bogus", "path": "/proj/docs/notes.md"}, self.JSON),
            ("POST", "/api/files", {"op": "write", "path": "/x", "content": ""}, self.JSON),
        ):
            _code, response_headers, _payload = self.request(method, path, body, headers)
            self.assertFalse(any(name.lower().startswith("access-control-") for name in response_headers), path)

    def test_bad_requests_are_400_and_files_still_needs_a_token(self):
        code, _headers, payload = self.request("POST", "/api/review", {"op": "comment", "path": "/../etc/passwd", "body": "x"}, self.JSON)
        self.assertEqual((code, payload["ok"]), (400, False))
        code, _headers, payload = self.request("POST", "/api/review", {"op": "comment", "path": "/proj/docs/nope.md", "body": "x"}, self.JSON)
        self.assertEqual(code, 400)
        code, _headers, payload = self.request("POST", "/api/review", {"op": "comment", "path": "/proj/docs/notes.md", "body": "x", "anchor": {"line": 99}}, self.JSON)
        self.assertEqual(code, 400)
        self.assertIn("outside the document", payload["error"])
        code, _headers, payload = self.request("POST", "/api/review", b"{not json", self.JSON)
        self.assertEqual(code, 400)
        code, _headers, payload = self.request("POST", "/api/review", {"op": "comment", "path": "/proj/docs/notes.md", "body": "x" * 70000}, self.JSON)
        self.assertEqual(code, 400)
        self.assertIn("KiB", payload["error"])
        code, _headers, payload = self.request("POST", "/api/files", {"op": "write", "path": "/proj/docs/notes.md", "content": "gone"}, self.JSON)
        self.assertEqual(code, 403)
        with open(self.doc, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), DOC)


if __name__ == "__main__":
    unittest.main()
