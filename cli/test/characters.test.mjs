// minimoji characters: real temporary projects through the real compiler (@minimoji/authoring,
// which lives beside this package in the Minimoji repository; skipped where it is absent).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCtx, run, tempDir } from "./helpers.mjs";
import { loadAuthoring } from "../src/characters.js";

const AUTHORING = fileURLToPath(new URL("../../authoring", import.meta.url));
const HEADS = fileURLToPath(new URL("../../../sdk/packages/heads", import.meta.url));
const skip = !existsSync(join(AUTHORING, "src", "tooling.js")) && "needs packages/authoring from the Minimoji repository";
const quiet = () => { const warn = console.warn; console.warn = () => {}; return () => { console.warn = warn; }; };

async function linked(ctx, name, template) {
  const r = await run(ctx, ["characters", "create", name, "--template", template, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const dir = join(ctx.cwd, name);
  await mkdir(join(dir, "node_modules", "@minimoji"), { recursive: true });
  await symlink(AUTHORING, join(dir, "node_modules", "@minimoji", "authoring"), "dir");
  await symlink(HEADS, join(dir, "node_modules", "@minimoji", "heads"), "dir");
  return { dir, created: r.json };
}

test("characters create → validate → pack → validate the pack, with JSON and exit codes", { skip }, async () => {
  const restore = quiet();
  try {
    const ctx = await makeCtx();
    const { dir, created } = await linked(ctx, "relay", "robot");
    assert.deepEqual({ ok: created.ok, template: created.template, id: created.id, installed: created.installed }, { ok: true, template: "robot", id: "local/relay", installed: false });
    assert.deepEqual(created.next, ["cd relay", "npm install", "npx minimoji characters dev"]);

    const v = await run(ctx, ["characters", "validate", "--project", "relay", "--target", "web", "--json"]);
    assert.equal(v.code, 0, v.stdout);
    assert.equal(v.json.ok, true); assert.equal(v.json.kind, "project");
    assert.deepEqual(v.json.variants.map((x) => x.id), ["mast", "dish"]);
    // hyperdecks profile v4: its player shows a masked robot's speech (export then needs Hyperdecks CLI 0.9.19+)
    const hd = await run(ctx, ["characters", "validate", "--project", "relay", "--target", "hyperdecks", "--json"]);
    assert.equal(hd.code, 0, hd.stdout);
    assert.equal(hd.json.profile.version, 4); assert.equal(hd.json.profile.maxGlbBytes, 8 * 1024 * 1024); assert.equal(hd.json.profile.maxBakeVersion, 19);

    const p = await run(ctx, ["characters", "pack", "--project", "relay", "--out", "relay/dist/character", "--json"]);
    assert.equal(p.code, 0, p.stdout);
    assert.match(p.json.digest, /^[a-f0-9]{64}$/);
    assert.equal(p.json.capabilities.speech, "indicator");
    const again = await run(ctx, ["characters", "pack", "--project", "relay", "--out", "relay/dist/again", "--json"]);
    assert.equal(again.json.digest, p.json.digest, "deterministic");
    assert.ok(!p.stdout.includes("token") && !p.stdout.includes("mk_"), "no credentials in JSON");

    // a pack is data: a toolkit planted inside it is never loaded, even when validating from within it
    await mkdir(join(dir, "dist", "character", "node_modules", "@minimoji", "authoring", "src"), { recursive: true });
    await writeFile(join(dir, "dist", "character", "node_modules", "@minimoji", "authoring", "package.json"), JSON.stringify({ name: "@minimoji/authoring", type: "module", exports: { "./tooling": "./src/tooling.js" } }));
    await writeFile(join(dir, "dist", "character", "node_modules", "@minimoji", "authoring", "src", "tooling.js"), "globalThis.__planted = true; throw new Error('planted');");
    const inner = await run({ ...ctx, cwd: join(dir, "dist", "character") }, ["characters", "validate", ".", "--json"]);
    assert.equal(globalThis.__planted, undefined, "the planted toolkit never ran");
    assert.equal(inner.code, 0, "the pack still validates with the CLI's own toolkit");
    await (await import("node:fs/promises")).rm(join(dir, "dist", "character", "node_modules"), { recursive: true });
    const pv = await run(ctx, ["characters", "validate", "relay/dist/character", "--json"]);
    assert.equal(pv.code, 0); assert.equal(pv.json.kind, "pack");
    const swift = await run(ctx, ["characters", "validate", "relay/dist/character", "--target", "swift", "--json"]);
    assert.equal(swift.code, 0, "a masked face's indicator speech is supported natively (swift profile v2)");
    assert.ok(!swift.json.diagnostics.some((d) => d.code === "profile-speech"));

    // LOCAL RESTORE: unpack the pack's source into a new folder, rebuild it to the same digest
    const un = await run(ctx, ["characters", "unpack", "relay/dist/character", "relay-again", "--json"]);
    assert.equal(un.code, 0, un.out);
    assert.ok(existsSync(join(ctx.cwd, "relay-again", "character.config.js")));
    await mkdir(join(ctx.cwd, "relay-again", "node_modules", "@minimoji"), { recursive: true });
    await symlink(AUTHORING, join(ctx.cwd, "relay-again", "node_modules", "@minimoji", "authoring"), "dir");
    await symlink(HEADS, join(ctx.cwd, "relay-again", "node_modules", "@minimoji", "heads"), "dir");
    const repack = await run(ctx, ["characters", "pack", "--project", "relay-again", "--out", "relay-again/dist/character", "--json"]);
    assert.equal(repack.code, 0, repack.out);
    assert.equal(repack.json.sourceDigest, p.json.sourceDigest, "the unpacked source is the packed source");
    assert.equal(repack.json.variants.map((v) => v.sha256).join(), p.json.variants.map((v) => v.sha256).join(), "and rebuilds the same heads");
    assert.equal((await run(ctx, ["characters", "unpack", "relay/dist/character", "relay-again", "--json"])).code, 2, "never into a folder that is not empty (an invocation error, as for create)");
    const glb = join(dir, "dist", "character", "runtime", "mast.glb");
    const bytes = await readFile(glb); bytes[bytes.length - 3] ^= 0xff; await writeFile(glb, bytes);
    const tampered = await run(ctx, ["characters", "validate", "relay/dist/character", "--json"]);
    assert.equal(tampered.code, 1);
    assert.equal(tampered.json.diagnostics[0].code, "digest-mismatch");
    const human = await run(ctx, ["characters", "validate", "relay/dist/character"]);
    assert.match(human.stderr, /error digest-mismatch at variants\[0\]\.sha256/);
  } finally { restore(); }
});

test("characters: a broken project exits 1 with a located diagnostic; bad invocations exit 2", { skip }, async () => {
  const restore = quiet();
  try {
    const ctx = await makeCtx();
    const { dir } = await linked(ctx, "mossback", "creature");
    const config = join(dir, "character.config.js");
    await writeFile(config, (await readFile(config, "utf8")).replace("ctx.add(horns(", "ctx.add({ type: 'solid', id: 'mouthHorn' }); ctx.add(horns("));
    const broken = await run(ctx, ["characters", "validate", "--project", "mossback", "--json"]);
    assert.equal(broken.code, 1);
    assert.deepEqual([broken.json.ok, broken.json.diagnostics[0].code, broken.json.diagnostics[0].path], [false, "part-reserved-id", "mouthHorn"]);
    const failedPack = await run(ctx, ["characters", "pack", "--project", "mossback", "--out", "out", "--json"]);
    assert.equal(failedPack.code, 1);
    assert.equal(existsSync(join(ctx.cwd, "out")), false, "nothing written");
    // a bad face setting, a feature or a skull cage is the PROJECT's error (exit 1), like a bad part
    await writeFile(config, (await readFile(config, "utf8")).replace("ctx.add({ type: 'solid', id: 'mouthHorn' }); ", "").replace("  build(ctx) {", "  face: { eyes: { size: 99 } },\n  build(ctx) {"));
    const badFace = await run(ctx, ["characters", "validate", "--project", "mossback", "--json"]);
    assert.equal(badFace.code, 1, badFace.out);
    assert.equal(badFace.json.diagnostics[0].code, "face-setting");

    assert.equal((await run(ctx, ["characters", "pack", "--project", "mossback", "--json"])).code, 2, "missing --out");
    assert.equal((await run(ctx, ["characters", "validate", "--project", "mossback", "--target", "vr", "--json"])).code, 2);
    assert.equal((await run(ctx, ["characters", "explode", "--json"])).code, 2);
    assert.equal((await run(ctx, ["characters", "validate", "--nope"])).code, 2);
    assert.equal((await run(ctx, ["characters", "create", "--json"])).code, 2, "create needs a folder");
    const busy = await run(ctx, ["characters", "create", "mossback", "--template", "human", "--json"]);
    assert.equal(busy.code, 2); assert.equal(busy.json.diagnostics[0].code, "create-not-empty");
    assert.equal((await run(ctx, ["characters", "dev", "--project", "mossback", "--host", "0.0.0.0", "--json"])).code, 2, "loopback only unless asked");
    assert.equal((await run(ctx, ["characters", "dev", "--project", "mossback", "--host", "0.0.0.0", "--allow-remote", "--json"])).code, 2, "a wildcard can never pass the host check");
    const typo = await run({ ...ctx, env: { ...ctx.env, MINIMOJI_AUTHORING: "/nowhere/authoring" } }, ["characters", "validate", "--project", "mossback", "--json"]);
    assert.equal(typo.code, 2); assert.match(typo.json.error, /MINIMOJI_AUTHORING/);
    const good = await readFile(config, "utf8");
    await writeFile(config, good.replace("ctx.add({ type: 'solid', id: 'mouthHorn' }); ", "").replace("export default", "const = ;\nexport default"));
    const syntax = await run(ctx, ["characters", "validate", "--project", "mossback", "--json"]);
    assert.equal(syntax.code, 1, "a syntax error is the project's fault");
    assert.equal(syntax.json.diagnostics[0].code, "source-error");
    assert.match(syntax.json.diagnostics[0].path, /^character\.config\.js/);
    const missing = await run(ctx, ["characters", "validate", "--project", "nowhere", "--json"]);
    assert.equal(missing.code, 1); assert.equal(missing.json.diagnostics[0].code, "project-config-missing");
  } finally { restore(); }
});

test("characters mesh prepares a generated mesh as data; a mesh it cannot carry is a project error", { skip }, async () => {
  const restore = quiet();
  try {
    const ctx = await makeCtx();
    const horn = fileURLToPath(new URL("../../authoring/fixtures/meshes/curl-horn.obj", import.meta.url));
    const r = await run(ctx, ["characters", "mesh", horn, "--out", "horn.mesh.json", "--up", "z", "--json"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.json.verts, 112);
    const prepared = JSON.parse(await readFile(join(ctx.cwd, "horn.mesh.json"), "utf8"));
    assert.equal(prepared.format, "minimoji.mesh/1");
    assert.equal((await run(ctx, ["characters", "mesh", horn, "--out", "horn.mesh.json", "--json"])).code, 2, "never over an existing file without --force");
    await writeFile(join(ctx.cwd, "skinned.glb"), "glTF but not really");
    const bad = await run(ctx, ["characters", "mesh", "skinned.glb", "--out", "x.mesh.json", "--json"]);
    assert.equal(bad.code, 1);
    assert.match(bad.json.diagnostics[0].code, /^mesh-/);
  } finally { restore(); }
});

test("characters contribute prepares a local review bundle and refuses what it cannot certify", { skip }, async () => {
  const restore = quiet();
  try {
    const ctx = await makeCtx();
    await linked(ctx, "relay", "robot");
    const noRights = await run(ctx, ["characters", "contribute", "--project", "relay", "--kind", "character", "--out", "bundle", "--json"]);
    assert.equal(noRights.code, 2, "a missing --author/--license is an invocation error");
    assert.equal(noRights.json.diagnostics[0].code, "contribute-rights");
    const noEvidence = await run(ctx, ["characters", "contribute", "--project", "relay", "--kind", "character", "--author", "A", "--license", "MIT", "--out", "bundle", "--json"]);
    assert.equal(noEvidence.code, 1);
    assert.equal(noEvidence.json.diagnostics[0].code, "contribute-evidence");
    assert.equal(existsSync(join(ctx.cwd, "bundle")), false, "nothing written");
    // a part with before/after evidence bound to this build
    const p = await run(ctx, ["characters", "pack", "--project", "relay", "--out", "relay/dist/character", "--json"]);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082", "hex");
    await mkdir(join(ctx.cwd, "ev"));
    const images = [];
    for (const v of p.json.variants) for (const when of ["before", "after"]) { const file = `${v.id}-${when}.png`; await writeFile(join(ctx.cwd, "ev", file), png); images.push({ file, variant: v.id, sha256: when === "before" ? "f".repeat(64) : v.sha256, view: "front", state: "neutral", when }); }
    await writeFile(join(ctx.cwd, "ev", "evidence.json"), JSON.stringify({ images }));
    const ok = await run(ctx, ["characters", "contribute", "--project", "relay", "--kind", "part", "--part", "grille", "--author", "A", "--license", "MIT", "--evidence", "ev", "--out", "bundle", "--json"]);
    assert.equal(ok.code, 0, ok.out);
    assert.equal(ok.json.uploaded, false);
    assert.ok(existsSync(join(ctx.cwd, "bundle", "CONTRIBUTION.json")));
  } finally { restore(); }
});

test("characters dev serves the workbench until stopped", { skip, timeout: 120000 }, async () => {
  const ctx = await makeCtx();
  await linked(ctx, "juniper", "human");
  const controller = new AbortController();
  let stdout = "";
  const { main } = await import("../src/main.js");
  const done = main(["characters", "dev", "--project", "juniper", "--no-browser", "--json"], { ...ctx, signal: controller.signal, stdout: (s) => { stdout += s; }, stderr: () => {} });
  const start = Date.now();
  while (!/"event": ?"built"/.test(stdout) && Date.now() - start < 90000) await new Promise((r) => setTimeout(r, 100));
  const url = JSON.parse(stdout.split("\n").find((l) => l.includes('"listening"'))).url;
  const state = await (await fetch(url + "api/state")).json();
  assert.deepEqual(state.lastGood.variants.map((v) => v.id), ["bob", "topKnot"]);
  controller.abort();
  assert.equal(await done, 0);
  assert.deepEqual(ctx.opened, [], "--no-browser opens nothing");
});

test("characters stays out of --help until the authoring package is released", async () => {
  const ctx = await makeCtx();
  const help = await run(ctx, ["--help"]);
  assert.doesNotMatch(help.stdout, /^\s+characters\s/m);
  const usage = await run(ctx, ["characters", "--help"]);
  assert.match(usage.stdout, /minimoji characters create <dir> --template human\|creature\|robot/);
});

test("a pack is never a source of code: symlinked folders and links back into it are refused", { skip }, async () => {
  const root = await tempDir("minimoji-pack-trust-");
  const pack = join(root, "pack"), plant = join(pack, "node_modules", "@minimoji", "authoring");
  await mkdir(join(plant, "src"), { recursive: true });
  await writeFile(join(plant, "package.json"), JSON.stringify({ name: "@minimoji/authoring", type: "module", exports: { "./tooling": "./src/tooling.js" } }));
  await writeFile(join(plant, "src", "tooling.js"), "export const planted = true;");
  await symlink(pack, join(root, "alias"), "dir");                       // cwd reached through a symlink
  const viaAlias = await loadAuthoring({ cwd: join(root, "alias"), env: {} }, null, { avoid: pack });
  assert.equal(viaAlias.planted, undefined, "the alias of the pack is still the pack");
  // a node_modules in an outside folder that links back into the pack
  const outside = join(root, "outside");
  await mkdir(join(outside, "node_modules", "@minimoji"), { recursive: true });
  await symlink(plant, join(outside, "node_modules", "@minimoji", "authoring"), "dir");
  const viaLink = await loadAuthoring({ cwd: outside, env: {} }, null, { avoid: pack });
  assert.equal(viaLink.planted, undefined, "a link resolving into the pack is skipped");
  await assert.rejects(loadAuthoring({ cwd: root, env: { MINIMOJI_AUTHORING: plant } }, null, { avoid: pack }), /inside the pack/);
});

test("validate <dir> is artifact-only: a folder without a manifest never runs its config or tooling", { skip }, async () => {
  const ctx = await makeCtx();
  const dir = join(ctx.cwd, "download");
  const plant = join(dir, "node_modules", "@minimoji", "authoring");
  await mkdir(join(plant, "src"), { recursive: true });
  await writeFile(join(plant, "package.json"), JSON.stringify({ name: "@minimoji/authoring", type: "module", exports: { "./tooling": "./src/tooling.js" } }));
  await writeFile(join(plant, "src", "tooling.js"), "globalThis.__plantedTooling = true;");
  await writeFile(join(dir, "character.config.js"), "globalThis.__plantedConfig = true; export default {};");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "download", type: "module" }));
  const r = await run(ctx, ["characters", "validate", "download", "--json"]);
  assert.equal(r.code, 1);
  assert.equal(r.json.diagnostics[0].code, "manifest-missing");
  assert.equal(globalThis.__plantedConfig, undefined, "the config never ran");
  assert.equal(globalThis.__plantedTooling, undefined, "the planted tooling never ran");
});
