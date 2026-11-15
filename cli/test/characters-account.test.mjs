// minimoji characters save | list | revisions | pull | restore | archive | delete | grant | grants | revoke,
// against an in-memory service built from the backend's own library logic
// (convex/lib/customCharacters.ts) with two signed-in accounts and real packs.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { fixtureServer, makeCtx, run, signIn } from "./helpers.mjs";
const require_ = (file) => readFileSync(file, "utf8");

const AUTHORING = fileURLToPath(new URL("../../authoring", import.meta.url));
const SNAGTOOTH = join(AUTHORING, "fixtures", "characters", "snagtooth");
const LIB = fileURLToPath(new URL("../../../convex/lib/customCharacters.ts", import.meta.url));
const skip = !existsSync(LIB) && "needs the Minimoji backend beside this package";
const quiet = () => { const warn = console.warn; console.warn = () => {}; return () => { console.warn = warn; }; };
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** the routes of convex/http.ts over the real lib, an in-memory db and storage */
async function service() {
  const L = await import(LIB);
  // the backend's own head-file contract, from the Minimoji checkout this test needs anyway
  const { inspectBakedHeadGLB } = await import(pathToFileURL(join(AUTHORING, "..", "engine", "src", "bake", "contract.js")).href);
  const INDEXES = { by_owner_and_characterId: ["owner", "characterId"], by_character_and_number: ["character", "number"], by_character_and_digest: ["character", "digest"],
    by_owner: ["owner"], by_owner_and_createdAt: ["owner", "createdAt"], by_createdAt: ["createdAt"], by_tokenHash: ["tokenHash"], by_character: ["character"] };
  const tables = { customCharacters: [], characterRevisions: [], characterUploads: [], characterGrants: [] }, storage = new Map();
  let next = 0;
  const db = {
    query: (t) => ({ withIndex: (i, range) => { const c = []; const qq = { eq: (f, v) => { c.push([f, v]); return qq; }, lt: () => qq, gt: () => qq }; range(qq);
      const rows = tables[t].filter((r) => c.every(([f, v]) => r[f] === v)); return { take: async (n) => rows.slice(0, n), unique: async () => rows[0] ?? null }; } }),
    get: async (id) => tables[String(id).split(":")[0]]?.find((r) => r._id === id) ?? null,
    insert: async (t, row) => { const _id = `${t}:${next++}`; tables[t].push({ ...row, _id }); return _id; },
    patch: async (id, f) => Object.assign(tables[id.split(":")[0]].find((r) => r._id === id), f),
    delete: async (id) => { const t = id.split(":")[0]; tables[t] = tables[t].filter((r) => r._id !== id); },
  };
  const owners = { ["Bearer mk_cli_" + "c".repeat(40)]: "alice", ["Bearer mk_cli_" + "d".repeat(40)]: "bob" };
  const who = (call) => owners[call.auth];
  const answer = (r, ok = 200) => (r && r.ok === false ? { status: r.status, json: { error: r.why } } : { status: ok, json: r });
  const stream = (f) => (f.ok === false ? answer(f) : { status: 200, headers: { "Content-Type": f.type, "X-Minimoji-Sha256": f.sha256, "X-Minimoji-Revision": String(f.revision), "Cache-Control": "private, no-store" }, body: storage.get(f.storageId) });
  const routes = {
    "GET /cli/whoami": (c) => ({ json: { owner: who(c), email: `${who(c)}@example.com` } }),
    "POST /cli/characters/upload": async (c) => {
      const kind = new URLSearchParams(c.search).get("kind"), bytes = c.bytes;
      if (sha(bytes) !== c.headers["x-minimoji-sha256"]) return { status: 400, json: { error: "sha" } };
      if (kind === "glb") inspectBakedHeadGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
      const storageId = `_storage:${next++}`; storage.set(storageId, bytes);
      const r = await L.stageUpload(db, who(c), { kind, storageId, sha256: sha(bytes), bytes: bytes.length }, Date.now());
      return answer(r.ok ? { upload: r.upload } : r);
    },
    "POST /cli/characters/save": async (c) => {
      const p = L.parseManifest(c.body.manifest); if (!p.ok) return answer(p);
      if (await L.manifestDigest(p.manifest.raw) !== p.manifest.digest) return { status: 400, json: { error: "digest" } };
      const src = await L.ownedUpload(db, who(c), c.body.uploads.source, "source", Date.now());
      if (!src) return { status: 400, json: { error: "no source" } };
      const checked = await L.checkSourceArchive(storage.get(src.storageId), p.manifest); if (!checked.ok) return answer(checked);
      const r = await L.commitSave(db, who(c), { manifest: p.manifest, variants: c.body.uploads.variants, source: c.body.uploads.source }, Date.now());
      return answer(r.ok ? { outcome: r.outcome, character: r.character, revision: r.revision } : r, r.outcome === "added" ? 201 : 200);
    },
    "GET /cli/characters": async (c) => ({ json: { characters: await L.listCharacters(db, who(c)) } }),
    "GET /cli/characters/revisions": async (c) => answer(await L.listRevisions(db, who(c), new URLSearchParams(c.search).get("character"))),
    "GET /cli/characters/file": async (c) => { const s = new URLSearchParams(c.search); const rev = s.get("revision"); return stream(await L.ownerFile(db, who(c), s.get("character"), rev ? Number(rev) : "current", s.get("part") === "source" ? { part: "source" } : { part: "variant", variant: s.get("variant") ?? undefined })); },
    "POST /cli/characters/restore": async (c) => answer(await L.restoreRevision(db, who(c), c.body.character, c.body.revision, Date.now())),
    "POST /cli/characters/archive": async (c) => answer(await L.setArchived(db, who(c), c.body.character, c.body.archived, Date.now())),
    "POST /cli/characters/delete": async (c) => answer(await L.deleteCharacter(db, who(c), c.body.character)),
    "POST /cli/characters/grants": async (c) => { const token = "mkg_" + "t".repeat(40); const r = await L.createGrant(db, who(c), c.body.character, { revision: c.body.revision, label: c.body.label, days: c.body.days, tokenHash: sha(token), prefix: "mkg_tttt…tttt" }, Date.now()); return answer(r.ok ? { token, grant: r.grant } : r, 201); },
    "GET /cli/characters/grants": async (c) => answer(await L.listGrants(db, who(c), new URLSearchParams(c.search).get("character"), Date.now())),
    "POST /cli/characters/grants/revoke": async (c) => answer(await L.revokeGrant(db, who(c), c.body.grant, Date.now())),
    "GET /characters/file": async (c) => stream(await L.grantFile(db, sha(c.auth.replace("Bearer ", "")), undefined, Date.now())),
  };
  const server = await fixtureServer(routes);
  return { ...server, tables, storage };
}

