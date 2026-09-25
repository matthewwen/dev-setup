"""Tests for the /api/search endpoint of explorer-server.py.

Run with `npm run test:py` or `python3 -m unittest scripts/test_explorer_server.py`.
Stdlib only. Search runs ripgrep, so the tests skip when `rg` is not on PATH.
"""

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


if __name__ == "__main__":
    unittest.main()
