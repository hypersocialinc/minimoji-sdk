import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeDoc } from "../src/avatars.js";
import { BASES, readCredentials } from "../src/service.js";
import { fixtureServer, makeCtx, prefixOf, run, sec, signIn } from "./helpers.mjs";

const DOC = { v: 2, seed: 7, hair: { style: "curly", color: "ginger" } };
const KEY64 = "a".repeat(64);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const CAPS = {
  characters: [{ id: "alien", name: "Classic grey", family: "alien", kit: "alien" }, { id: "agent", name: "D.A.S.H.", family: "dash", kit: null }],
  characterKits: { alien: { eyes: ["almond", "cyclops"], shell: ["grey", "mint"] } },
};

/** a service that generates DOC, saves anything as KEY64, and mints the CLI's secret key */
async function service(extra = {}) {
  const svc = await fixtureServer({
    "POST /cli/keys": (c) => ({ json: { key: sec(), prefix: prefixOf(sec()), kind: c.body.kind } }),
    "POST /avatars/generate": () => ({ json: { doc: DOC, notes: "curls matched to ginger", usage: {} } }),
    "POST /avatars": () => ({ json: { avatarKey: KEY64, json: `${svc.url}/avatars/${KEY64}.json`, glb: `${svc.url}/avatars/${KEY64}.glb`, png: `${svc.url}/avatars/${KEY64}.png` } }),
    "GET /capabilities": () => ({ json: CAPS }),
    [`GET /avatars/${KEY64}.json`]: () => ({ json: DOC }),
    ...extra,
  });
  return svc;
}

async function signedIn(svc) {
  const ctx = await makeCtx();
  await signIn(ctx, svc.url);
  return ctx;
}

test("generate: --count over 10 (or not a whole number) is refused before any call", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    for (const count of ["11", "0", "2.5", "x"]) {
      const r = await run(ctx, ["generate", "a fox", "--count", count, "--base", svc.url, "--json"]);
      assert.equal(r.code, 1);
      assert.match(r.json.error, /--count must be a whole number from 1 to 10/);
    }
    assert.deepEqual(svc.calls, []);
  } finally { await svc.close(); }
});

test("generate: mints the CLI's secret key once, generates, saves, and prints key, picture and preview", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    const r = await run(ctx, ["generate", "red", "curls", "--count", "2", "--seed", "5", "--out", "kai.json", "--open", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(svc.calls.map((c) => `${c.method} ${c.path}`), ["POST /cli/keys", "POST /avatars/generate", "POST /avatars", "POST /avatars/generate", "POST /avatars"]);
    assert.deepEqual(svc.calls[0].body, { kind: "secret", label: "minimoji CLI on test-host" });
    assert.deepEqual(svc.calls[1].body, { prompt: "red curls", seed: 5 });
    assert.equal(svc.calls[3].body.seed, 6, "each of a count gets its own seed");
    assert.equal(svc.calls[1].auth, `Bearer ${sec()}`);
    assert.deepEqual(svc.calls[2].body, { doc: DOC });
    const [a] = r.json.avatars;
    assert.equal(a.avatarKey, KEY64);
    assert.equal(a.picture, `${svc.url}/avatars/${KEY64}.png?size=256`);
    // not production: the site cannot read this deployment, so the document rides in the fragment
    assert.equal(a.preview, `https://www.minimoji.com/preview#doc=${encodeDoc(DOC)}`);
    assert.deepEqual(ctx.opened, [a.preview, a.preview], "--open opens the preview page, not the PNG");
    assert.deepEqual(JSON.parse(await readFile(join(ctx.cwd, "kai.json"), "utf8")), DOC);
    assert.deepEqual(JSON.parse(await readFile(join(ctx.cwd, "kai-2.json"), "utf8")), DOC);
    assert.equal((await readCredentials(ctx)).deployments[svc.url].secretKey.key, sec(), "the key is kept for next time");
  } finally { await svc.close(); }
});

