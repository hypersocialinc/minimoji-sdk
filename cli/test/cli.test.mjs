import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeCtx, run } from "./helpers.mjs";

const COMMANDS = ["login", "logout", "whoami", "keys", "init", "skills", "generate", "species", "render", "preview"];
const pkgDir = fileURLToPath(new URL("..", import.meta.url));

test("every command has --help and takes --json", async () => {
  const ctx = await makeCtx();
  const top = await run(ctx, ["--help"]);
  for (const name of COMMANDS) {
    assert.match(top.stdout, new RegExp(`^  ${name}\\s`, "m"));
    const r = await run(ctx, [name, "--help", "--json"]);
    assert.equal(r.code, 0);
    assert.match(r.json.usage, new RegExp(`^minimoji ${name}`));
    assert.match((await run(ctx, [name, "--help"])).stdout, new RegExp(`^minimoji ${name}`));
  }
});

test("errors are one line on stderr, a non-zero exit, and {error} with --json", async () => {
  const ctx = await makeCtx();
  for (const argv of [["frobnicate"], ["keys", "--bogus"], ["whoami", "--base", "ftp://x"], ["render"], ["preview", "missing.json"]]) {
    const r = await run(ctx, [...argv, "--json"]);
    assert.equal(r.code, 1, argv.join(" "));
    assert.equal(r.stderr.split("\n").filter(Boolean).length, 1, r.stderr);
    assert.match(r.stderr, /^minimoji: /);
    assert.equal(typeof r.json.error, "string");
  }
});

test("--base takes prod, dev or an origin; MINIMOJI_API is the default", async () => {
  const { resolveBase, BASES } = await import("../src/service.js");
  assert.equal(resolveBase({}, {}), BASES.prod);
  assert.equal(resolveBase({ base: "dev" }, {}), BASES.dev);
  assert.equal(resolveBase({}, { MINIMOJI_API: "https://x.convex.site/" }), "https://x.convex.site");
  assert.throws(() => resolveBase({ base: "https://x.convex.site/path" }, {}));
  assert.throws(() => resolveBase({ base: "http://x.convex.site" }, {}), /https/, "a token never crosses plain http");
  assert.equal(resolveBase({ base: "http://127.0.0.1:3210" }, {}), "http://127.0.0.1:3210");
});

test("the package is publishable on its own: a bin, no workspace references, and npm pack holds src, README and package.json only", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.bin.minimoji, "src/cli.js");
  assert.equal(pkg.private, undefined);
  assert.doesNotMatch(JSON.stringify(pkg), /workspace:/);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], "no runtime dependencies");
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  const files = packed.files.map((f) => f.path).sort();
  for (const f of files) assert.match(f, /^(src\/[\w-]+\.js|README\.md|LICENSE|package\.json)$/, f);
  assert.ok(files.includes("src/cli.js") && files.includes("README.md"));
  assert.ok(readFileSync(new URL("../src/cli.js", import.meta.url), "utf8").startsWith("#!/usr/bin/env node\n"));
});