async function packed(ctx, name, template) {
  assert.equal((await run(ctx, ["characters", "create", name, "--template", template, "--json"])).code, 0);
  const dir = join(ctx.cwd, name);
  await mkdir(join(dir, "node_modules", "@minimoji"), { recursive: true });
  await symlink(AUTHORING, join(dir, "node_modules", "@minimoji", "authoring"), "dir");
  const p = await run(ctx, ["characters", "pack", "--project", name, "--out", `${name}/dist/character`, "--json"]);
  assert.equal(p.code, 0, p.stdout);
  return { dir, pack: `${name}/dist/character`, digest: p.json.digest };
}

test("save → list → pull into a clean folder → rebuild the same digest; a retried save is kept, not duplicated", { skip, timeout: 240000 }, async () => {
  const restore = quiet();
  const svc = await service();
  try {
    const ctx = await makeCtx({ env: { MINIMOJI_API: svc.url } });
    await signIn(ctx, svc.url);
    const { pack, digest } = await packed(ctx, "relay", "robot");
    const saved = await run(ctx, ["characters", "save", pack, "--json"]);
    assert.equal(saved.code, 0, saved.stdout + saved.stderr);
    assert.deepEqual([saved.json.outcome, saved.json.destination.visibility, saved.json.destination.account, saved.json.revision.number, saved.json.revision.digest], ["added", "private", "alice@example.com", 1, digest]);
    assert.ok(!saved.stdout.includes("mk_cli_") && !saved.stdout.includes("_storage"), "no credentials or storage ids in JSON");
    const again = await run(ctx, ["characters", "save", pack, "--json"]);
    assert.equal(again.json.outcome, "kept");
    assert.equal(svc.tables.characterRevisions.length, 1, "no duplicate revision");
    const listed = await run(ctx, ["characters", "list", "--json"]);
    assert.deepEqual(listed.json.characters.map((c) => [c.id, c.visibility, c.current.number]), [["local/relay", "private", 1]]);

    const pulled = await run(ctx, ["characters", "pull", "local/relay", "--out", "restored", "--json"]);
    assert.equal(pulled.code, 0, pulled.stdout + pulled.stderr);
    assert.deepEqual([pulled.json.installed, pulled.json.ran, pulled.json.files], [false, false, 5]);
    const original = await readFile(join(ctx.cwd, "relay", "character.config.js"));
    assert.ok(original.equals(await readFile(join(ctx.cwd, "restored", "character.config.js"))), "byte-identical source");
    await mkdir(join(ctx.cwd, "restored", "node_modules", "@minimoji"), { recursive: true });
    await symlink(AUTHORING, join(ctx.cwd, "restored", "node_modules", "@minimoji", "authoring"), "dir");
    const rebuilt = await run(ctx, ["characters", "pack", "--project", "restored", "--out", "restored/dist/character", "--json"]);
    assert.equal(rebuilt.json.digest, digest, "the restored source rebuilds the same runtime digest");
    assert.equal((await run(ctx, ["characters", "pull", "local/relay", "--out", "restored", "--json"])).code, 1, "never pulls over files");
  } finally { restore(); await svc.close(); }
});

