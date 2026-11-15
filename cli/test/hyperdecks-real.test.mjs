// Acceptance against Hyperdecks' REAL import command (not a fixture): set HYPERDECKS_REPO to a
// Hyperdecks checkout. Offline: no sign-in, no account, no upload. It checks that every starter's
// packed head passes Hyperdecks' own local validator (checkBake), and that `minimoji characters
// export`'s argv runs through the real CLI to a JSON refusal with exit 2 (nothing uploaded).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importArgs, runHyperdecks } from "../src/hyperdecks.js";

const HD = process.env.HYPERDECKS_REPO;
const skip = (!HD || !existsSync(join(HD, "packages/decks-cli/src/avatar-import.mjs"))) && "set HYPERDECKS_REPO to a Hyperdecks checkout";
const AUTHORING = fileURLToPath(new URL("../../authoring", import.meta.url));
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("every starter variant (human, creature, masked robot) packs for hyperdecks (profile v4) and passes its own head check, and the real CLI refuses offline with exit 2", { skip, timeout: 600000 }, async () => {
  const { checkBake } = await import(pathToFileURL(join(HD, "packages/decks-cli/src/avatar-import.mjs")).href);
  const ws = mkdtempSync(join(tmpdir(), "minimoji-hd-"));
  mkdirSync(join(ws, "node_modules", "@minimoji"), { recursive: true });
  symlinkSync(AUTHORING, join(ws, "node_modules", "@minimoji", "authoring"), "dir");
  const env = { PATH: process.env.PATH, HOME: ws, MINIMOJI_CONFIG_DIR: join(ws, ".cfg") };
  let glb;
  for (const t of ["human", "creature", "robot"]) {
    assert.equal(spawnSync(process.execPath, [CLI, "characters", "create", t, "--template", t], { cwd: ws, env }).status, 0);
    const p = spawnSync(process.execPath, [CLI, "characters", "pack", "--project", t, "--out", `${t}/dist`, "--target", "hyperdecks", "--json"], { cwd: ws, env, encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    for (const f of readdirSync(join(ws, t, "dist", "runtime")).filter((n) => n.endsWith(".glb"))) {
      glb = join(ws, t, "dist", "runtime", f);
      assert.doesNotThrow(() => checkBake(readFileSync(glb)), `${t}/${f} passes Hyperdecks checkBake`);
    }
  }
  const wrapper = join(ws, "hyperdecks");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${join(HD, "packages/decks-cli/bin/decks.mjs")}" "$@"\n`, { mode: 0o755 });
  const metadata = join(ws, "meta.json");
  writeFileSync(metadata, JSON.stringify({ name: "Relay", sha256: "0".repeat(64), provenance: "acceptance", limitations: [], packId: "pktest0123456789ab" }));
  const r = await runHyperdecks(importArgs({ glb, metadata, pack: "pktest0123456789ab", expectAccount: "user_test", env: "dev" }), { bin: wrapper, env: { PATH: process.env.PATH, HOME: ws } });
  assert.deepEqual([r.ok, r.code, r.exit, r.uploaded], [false, "sha256_mismatch", 2, false]);
  writeFileSync(metadata, JSON.stringify({ name: "Relay", sha256: createHash("sha256").update(readFileSync(glb)).digest("hex"), provenance: "acceptance", limitations: [], packId: "pktest0123456789ab" }));
  const offline = await runHyperdecks(importArgs({ glb, metadata, pack: "pktest0123456789ab", expectAccount: "user_test", env: "dev" }), { bin: wrapper, env: { PATH: process.env.PATH, HOME: ws } });
  assert.deepEqual([offline.ok, offline.exit, offline.uploaded], [false, 2, false], `stops before any upload (${offline.code})`);
});
