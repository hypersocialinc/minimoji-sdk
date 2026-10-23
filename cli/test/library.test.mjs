import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closeNames, resolveTarget, slugify } from "../src/library.js";
import { fixtureServer, makeCtx, prefixOf, run, sec, signIn } from "./helpers.mjs";

const DOC = { v: 2, seed: 7, hair: { style: "curly", color: "ginger" } };
const MINE = "a".repeat(64);
const THEIRS = "b".repeat(56) + "12345678";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** a service with a working library: the entries live in `svc.library`, by name */
async function service(extra = {}) {
  const library = new Map();
  const saved = new Set([MINE, THEIRS]);
  const find = (b) => [...library.values()].find((e) => (b.name != null ? e.name === b.name : e.avatarKey === b.avatarKey));
  const free = (name, suffix, self) => {
    for (let n = 1; ; n++) {
      const c = n === 1 ? name : `${name}-${n}`;
      const holder = library.get(c);
      if (!holder || holder === self) return c;
      if (!suffix) return null;
    }
  };
  const svc = await fixtureServer({
    "POST /cli/keys": () => ({ json: { key: sec(), prefix: prefixOf(sec()), kind: "secret" } }),
    "POST /avatars/generate": () => ({ json: { doc: DOC, notes: null, usage: {} } }),
    "POST /avatars": () => ({ json: { avatarKey: MINE, json: `${svc.url}/avatars/${MINE}.json`, glb: `${svc.url}/avatars/${MINE}.glb`, png: `${svc.url}/avatars/${MINE}.png` } }),
    "GET /avatars/*": (c) => {
      const key = c.path.slice("/avatars/".length, -".json".length);
      if (c.path.endsWith(".json") && saved.has(key)) return { json: DOC };
      if (c.path.endsWith(".png")) return { body: PNG, headers: { "Content-Type": "image/png" } };
      return { status: 404, json: { error: `no avatar with key ${key}` } };
    },
    "GET /cli/avatars": () => ({ json: { avatars: [...library.values()].sort((a, b) => a.name.localeCompare(b.name)) } }),
    "POST /cli/avatars": ({ body }) => {
      if (body.name != null && !NAME.test(body.name)) return { status: 400, json: { error: "name: not a name" } };
      if (!saved.has(body.avatarKey)) return { status: 404, json: { error: "no avatar with that key" } };
      const existing = find({ avatarKey: body.avatarKey });
      if (existing && (body.name == null || body.name === existing.name)) return { json: { avatar: existing, outcome: "kept" } };
      const name = free(body.name ?? body.defaultName ?? "avatar", body.suffix || body.name == null, existing);
      if (!name) return { status: 409, json: { error: `you already have an avatar named ${body.name}` } };
      if (existing) library.delete(existing.name);
      const entry = { ...(existing ?? { avatarKey: body.avatarKey, kind: "person", createdAt: Date.UTC(2026, 9, 23) }), name, updatedAt: 2 };
      library.set(name, entry);
      return { json: { avatar: entry, outcome: existing ? "renamed" : "added" } };
    },
    "POST /cli/avatars/rename": ({ body }) => {
      const entry = find(body);
      if (!entry) return { status: 404, json: { error: "not in your library" } };
      const from = entry.name;
      library.delete(from);
      entry.name = body.to;
      library.set(body.to, entry);
      return { json: { avatar: entry, from } };
    },
    "POST /cli/avatars/remove": ({ body }) => {
      const entry = find(body);
      if (!entry) return { status: 404, json: { error: "not in your library" } };
      library.delete(entry.name);
      return { json: { removed: entry } };
    },
    ...extra,
  });
  svc.library = library;
  return svc;
}

async function signedIn(svc) {
  const ctx = await makeCtx();
  await signIn(ctx, svc.url);
  return ctx;
}

