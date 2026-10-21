import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { credentialsPath, readCredentials } from "../src/service.js";
import { SESSION, fixtureServer, makeCtx, prefixOf, pub, run, sec, signIn } from "./helpers.mjs";

const START = { deviceCode: "d".repeat(64), userCode: "ABCD-EFGH", verificationUri: "https://www.minimoji.com/developers/device", verificationUriComplete: "https://www.minimoji.com/developers/device?code=ABCD-EFGH", interval: 5, expiresIn: 600 };
const TOKEN = "mk_cli_" + "e".repeat(40);

test("login: prints the code, opens the browser, waits through pending and slow_down, saves the session 0600", async () => {
  const sleeps = [];
  const svc = await fixtureServer({
    "POST /cli/login": () => ({ json: START }),
    "POST /cli/login/poll": [
      () => ({ status: 400, json: { error: "authorization_pending" } }),
      () => ({ status: 400, json: { error: "slow_down" } }),
      () => ({ json: { token: TOKEN, label: "minimoji CLI on test-host" } }),
    ],
    "GET /cli/whoami": () => ({ json: SESSION }),
  });
  try {
    const ctx = await makeCtx();
    ctx.sleep = async (ms) => { sleeps.push(ms); };
    const r = await run(ctx, ["login", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /ABCD-EFGH/);
    assert.match(r.stderr, /developers\/device\?code=ABCD-EFGH/);
    assert.deepEqual(ctx.opened, [START.verificationUriComplete]);
    assert.deepEqual(sleeps, [5000, 5000, 10000], "slow_down adds five seconds");
    assert.equal(r.json.email, "dev@example.com");
    assert.ok(!r.stdout.includes(TOKEN), "the token is never printed");
    assert.deepEqual(svc.calls.find((c) => c.path === "/cli/login").body, { label: "minimoji CLI on test-host" });
    const file = credentialsPath(ctx);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, "utf8")).deployments[svc.url].token, TOKEN);
    assert.equal(svc.calls.find((c) => c.path === "/cli/whoami").auth, `Bearer ${TOKEN}`);
  } finally { await svc.close(); }
});

test("login: --no-browser prints the URL only; a denial exits 1 with one line", async () => {
  const svc = await fixtureServer({
    "POST /cli/login": () => ({ json: START }),
    "POST /cli/login/poll": () => ({ status: 400, json: { error: "access_denied" } }),
  });
  try {
    const ctx = await makeCtx();
    const r = await run(ctx, ["login", "--base", svc.url, "--no-browser", "--json"]);
    assert.equal(r.code, 1);
    assert.deepEqual(ctx.opened, []);
    assert.deepEqual(r.json, { error: "the sign-in was denied in the browser" });
    assert.equal(r.stderr.trim().split("\n").at(-1), "minimoji: the sign-in was denied in the browser");
  } finally { await svc.close(); }
});

