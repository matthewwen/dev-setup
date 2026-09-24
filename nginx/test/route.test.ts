import { test } from "node:test";
import assert from "node:assert/strict";
import { pickViewer } from "../src/app/route.ts";

test("a trailing slash is the explorer", () => {
  assert.equal(pickViewer("/notes/", ""), "explorer");
  assert.equal(pickViewer("/", ""), "explorer");
});

test("every mapped extension picks its viewer", () => {
  const cases: Record<string, string> = {
    "/a.md": "md",
    "/a.markdown": "md",
    "/a.mdx": "md",
    "/a.json": "json",
    "/a.jsonl": "json",
    "/a.ndjson": "json",
    "/a.ipynb": "ipynb",
    "/a.log": "text",
    "/a.txt": "text",
    "/a.out": "text",
    "/a.err": "text",
    "/a.go": "text",
    "/a.py": "text",
    "/a.ts": "text",
    "/a.yaml": "text",
    "/a.tsv": "text",
    "/a.csv": "text",
    "/a.eval": "eval",
  };
  for (const [path, expected] of Object.entries(cases)) {
    assert.equal(pickViewer(path, ""), expected, path);
  }
});

test("extension matching is case-insensitive", () => {
  assert.equal(pickViewer("/README.MD", ""), "md");
});

test("?view=text overrides the extension", () => {
  assert.equal(pickViewer("/a.json", "?view=text"), "text");
  assert.equal(pickViewer("/a.md", "?view=text"), "text");
});

test("a dot in a directory name does not count as an extension", () => {
  assert.equal(pickViewer("/v1.2/README", ""), "explorer");
});

test("an unrecognized extension falls back to the explorer", () => {
  assert.equal(pickViewer("/a.png", ""), "explorer");
});