test("generate --name kai keeps it in the library, and minimoji avatars lists it", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    let r = await run(ctx, ["generate", "red curls", "--name", "kai", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.avatars[0].name, "kai");
    assert.deepEqual(svc.calls.find((c) => c.path === "/cli/avatars").body, { avatarKey: MINE, name: "kai", suffix: true });
    r = await run(ctx, ["avatars", "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^NAME\s+KEY\s+KIND\s+SAVED\nkai\s+aaaaaaaaaaaa\s+person\s+2026-10-23\n$/);
    r = await run(ctx, ["avatars", "list", "--base", svc.url, "--json"]);
    assert.deepEqual(r.json, { avatars: [{ name: "kai", avatarKey: MINE, kind: "person", createdAt: Date.UTC(2026, 9, 23), updatedAt: 2 }] });
  } finally { await svc.close(); }
});

test("avatars save keeps someone else's avatar, and saving it again is a no-op", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    let r = await run(ctx, ["avatars", "save", THEIRS, "--name", "pal", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.outcome, "added");
    r = await run(ctx, ["avatars", "save", THEIRS, "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /pal is already in your library/);
    assert.deepEqual([...svc.library.keys()], ["pal"]);
    r = await run(ctx, ["avatars", "save", "f".repeat(64), "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no avatar with that key/);
  } finally { await svc.close(); }
});

test("get, preview and render take a name, a full key or a unique prefix", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    await run(ctx, ["avatars", "save", MINE, "--name", "kai", "--base", svc.url]);
    let r = await run(ctx, ["avatars", "get", "kai", "--out", "kai.json", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.avatarKey, MINE);
    assert.deepEqual(JSON.parse(await readFile(join(ctx.cwd, "kai.json"), "utf8")), DOC);
    r = await run(ctx, ["avatars", "get", THEIRS, "--base", svc.url, "--json"]);
    assert.equal(r.json.name, null, "a full key not in the library still gets");
    assert.deepEqual(r.json.doc, DOC);
    r = await run(ctx, ["preview", "kai", "--base", svc.url, "--site", "https://site.test", "--no-browser", "--json"]);
    assert.equal(r.json.url, `https://site.test/preview/${MINE}`);
    r = await run(ctx, ["render", "kai", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.file, join(ctx.cwd, "kai-256.png"), "a picture by name is named after it");
    assert.ok(r.json.url.includes(`/avatars/${MINE}.png`));
    r = await run(ctx, ["render", "aaaaaaaa", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.file, join(ctx.cwd, "aaaaaaaa-256.png"));
    r = await run(ctx, ["render", "kia", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no avatar named kia in your library; did you mean kai\?/);
  } finally { await svc.close(); }
});

test("rename and remove; the avatar still serves its document afterwards", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    await run(ctx, ["avatars", "save", MINE, "--name", "kai", "--base", svc.url]);
    let r = await run(ctx, ["avatars", "rename", "kai", "kai-old", "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "Renamed kai to kai-old.\n");
    assert.deepEqual(svc.calls.at(-1).body, { avatarKey: MINE, to: "kai-old" });
    r = await run(ctx, ["avatars", "remove", "kai-old", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.removed.avatarKey, MINE);
    assert.equal(svc.library.size, 0);
    assert.ok(!svc.calls.some((c) => c.method === "DELETE"), "nothing is deleted from the service but the entry");
    r = await run(ctx, ["avatars", "get", MINE, "--base", svc.url, "--json"]);
    assert.deepEqual(r.json.doc, DOC, "the key still serves .json");
  } finally { await svc.close(); }
});

test("a bad name is refused before any call; the server's 400 and 409 come through", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    for (const argv of [["avatars", "save", MINE, "--name", "Kai!"], ["generate", "a fox", "--name=-x"], ["avatars", "rename", "kai", "No Spaces"]]) {
      const r = await run(ctx, [...argv, "--base", svc.url]);
      assert.equal(r.code, 1, argv.join(" "));
      assert.match(r.stderr, /is not a name/);
    }
    assert.deepEqual(svc.calls, []);
    await run(ctx, ["avatars", "save", MINE, "--name", "kai", "--base", svc.url]);
    const r = await run(ctx, ["avatars", "save", THEIRS, "--name", "kai", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /already have an avatar named kai/);
  } finally { await svc.close(); }
});

test("signed out, avatars fails in one line that says to run minimoji login", async () => {
  const svc = await service();
  try {
    const ctx = await makeCtx();
    const r = await run(ctx, ["avatars", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `minimoji: not signed in to ${svc.url}; run minimoji login --base ${svc.url}\n`);
    assert.deepEqual(svc.calls, []);
  } finally { await svc.close(); }
});

test("generate with --key and no session keeps nothing, and --name then is refused before spending", async () => {
  const svc = await service();
  try {
    const ctx = await makeCtx({ env: { MINIMOJI_KEY: sec("4") } });
    let r = await run(ctx, ["generate", "a fox", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.avatars[0].name, null);
    assert.ok(!svc.calls.some((c) => c.path.startsWith("/cli/")));
    const before = svc.calls.length;
    r = await run(ctx, ["generate", "a fox", "--name", "fox", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /run minimoji login first/);
    assert.equal(svc.calls.length, before, "no generation spent");
  } finally { await svc.close(); }
});

test("generate: a library that refuses the avatar keeps and prints it, says why, and exits 1", async () => {
  const svc = await service({ "POST /cli/avatars": () => ({ status: 409, json: { error: "your library holds 500 avatars" } }) });
  try {
    const ctx = await signedIn(svc);
    const r = await run(ctx, ["generate", "a fox", "--base", svc.url, "--json"]);
    assert.equal(r.code, 1);
    assert.equal(r.json.avatars[0].avatarKey, MINE);
    assert.match(r.json.error, /saved a{64} but could not add it to your library: .*500 avatars/);
    assert.match(r.stderr, /could not add it to your library/);
  } finally { await svc.close(); }
});

test("resolving: a name first, then a full key, then a unique prefix of 8 or more", () => {
  const entries = [{ name: "kai", avatarKey: MINE }, { name: "pal", avatarKey: THEIRS }, { name: "bbbbbbbb", avatarKey: "c".repeat(64) }];
  assert.equal(resolveTarget("kai", entries).avatarKey, MINE);
  assert.equal(resolveTarget("bbbbbbbb", entries).name, "bbbbbbbb", "a name wins over a key prefix");
  assert.equal(resolveTarget(THEIRS, entries).name, "pal");
  assert.equal(resolveTarget("aaaaaaaaa", entries).name, "kai");
  assert.throws(() => resolveTarget("aaaa", entries), /no avatar named aaaa/, "under 8 characters is not a prefix");
  assert.throws(() => resolveTarget("d".repeat(64), entries), /not in your library/);
  assert.deepEqual(resolveTarget("d".repeat(64), entries, { anyKey: true }), { avatarKey: "d".repeat(64), name: null });
  const twins = [{ name: "x", avatarKey: "12345678" + "0".repeat(56) }, { name: "y", avatarKey: "12345678" + "1".repeat(56) }];
  assert.throws(() => resolveTarget("12345678", twins), /starts 2 of your avatars' keys \(x, y\)/);
  assert.equal(resolveTarget("123456781", twins).name, "y");
  assert.deepEqual(closeNames("kia", ["kai", "kaito", "pal"]), ["kai"]);
  assert.deepEqual(closeNames("ka", ["kai", "kaito", "pal"]), ["kai", "kaito"], "a part of a name is close");
  assert.equal(slugify("Red curls, round glasses!"), "red-curls-round-glasses");
});