test("login when already signed in says so and starts nothing", async () => {
  const svc = await fixtureServer({ "GET /cli/whoami": () => ({ json: SESSION }) });
  try {
    const ctx = await makeCtx();
    await signIn(ctx, svc.url);
    const r = await run(ctx, ["login", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(r.json.already, true);
    assert.ok(!svc.calls.some((c) => c.path === "/cli/login"));
  } finally { await svc.close(); }
});

test("whoami: signed out is a one-line error naming login; a dead session says to log in again", async () => {
  const svc = await fixtureServer({ "GET /cli/whoami": () => ({ status: 401, json: { error: "this terminal was signed out" } }) });
  try {
    const ctx = await makeCtx();
    let r = await run(ctx, ["whoami", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^minimoji: not signed in to .*; run minimoji login --base http/);
    await signIn(ctx, svc.url);
    r = await run(ctx, ["whoami", "--base", svc.url, "--json"]);
    assert.equal(r.code, 1);
    assert.equal(r.json.error, "this terminal was signed out; run minimoji login again");
  } finally { await svc.close(); }
});

test("keys: create prints the key once, list shows rows, revoke sends the prefix", async () => {
  const key = pub();
  const svc = await fixtureServer({
    "POST /cli/keys": (c) => ({ json: { key, prefix: prefixOf(key), kind: c.body.kind } }),
    "GET /cli/keys": () => ({ json: { keys: [{ id: "k1", label: "app", kind: "publishable", prefix: prefixOf(key), createdAt: 0, revokedAt: null, lastUsedAt: null }] } }),
    "POST /cli/keys/revoke": (c) => ({ json: { revoked: c.body.prefix } }),
  });
  try {
    const ctx = await makeCtx();
    await signIn(ctx, svc.url);
    let r = await run(ctx, ["keys", "create", "--kind", "publishable", "--label", "my app", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.key, key);
    assert.deepEqual(svc.calls.at(-1).body, { kind: "publishable", label: "my app" });
    r = await run(ctx, ["keys", "list", "--base", svc.url]);
    assert.match(r.stdout, /mk_pub_aaaa…aaaa\s+publishable\s+live\s+app/);
    r = await run(ctx, ["keys", "revoke", prefixOf(key), "--base", svc.url, "--json"]);
    assert.deepEqual(r.json, { revoked: prefixOf(key) });
    r = await run(ctx, ["keys", "create", "--base", svc.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--kind publishable/);
  } finally { await svc.close(); }
});

test("logout revokes the CLI's own secret key, ends the session and forgets both", async () => {
  const key = sec();
  const svc = await fixtureServer({
    "POST /cli/keys/revoke": (c) => ({ json: { revoked: c.body.prefix } }),
    "POST /cli/logout": () => ({ json: { signedOut: true } }),
  });
  try {
    const ctx = await makeCtx();
    await signIn(ctx, svc.url, { secretKey: { key, prefix: prefixOf(key) } });
    const r = await run(ctx, ["logout", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.signedOut, true);
    assert.deepEqual(svc.calls.map((c) => c.path), ["/cli/keys/revoke", "/cli/logout"]);
    assert.deepEqual(svc.calls[0].body, { prefix: prefixOf(key) });
    assert.deepEqual(JSON.parse(await readFile(credentialsPath(ctx), "utf8")).deployments, {});
  } finally { await svc.close(); }
});

test("login over a dead session starts a new one and keeps the CLI's secret key", async () => {
  const svc = await fixtureServer({
    "GET /cli/whoami": [() => ({ status: 401, json: { error: "this terminal was signed out" } }), () => ({ json: SESSION })],
    "POST /cli/login": () => ({ json: START }),
    "POST /cli/login/poll": () => ({ json: { token: TOKEN, label: "x" } }),
  });
  try {
    const ctx = await makeCtx();
    await signIn(ctx, svc.url, { secretKey: { key: sec("9"), prefix: prefixOf(sec("9")) } });
    const r = await run(ctx, ["login", "--base", svc.url, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.notEqual(r.json.already, true);
    assert.ok(svc.calls.some((c) => c.path === "/cli/login"));
    const saved = (await readCredentials(ctx)).deployments[svc.url];
    assert.equal(saved.token, TOKEN);
    assert.equal(saved.secretKey.key, sec("9"));
  } finally { await svc.close(); }
});

test("login: an expired code, or a deadline that passes while pending, exits 1", async () => {
  const svc = await fixtureServer({
    "POST /cli/login": [() => ({ json: START }), () => ({ json: { ...START, expiresIn: 0 } })],
    "POST /cli/login/poll": [() => ({ status: 400, json: { error: "expired_token" } }), () => ({ status: 400, json: { error: "authorization_pending" } })],
  });
  try {
    const ctx = await makeCtx();
    for (let i = 0; i < 2; i++) {
      const r = await run(ctx, ["login", "--base", svc.url, "--json"]);
      assert.equal(r.code, 1);
      assert.match(r.json.error, /the code expired before it was approved/);
    }
  } finally { await svc.close(); }
});

test("keys revoke of the CLI's own key forgets it", async () => {
  const svc = await fixtureServer({ "POST /cli/keys/revoke": (c) => ({ json: { revoked: c.body.prefix } }) });
  try {
    const ctx = await makeCtx();
    await signIn(ctx, svc.url, { secretKey: { key: sec(), prefix: prefixOf(sec()) } });
    const r = await run(ctx, ["keys", "revoke", prefixOf(sec()), "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal((await readCredentials(ctx)).deployments[svc.url].secretKey, undefined);
  } finally { await svc.close(); }
});
