import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_DIR = join(import.meta.dirname, "..");
const outDir = mkdtempSync(join(tmpdir(), "nginx-viewers-build-"));

test.after(() => rmSync(outDir, { recursive: true, force: true }));

test("the build writes index.html, app.js, app.css, and favicon.svg", () => {
  execFileSync("node", ["build.mts", "--out", outDir], { cwd: BASE_DIR, stdio: "inherit" });
  const html = readFileSync(join(outDir, "index.html"), "utf8");
  const js = readFileSync(join(outDir, "app.js"), "utf8");
  const chunks = readdirSync(join(outDir, "chunks")).filter(f => f.endsWith(".js"));
  assert.ok(chunks.length > 0, "the build wrote no chunks for Mermaid");
  readFileSync(join(outDir, "app.css"), "utf8");
  readFileSync(join(outDir, "favicon.svg"), "utf8");

  // The shell references only its own assets, never a CDN.
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith("data:")) {
      continue;
    }
    assert.match(url, /^\/__app\//, `index.html references ${url}, not /__app/`);
  }

  // No known CDN host, and no dynamic import of a remote URL - the app ships
  // React and Mermaid in dist/app so the site works on a disconnected host.
  const cdnHosts = ["unpkg.com", "jsdelivr.net", "cdnjs.cloudflare.com", "googleapis.com", "esm.sh"];
  const scripts = [["app.js", js], ...chunks.map(f => [f, readFileSync(join(outDir, "chunks", f), "utf8")])];
  for (const [name, code] of scripts) {
    for (const host of cdnHosts) {
      assert.ok(!code.includes(host), `${name} references CDN host ${host}`);
    }
    assert.ok(!/\bimport\(\s*["'`]https?:/.test(code), `${name} dynamically imports a remote URL`);
  }
});
