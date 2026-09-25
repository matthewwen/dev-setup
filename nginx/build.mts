#!/usr/bin/env node
// Build driver for the nginx viewers app.
//
//   node build.mts              release build: dist/app (minified, with a map)
//   node build.mts --dev        no minify
//   node build.mts --watch      rebuild on save
//   node build.mts --out <dir>  write dist/app into <dir> instead (dev loop against a throwaway nginx)
//
// dist/app is the only output: one shell (index.html), one ES module
// (app.js), one sheet (app.css), the tab icon (favicon.svg), and chunks/,
// the modules that app.js imports on demand (Mermaid). Every viewer conf
// rewrites to /__app/index.html; the app picks the viewer from
// location.pathname and the query string.
import { build, context } from "esbuild";
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const watch = args.includes("--watch");
const outIdx = args.indexOf("--out");
const appOut = outIdx !== -1 ? args[outIdx + 1] : join(BASE_DIR, "dist", "app");

function copyShell() {
  // Chunk names carry a content hash, so clear the old ones out.
  rmSync(join(appOut, "chunks"), { recursive: true, force: true });
  mkdirSync(appOut, { recursive: true });
  copyFileSync(join(BASE_DIR, "src", "index.html"), join(appOut, "index.html"));
  copyFileSync(join(BASE_DIR, "src", "favicon.svg"), join(appOut, "favicon.svg"));
}

const esbuildOptions = {
  entryPoints: [join(BASE_DIR, "src", "main.tsx")],
  bundle: true,
  outdir: appOut,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  format: "esm" as const,
  splitting: true,
  minify: !dev,
  sourcemap: true,
  jsx: "automatic" as const,
  target: "es2020",
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
  loader: { ".css": "css" as const },
};

async function run() {
  copyShell();

  if (watch) {
    const ctx = await context(esbuildOptions);
    await ctx.watch();
    console.log(`Watching. Writing to ${appOut}`);
    // Keep the process alive; esbuild's watcher runs in the background.
    await new Promise(() => {});
  } else {
    await build(esbuildOptions);
    console.log(`Built ${appOut}`);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
