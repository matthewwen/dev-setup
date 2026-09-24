import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_DIR = join(import.meta.dirname, "..");
const outDir = mkdtempSync(join(tmpdir(), "nginx-viewers-build-"));

test.after(() => rmSync(outDir, { recursive: true, force: true }));

test("the build writes index.html, app.js, and app.css", () => {
  execFileSync("node", ["build.mts", "--out", outDir], { cwd: BASE_DIR, stdio: "inherit" });
  const html = readFileSync(join(outDir, "index.html"), "utf8");
  const js = readFileSync(join(outDir, "app.js"), "utf8");
  readFileSync(join(outDir, "app.css"), "utf8");

  // The shell references only its own assets, never a CDN.
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith("data:")) {
      continue;
    }
    assert.match(url, /^\/__app\//, `index.html references ${url}, not /__app/`);
  }

  // No known CDN host, and no dynamic import of a remote URL - the app ships
  // React inside app.js so the site works on a disconnected host.
  const cdnHosts = ["unpkg.com", "jsdelivr.net", "cdnjs.cloudflare.com", "googleapis.com", "esm.sh"];
  for (const host of cdnHosts) {
    assert.ok(!js.includes(host), `app.js references CDN host ${host}`);
  }
  assert.ok(!/\bimport\(\s*["'`]https?:/.test(js), "app.js dynamically imports a remote URL");
});
