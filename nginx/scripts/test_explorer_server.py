"""Tests for the /api/search and /api/files endpoints of explorer-server.py.

Run with `npm run test:py` or `python3 -m unittest scripts/test_explorer_server.py`.
Stdlib only. Search runs ripgrep, so those tests skip when `rg` is not on PATH.
"""

import hashlib

import importlib.util
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def load_server():
    spec = importlib.util.spec_from_file_location("explorer_server", os.path.join(HERE, "explorer-server.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, text, mtime):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.utime(path, (mtime, mtime))


@unittest.skipUnless(shutil.which("rg"), "search needs ripgrep (rg) on PATH")
class SearchTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="explorer-test-")
        self.addCleanup(shutil.rmtree, self.root, True)
        # Name hits sort newest first, so fixed mtimes fix their order.
        write(os.path.join(self.root, "docs", "target-plan.md"), "the target is here\n", 3000)
        write(os.path.join(self.root, "target-empty.txt"), "nothing to see\n", 2000)
        write(os.path.join(self.root, "notes.md"), "one target\nanother target\n", 1000)
        write(os.path.join(self.root, "other.md"), "unrelated\n", 1000)

        server_module = load_server()
        server_module.ROOT = self.root
        server_module.Handler.log_message = lambda *args: None
        self.server = server_module.ThreadingHTTPServer(("127.0.0.1", 0), server_module.Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def search(self, **params):
        url = "http://127.0.0.1:%d/api/search?%s" % (self.port, urllib.parse.urlencode(params))
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def test_both_lists_name_hits_first_then_content_only_hits(self):
        _code, names = self.search(q="target", mode="names")
        _code, content = self.search(q="target", mode="content")
        code, both = self.search(q="target", mode="both")
        self.assertEqual(code, 200)

        name_paths = [r["path"] for r in names["results"]]
        self.assertEqual(name_paths, ["docs/target-plan.md", "target-empty.txt"])
        content_only = [r["path"] for r in content["results"] if r["path"] not in name_paths]
        self.assertEqual(content_only, ["notes.md"])
        self.assertEqual([r["path"] for r in both["results"]], name_paths + content_only)

    def test_a_file_that_matches_by_name_and_content_appears_once_with_its_lines(self):
        _code, both = self.search(q="target", mode="both")
        hits = [r for r in both["results"] if r["path"] == "docs/target-plan.md"]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["matches"], [{"line": 1, "text": "the target is here"}])
        name_only = next(r for r in both["results"] if r["path"] == "target-empty.txt")
        self.assertEqual(name_only["matches"], [])
        self.assertEqual(both["count"], 3)

    def test_a_bad_regex_in_both_mode_reports_the_python_error(self):
        code, payload = self.search(q="(", mode="both", regex="1")
        self.assertEqual(code, 400)
        self.assertFalse(payload["ok"])
        self.assertIn("missing )", payload["error"])


class FilesTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="explorer-test-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.doc = os.path.join(self.root, "plan.md")
        write(self.doc, "# Plan\n\nfirst\n", 1000)

        server_module = load_server()
        server_module.ROOT = self.root
        server_module.Handler.log_message = lambda *args: None
        self.server = server_module.ThreadingHTTPServer(("127.0.0.1", 0), server_module.Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, **params):
        url = "http://127.0.0.1:%d/api/files?%s" % (self.port, urllib.parse.urlencode(params))
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def post(self, payload):
        request = urllib.request.Request(
            "http://127.0.0.1:%d/api/files" % self.port,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def disk(self):
        with open(self.doc, encoding="utf-8") as handle:
            return handle.read()

    def test_write_with_a_stale_hash_is_a_conflict_that_names_the_current_hash(self):
        _code, before = self.get(path="plan.md")
        write(self.doc, "changed elsewhere\n", 2000)
        code, payload = self.post({"op": "write", "path": "plan.md", "content": "mine\n", "if_match": before["sha256"]})
        self.assertEqual(code, 409)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["sha256"], hashlib.sha256(b"changed elsewhere\n").hexdigest())
        self.assertEqual(self.disk(), "changed elsewhere\n")

        code, _payload = self.post({"op": "write", "path": "plan.md", "content": "mine\n", "if_match": payload["sha256"]})
        self.assertEqual(code, 200)
        self.assertEqual(self.disk(), "mine\n")

    def test_patch_on_changed_lines_is_a_conflict_with_the_current_text(self):
        write(self.doc, "one\ntwo\nthree\n", 1000)
        code, payload = self.post({"op": "patch", "path": "plan.md", "line": 2, "endLine": 2, "expect": "TWO", "text": "x"})
        self.assertEqual(code, 409)
        self.assertEqual(payload["current"], "two")
        self.assertEqual(payload["line"], 2)
        self.assertEqual(self.disk(), "one\ntwo\nthree\n")

    def test_patch_outside_the_file_is_a_400(self):
        code, _payload = self.post({"op": "patch", "path": "plan.md", "line": 3, "endLine": 9, "expect": "", "text": "x"})
        self.assertEqual(code, 400)
        code, _payload = self.post({"op": "patch", "path": "plan.md", "line": 0, "endLine": 1, "expect": "", "text": "x"})
        self.assertEqual(code, 400)

    def test_patch_keeps_the_last_line_without_a_newline(self):
        write(self.doc, "a\nb", 1000)
        code, payload = self.post({"op": "patch", "path": "plan.md", "line": 2, "endLine": 2, "expect": "b", "text": "B"})
        self.assertEqual(code, 200)
        self.assertEqual(payload["content"], "a\nB")


if __name__ == "__main__":
    unittest.main()