test("revisions, restore, grant (token only in a 600 file), revoke, archive, delete; another account sees nothing", { skip, timeout: 240000 }, async () => {
  const restore = quiet();
  const svc = await service();
  try {
    const ctx = await makeCtx({ env: { MINIMOJI_API: svc.url } });
    await signIn(ctx, svc.url);
    const { dir, pack } = await packed(ctx, "relay", "robot");
    await run(ctx, ["characters", "save", pack, "--json"]);
    const antenna = join(dir, "parts", "antenna.js");
    await writeFile(antenna, (await readFile(antenna, "utf8")).replace("height = 1", "height = 1.5"));
    assert.equal((await run(ctx, ["characters", "pack", "--project", "relay", "--out", pack, "--json"])).code, 0);
    const second = await run(ctx, ["characters", "save", pack, "--json"]);
    assert.deepEqual([second.json.outcome, second.json.revision.number], ["revised", 2]);
    const revs = await run(ctx, ["characters", "revisions", "local/relay", "--json"]);
    assert.deepEqual([revs.json.current, revs.json.revisions.map((r) => r.number)], [2, [1, 2]]);
    assert.equal((await run(ctx, ["characters", "restore", "local/relay", "--revision", "1", "--json"])).json.current, 1);

    const g = await run(ctx, ["characters", "grant", "local/relay", "--label", "my deck", "--revision", "1", "--token-out", "deck.token", "--json"]);
    assert.equal(g.code, 0, g.stdout + g.stderr);
    assert.equal(((await stat(join(ctx.cwd, "deck.token"))).mode & 0o777).toString(8), "600");
    const token = (await readFile(join(ctx.cwd, "deck.token"), "utf8")).trim();
    assert.ok(!g.stdout.includes(token) && !g.stderr.includes(token), "the token is never printed");
    const viaGrant = await fetch(`${svc.url}/characters/file`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(viaGrant.status, 200);
    assert.equal(viaGrant.headers.get("cache-control"), "private, no-store");

    // the other account: nothing to list, nothing to read, restore, share, archive or delete
    const bob = await makeCtx({ env: { MINIMOJI_API: svc.url } });
    await signIn(bob, svc.url, { token: "mk_cli_" + "d".repeat(40) });
    assert.deepEqual((await run(bob, ["characters", "list", "--json"])).json.characters, []);
    for (const argv of [["revisions", "local/relay"], ["pull", "local/relay", "--out", "x"], ["restore", "local/relay", "--revision", "2"], ["archive", "local/relay"],
      ["grant", "local/relay", "--label", "steal", "--token-out", "steal.token"], ["delete", "local/relay", "--confirm", "local/relay"], ["revoke", g.json.grant.id]]) {
      const r = await run(bob, ["characters", ...argv, "--json"]);
      assert.equal(r.code, 1, argv.join(" "));
      assert.match(r.json.error, /\(404\)/, `${argv[0]}: refused as not found`);
    }
    assert.equal(existsSync(join(bob.cwd, "x")), false); assert.equal(existsSync(join(bob.cwd, "steal.token")), false);

    assert.equal((await run(ctx, ["characters", "revoke", g.json.grant.id, "--json"])).code, 0);
    assert.equal((await fetch(`${svc.url}/characters/file`, { headers: { Authorization: `Bearer ${token}` } })).status, 404, "revoked");
    assert.equal((await run(ctx, ["characters", "archive", "local/relay", "--json"])).json.character.status, "archived");
    assert.equal((await run(ctx, ["characters", "delete", "local/relay", "--json"])).code, 2, "delete needs --confirm");
    assert.equal((await run(ctx, ["characters", "delete", "local/relay", "--confirm", "local/relay", "--json"])).json.deleted, "local/relay");
    assert.deepEqual((await run(ctx, ["characters", "list", "--json"])).json.characters, []);
  } finally { restore(); await svc.close(); }
});

test("save refuses a pack that is not valid and uploads nothing; --visibility other than private is refused", { skip, timeout: 240000 }, async () => {
  const restore = quiet();
  const svc = await service();
  try {
    const ctx = await makeCtx({ env: { MINIMOJI_API: svc.url } });
    await signIn(ctx, svc.url);
    const { pack } = await packed(ctx, "relay", "robot");
    assert.equal((await run(ctx, ["characters", "save", pack, "--visibility", "public", "--json"])).code, 2);
    const glb = join(ctx.cwd, pack, "runtime", "mast.glb"), bytes = await readFile(glb); bytes[bytes.length - 2] ^= 1; await writeFile(glb, bytes);
    const r = await run(ctx, ["characters", "save", pack, "--json"]);
    assert.equal(r.code, 1);
    assert.equal(r.json.diagnostics[0].code, "digest-mismatch");
    assert.equal(svc.storage.size, 0, "nothing uploaded");
  } finally { restore(); await svc.close(); }
});

test("export runs Hyperdecks' own CLI with an argv array, always env + account + pack, and verifies what it stored", { skip, timeout: 240000 }, async () => {
  const restore = quiet();
  const svc = await service();
  try {
    const calls = [];
    let reply = null;
    const execFile = (bin, args, opts, cb) => {
      if (args[0] === "--version") return setImmediate(() => cb(null, `${globalThis.__hdVersion ?? "0.9.18"}\n`, ""));
      const metadata = JSON.parse(require_(args[args.indexOf("--metadata") + 1]));
      calls.push({ bin, args, metadata, shell: opts.shell, glbExists: existsSync(args[2]) });
      const answer = reply(metadata);
      setImmediate(() => cb(answer.ok === false ? Object.assign(new Error("x"), { code: globalThis.__hdExit ?? 1 }) : null, JSON.stringify(answer), ""));
    };
    const ctx = { ...(await makeCtx({ env: { MINIMOJI_API: svc.url, HYPERDECKS_BIN: "/opt/hd/bin/hyperdecks" } })), execFile };
    await signIn(ctx, svc.url);
    // a head with a mouth (CLI 0.9.18 is enough); masked heads and bake 19 need 0.9.19, see below
    const { pack } = await packed(ctx, "relay", "human");
    const saved = await run(ctx, ["characters", "save", pack, "--json"]);
    const sha256 = saved.json.revision.variants[0].sha256;
    const ok = (m) => ({ ok: true, owner: { id: "hd_owner_1", email: "me@example.com" }, avatarId: "av_123", packId: "pkmine0123456789ab", sha256: m.sha256, bakeVersion: 18, stockVoice: "stock:warm-guide", created: true, reused: false, visibility: "private", defaultChanged: false, requirePrivate: true });
    reply = ok;
    const args = ["characters", "export", "local/relay", "--to", "hyperdecks", "--expect-account", "hd_owner_1", "--pack", "pkmine0123456789ab", "--stock-voice", "stock:warm-guide", "--json"];
    const r = await run(ctx, args);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const call = calls.at(-1);
    assert.equal(call.bin, "/opt/hd/bin/hyperdecks");
    assert.equal(call.shell, undefined, "no shell");
    assert.deepEqual(call.args.filter((a) => !a.includes("minimoji-export-")), ["avatar", "import", "--metadata", "--pack", "pkmine0123456789ab", "--expect-account", "hd_owner_1", "--json", "--prod"]);
    assert.ok(call.glbExists);
    assert.deepEqual([call.metadata.sha256, call.metadata.packId, call.metadata.stockVoice], [sha256, "pkmine0123456789ab", "stock:warm-guide"]);
    assert.match(call.metadata.provenance, /^Minimoji character local\/relay revision 1/);
    assert.deepEqual([r.json.receipt.avatarId, r.json.receipt.revision, r.json.receipt.sha256, r.json.receipt.visibility], ["av_123", 1, sha256, "private"]);
    assert.equal(r.json.receipt.speaker, '[speaker: #guest voice=stock:warm-guide avatar=av_123 name="Juniper"]', 'the human starter is named Juniper');
    assert.ok(!r.stdout.includes("token") && !r.stdout.includes("http"), "no tokens or URLs in the receipt");
    assert.ok(!existsSync(call.args[2]), "the temporary export files are gone");

    for (const [wrong, why] of [[{ owner: { id: "someone_else" } }, /account someone_else/], [{ packId: "pkpublic0123456789" }, /pack pkpublic0123456789/], [{ visibility: "public" }, /not private/], [{ sha256: "0".repeat(64) }, /sha256/], [{ defaultChanged: true }, /default avatar/]]) {
      reply = (m) => ({ ...ok(m), ...wrong });
      const bad = await run(ctx, args);
      assert.equal(bad.code, 1);
      assert.equal(bad.json.code, "export-mismatch");
      assert.match(bad.json.problems.join(" "), why);
    }
    globalThis.__hdExit = 2;
    reply = () => ({ ok: false, error: "avatars are not enabled for this account", code: "avatars-disabled" });
    const refused = await run(ctx, args);
    assert.deepEqual([refused.code, refused.json.code, refused.json.uploaded], [1, "avatars-disabled", false], "exit 2: refused before any upload");
    globalThis.__hdExit = 1;
    reply = () => ({ ok: false, error: "the upload timed out", code: "upload_uncertain", avatarId: "av_maybe" });
    const unsure = await run(ctx, args);
    assert.deepEqual([unsure.code, unsure.json.ok, unsure.json.uploaded, unsure.json.avatarId], [1, false, "maybe", "av_maybe"], "never claimed as exported");
    assert.match(unsure.json.next, /same export again/);
    assert.equal(unsure.json.receipt, undefined);
    reply = () => ({ ok: false, error: "stored but not verified", code: "stored_unverified", avatarId: "av_maybe" });
    assert.equal((await run(ctx, args)).json.uploaded, "maybe");
    // an older Hyperdecks server refusing requirePrivate: private_not_enforced, exit 1 — conservatively "maybe"
    globalThis.__hdExit = 1;
    reply = () => ({ ok: false, error: "the server does not support requirePrivate", code: "private_not_enforced" });
    const old = await run(ctx, args);
    assert.deepEqual([old.code, old.json.ok, old.json.uploaded, old.json.receipt], [1, false, "maybe", undefined]);
    // a server that stored it but did not confirm enforcing privacy: possibly uploaded, never a private export
    globalThis.__hdExit = 1;
    reply = () => ({ ok: false, error: "the server did not acknowledge requirePrivate", code: "private_not_enforced", avatarId: "av_unsure" });
    const unack = await run(ctx, args);
    assert.deepEqual([unack.code, unack.json.ok, unack.json.uploaded, unack.json.avatarId, unack.json.receipt], [1, false, "maybe", "av_unsure", undefined]);
    // the RELEASED 0.9.18 CLI fails closed itself (private_not_enforced unless the server confirms), and its
    // success answer does not repeat the flag: accepted, with the CLI version on the receipt
    globalThis.__hdExit = 0;
    reply = (m) => ({ ...ok(m), requirePrivate: undefined });
    const released = await run(ctx, args);
    assert.equal(released.code, 0, released.stdout);
    assert.equal(released.json.receipt.hyperdecksCli, "0.9.18");
    // anything else is refused BEFORE import runs (a pack shared between the CLI's check and the upload would
    // otherwise go through): an older CLI, a prerelease, extra text, no answer; exit 2, nothing uploaded
    for (const v of ["0.9.17", "decks 0.9.17", "0.9.18-rc.1", "0.9.18+build.1", "v0.9.18", "0.9.18 (beta)", "1.2", "not a version", ""]) {
      globalThis.__hdVersion = v;
      const before = calls.length;
      const no = await run(ctx, args);
      assert.deepEqual([no.code, no.json.code, no.json.uploaded, no.json.receipt], [2, "hyperdecks-unsupported", false, undefined], `CLI "${v}" is refused`);
      assert.equal(calls.length, before, `import never ran for CLI "${v}"`);
    }
    globalThis.__hdVersion = "0.10.0";
    assert.equal((await run(ctx, args)).code, 0, "a later stable release is accepted");
    delete globalThis.__hdVersion;
    for (const drop of ["--expect-account", "--pack", "--to"]) {
      const i = args.indexOf(drop);
      assert.equal((await run(ctx, [...args.slice(0, i), ...args.slice(i + 2)])).code, 2, `${drop} is required`);
    }
    // a masked head (indicator speech): Hyperdecks shows it from CLI 0.9.19 (profile v4). Judged from the DOWNLOADED
    // file's own bindings: an older CLI is refused before any import, a current one exports it
    const masked = await packed(ctx, "beacon", "robot");
    assert.equal((await run(ctx, ["characters", "save", masked.pack, "--json"])).code, 0);
    let versionAsked = 0;
    const counting = { ...ctx, execFile: (bin, a, o, cb) => { if (a[0] === "--version") versionAsked++; return execFile(bin, a, o, cb); } };
    const before = calls.length;
    const held = await run(counting, ["characters", "export", "local/beacon", ...args.slice(3)]);
    assert.deepEqual([held.code, held.json.ok, held.json.code, held.json.needs, held.json.uploaded, held.json.receipt], [2, false, "hyperdecks-unsupported", "0.9.19", false, undefined], held.stdout);
    assert.match(held.json.error, /0\.9\.18 cannot show this head: masked-face speech \(indicator\) need 0\.9\.19/);
    assert.equal(calls.length, before, "import never ran for a masked head on 0.9.18");
    assert.equal(versionAsked, 1, "the CLI was asked its version, once");
    globalThis.__hdVersion = "0.9.19";
    const shown = await run(ctx, ["characters", "export", "local/beacon", ...args.slice(3)]);
    assert.deepEqual([shown.code, shown.json.ok, !!shown.json.receipt], [0, true, true], shown.stdout);
    assert.equal(calls.length, before + 1, "0.9.19: the masked head is imported");
    // attached mouth pieces (bake 19), on the toolkit's original fixture: 0.9.18 refused, 0.9.19 exported
    const snag = join(ctx.cwd, "snag");
    await cp(SNAGTOOTH, snag, { recursive: true });
    await mkdir(join(snag, "node_modules", "@minimoji"), { recursive: true });
    await symlink(AUTHORING, join(snag, "node_modules", "@minimoji", "authoring"), "dir");
    assert.equal((await run(ctx, ["characters", "pack", "--project", "snag", "--out", "snag/dist/character", "--json"])).code, 0);
    assert.equal((await run(ctx, ["characters", "save", "snag/dist/character", "--json"])).code, 0);
    globalThis.__hdVersion = "0.9.18";
    const oldCli = await run(ctx, ["characters", "export", "fixture/snagtooth", ...args.slice(3)]);
    assert.deepEqual([oldCli.code, oldCli.json.code, oldCli.json.needs, oldCli.json.uploaded], [2, "hyperdecks-unsupported", "0.9.19", false], oldCli.stdout);
    assert.match(oldCli.json.error, /attached mouth pieces \(bake 19\)/);
    globalThis.__hdVersion = "0.9.19";
    reply = (m) => ({ ...ok(m), bakeVersion: 19 });
    const anchored = await run(ctx, ["characters", "export", "fixture/snagtooth", ...args.slice(3)]);
    assert.deepEqual([anchored.code, anchored.json.ok], [0, true], anchored.stdout);
    reply = ok;
    delete globalThis.__hdVersion;
    const missing = { ...ctx, execFile: (bin, a, o, cb) => setImmediate(() => cb(Object.assign(new Error("nope"), { code: "ENOENT" }), "", "")) };
    const none = await run(missing, args);
    assert.deepEqual([none.code, none.json.code], [2, "hyperdecks-missing"]);
  } finally { restore(); await svc.close(); }
});