test("generate --photo sends the image as base64; a file that is not JPEG or PNG is refused first", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await writeFile(join(ctx.cwd, "me.jpg"), jpeg);
    await writeFile(join(ctx.cwd, "me.txt"), "hello");
    let r = await run(ctx, ["generate", "--photo", "me.txt", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /must be a JPEG or a PNG/);
    assert.deepEqual(svc.calls, []);
    r = await run(ctx, ["generate", "--photo", "me.jpg", "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(svc.calls.find((c) => c.path === "/avatars/generate").body, { image: jpeg.toString("base64") });
  } finally { await svc.close(); }
});

test("a stored CLI key the service refuses is replaced once and the call retried", async () => {
  const svc = await service({ "POST /avatars/generate": [() => ({ status: 401, json: { error: "this key was revoked" } }), () => ({ json: { doc: DOC } })] });
  try {
    const ctx = await makeCtx();
    await signIn(ctx, svc.url, { secretKey: { key: sec("9"), prefix: prefixOf(sec("9")) } });
    const r = await run(ctx, ["generate", "a fox", "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(svc.calls.map((c) => c.path), ["/avatars/generate", "/cli/keys", "/avatars/generate", "/avatars"]);
    assert.equal(svc.calls[2].auth, `Bearer ${sec()}`);
  } finally { await svc.close(); }
});

test("--key / MINIMOJI_KEY saves with that key and needs no sign-in", async () => {
  const svc = await service();
  try {
    const ctx = await makeCtx({ env: { MINIMOJI_KEY: sec("4") } });
    const r = await run(ctx, ["species", "make", "agent", "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.calls.find((c) => c.path === "/avatars").auth, `Bearer ${sec("4")}`);
  } finally { await svc.close(); }
});

test("species list is /capabilities' characters and kits", async () => {
  const svc = await service();
  try {
    const ctx = await makeCtx();
    let r = await run(ctx, ["species", "list", "--base", svc.url, "--json"]);
    assert.deepEqual(r.json, CAPS);
    r = await run(ctx, ["species", "list", "--base", svc.url]);
    assert.match(r.stdout, /alien\s+Classic grey\s+alien\s+alien/);
    assert.match(r.stdout, /eyes: almond, cyclops/);
  } finally { await svc.close(); }
});

test("species make saves {character} with the picks; a pick outside the kit is refused before saving", async () => {
  const svc = await service();
  try {
    const ctx = await signedIn(svc);
    let r = await run(ctx, ["species", "make", "alien", "--seed", "3", "--pick", "eyes=cyclops", "--pick", "shell=mint", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(svc.calls.find((c) => c.path === "/avatars").body, { character: { id: "alien", seed: 3, pick: { eyes: "cyclops", shell: "mint" } } });
    assert.equal(r.json.avatar.avatarKey, KEY64);
    const before = svc.calls.length;
    for (const [args, why] of [
      [["alien", "--pick", "eyes=bogus"], /eyes is one of almond, cyclops/],
      [["alien", "--pick", "horns=big"], /no axis "horns"/],
      [["alien", "--pick", "eyes"], /axis=option/],
      [["agent", "--pick", "eyes=round"], /no kit/],
      [["dragon"], /no species "dragon"/],
    ]) {
      r = await run(ctx, ["species", "make", ...args, "--base", svc.url]);
      assert.equal(r.code, 1, args.join(" "));
      assert.match(r.stderr, why);
    }
    assert.ok(svc.calls.slice(before).every((c) => c.path === "/capabilities"), "nothing saved");
  } finally { await svc.close(); }
});

test("render writes the PNG the picture route redirects to", async () => {
  const svc = await service({
    [`GET /avatars/${KEY64}.png`]: () => ({ status: 302, headers: { Location: "/cdn/pic.png" } }),
    "GET /cdn/pic.png": () => ({ body: PNG, headers: { "Content-Type": "image/png" } }),
  });
  try {
    const ctx = await makeCtx();
    const r = await run(ctx, ["render", KEY64, "--size", "128", "--face", "happy", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(await readFile(join(ctx.cwd, `${KEY64.slice(0, 12)}-128.png`)), PNG);
    assert.equal(svc.calls[0].search, "?size=128&face=happy");
    for (const args of [["nothex"], [KEY64, "--size", "100"]]) assert.equal((await run(ctx, ["render", ...args, "--base", svc.url])).code, 1);
  } finally { await svc.close(); }
});

test("preview: a key on production is the /preview/<key> page; elsewhere and for a file, the document in the fragment", async () => {
  const svc = await service();
  try {
    const ctx = await makeCtx();
    let r = await run(ctx, ["preview", KEY64, "--base", "prod", "--face", "happy", "--body", "--json"]);
    assert.equal(r.json.url, `https://www.minimoji.com/preview/${KEY64}?face=happy&body=1`);
    assert.deepEqual(ctx.opened, [r.json.url]);
    assert.ok(!r.json.url.includes(BASES.prod), "the site knows production's service");
    r = await run(ctx, ["preview", KEY64, "--base", svc.url, "--json"]);
    assert.equal(r.json.url, `https://www.minimoji.com/preview#doc=${encodeDoc(DOC)}`);
    await writeFile(join(ctx.cwd, "kai.json"), JSON.stringify(DOC));
    const calls = svc.calls.length;
    r = await run(ctx, ["preview", "kai.json", "--base", svc.url, "--no-browser", "--json"]);
    assert.equal(r.json.url, `https://www.minimoji.com/preview#doc=${encodeDoc(DOC)}`);
    assert.equal(svc.calls.length, calls, "a local document is never uploaded");
    assert.equal(ctx.opened.length, 2, "--no-browser opens nothing");
    assert.equal(Buffer.from(encodeDoc(DOC), "base64url").toString(), JSON.stringify(DOC));
  } finally { await svc.close(); }
});

test("generate --count: a failure partway keeps and prints what was made, and exits 1", async () => {
  const ok = () => ({ json: { doc: DOC } });
  const svc = await service({ "POST /avatars/generate": [ok, ok, () => ({ status: 429, json: { error: "today's generations are spent" } })] });
  try {
    const ctx = await signedIn(svc);
    const r = await run(ctx, ["generate", "a fox", "--count", "4", "--out", "fox.json", "--base", svc.url, "--json"]);
    assert.equal(r.code, 1);
    assert.equal(r.json.avatars.length, 2);
    assert.match(r.json.error, /^made 2 of 4, then: .*today's generations are spent/);
    assert.deepEqual(JSON.parse(await readFile(join(ctx.cwd, "fox-2.json"), "utf8")), DOC);
    assert.match(r.stderr, /minimoji: made 2 of 4/);
  } finally { await svc.close(); }
});
