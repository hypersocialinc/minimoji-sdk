import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { HEADLINE, ROUTES, summarize } from "../src/admin.js";
import { fixtureServer, makeCtx, run, signIn } from "./helpers.mjs";

const DAYS = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
const point = (day, n, errors = 0) => ({ day, n, errors, limited: 0, cached: 0, msAvg: n ? 120 : 0 });
const series = (byDay = {}) => DAYS.map((d) => point(d, ...(byDay[d] ?? [0])));
const OVERVIEW = {
  days: DAYS,
  series: {
    bake: series({ "2026-11-04": [5, 1], "2026-11-05": [3] }), say: series({ "2026-11-05": [2, 2] }), save: series({ "2026-11-01": [4] }),
    generate: series(), lines: series(), pick: series(), pack: series(), connectStart: series(), connectGrant: series(), connect: series(),
    avatar: series({ "2026-11-05": [1] }), account: series({ "2026-11-05": [1] }), key: series(),
  },
  apps: [{ keyId: "k1", n: 14, label: "Bunch iOS", prefix: "mk_pub_ab12…cd34", ownerKind: "developer", revoked: false,
    daily: DAYS.map((d) => ({ n: d === "2026-11-05" ? 5 : d === "2026-11-04" ? 5 : d === "2026-11-01" ? 4 : 0, calls: 0, errors: d === "2026-11-05" ? 2 : d === "2026-11-04" ? 1 : 0, bake: 0, say: 0 })) }],
  truncated: [], firstDay: "2026-10-20",
};
const PEOPLE = { days: DAYS, madeAvatar: [0, 0, 0, 1, 0, 2, 1], connected: [0, 0, 0, 0, 0, 0, 1], capped: false };
const RECENT = { events: [{ id: "e1", at: 1, route: "/avatars/bake", status: 200, ms: 300, cached: false, label: "Bunch iOS", prefix: "mk_pub_ab12…cd34", ownerKind: "developer" }], timings: { bake: [{ day: "2026-11-05", ms: 300 }] } };

async function service({ admin = true } = {}) {
  const refuse = { status: 403, json: { error: "this terminal cannot read the numbers: the account is not a Minimoji admin, or its admin week ran out (minimoji login --force signs it in again)" } };
  return fixtureServer({
    "GET /cli/admin/overview": () => (admin ? { json: OVERVIEW } : refuse),
    "GET /cli/admin/people": () => (admin ? { json: PEOPLE } : refuse),
    "GET /cli/admin/recent": () => (admin ? { json: RECENT } : refuse),
  });
}
const fixedCtx = async () => Object.assign(await makeCtx(), { now: () => Date.UTC(2026, 10, 5, 23, 59) });

test("admin numbers prints a readable summary from the overview and people, today being the UTC day", async () => {
  const svc = await service();
  const ctx = await fixedCtx();
  await signIn(ctx, svc.url);
  const r = await run(ctx, ["admin", "numbers", "--base", svc.url]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Minimoji numbers for 2026-11-05 \(UTC\), against the last 7 days/);
  assert.match(r.stdout, /^People: first Mini avatar\s+1\s+2\s+4$/m, "today, yesterday, the window");
  assert.match(r.stdout, /^Bakes\s+3\s+5\s+8$/m);
  assert.match(r.stdout, /^Bunch iOS\s+mk_pub_ab12…cd34\s+5\s+14\s+3$/m, "the top app by label and prefix");
  assert.match(r.stdout, /^say\s+2 of 2 failed\s+2 today$/m);
  assert.match(r.stdout, /^bake\s+1 of 8 failed\s+0 today$/m);
  const asked = svc.calls.map((c) => `${c.path}${c.search}`).sort();
  assert.deepEqual(asked, ["/cli/admin/overview?today=2026-11-05&days=7", "/cli/admin/people?today=2026-11-05&days=7"]);
  assert.ok(svc.calls.every((c) => c.auth === `Bearer mk_cli_${"c".repeat(40)}`), "the session token, never a key");
  await svc.close();
});

test("admin overview|people|recent --json print the routes' JSON as it came; --days and --today pass through", async () => {
  const svc = await service();
  const ctx = await fixedCtx();
  await signIn(ctx, svc.url);
  for (const [sub, want] of [["overview", OVERVIEW], ["people", PEOPLE], ["recent", RECENT]]) {
    const r = await run(ctx, ["admin", sub, "--json", "--base", svc.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, want, sub);
    const plain = await run(ctx, ["admin", sub, "--base", svc.url]);
    assert.deepEqual(JSON.parse(plain.stdout), want, `${sub} without --json is the same JSON`);
  }
  svc.calls.length = 0;
  await run(ctx, ["admin", "overview", "--days", "30", "--today", "2026-11-01", "--json", "--base", svc.url]);
  assert.equal(svc.calls[0].search, "?today=2026-11-01&days=30");
  svc.calls.length = 0;
  await run(ctx, ["admin", "recent", "--json", "--base", svc.url]);
  assert.equal(svc.calls[0].search, "?today=2026-11-05", "recent takes today alone");
  const summary = await run(ctx, ["admin", "numbers", "--json", "--base", svc.url]);
  assert.deepEqual(summary.json, summarize(OVERVIEW, PEOPLE));
  assert.equal(summary.json.headline.say.today, 2);
  await svc.close();
});

test("not signed in says to log in; a non-admin's 403 is one plain line", async () => {
  const svc = await service({ admin: false });
  const ctx = await fixedCtx();
  const out = await run(ctx, ["admin", "numbers", "--base", svc.url]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /^minimoji: not signed in to .*; run minimoji login/);
  assert.equal(svc.calls.length, 0);
  await signIn(ctx, svc.url);
  for (const sub of ["numbers", "overview", "people", "recent"]) {
    const r = await run(ctx, ["admin", sub, "--json", "--base", svc.url]);
    assert.equal(r.code, 1, sub);
    assert.equal(r.stderr, "minimoji: this account is not a Minimoji admin, or this terminal's admin week ran out (minimoji login --force signs it in again)\n");
    assert.match(r.json.error, /^this account is not a Minimoji admin/);
  }
  await svc.close();
});

test("bad subcommands and options are refused before any call", async () => {
  const svc = await service();
  const ctx = await fixedCtx();
  await signIn(ctx, svc.url);
  for (const argv of [["admin"], ["admin", "frob"], ["admin", "numbers", "extra"], ["admin", "overview", "--days", "x"], ["admin", "overview", "--today", "nov 5"], ["admin", "recent", "--days", "7"]]) {
    const r = await run(ctx, [...argv, "--base", svc.url]);
    assert.equal(r.code, 1, argv.join(" "));
    assert.equal(r.stderr.split("\n").filter(Boolean).length, 1);
  }
  assert.equal(svc.calls.length, 0);
  await svc.close();
});

test("admin is hidden: not in minimoji --help nor the README, but its own --help works", async () => {
  const ctx = await makeCtx();
  const top = await run(ctx, ["--help"]);
  assert.doesNotMatch(top.stdout, /admin/i);
  assert.doesNotMatch(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /minimoji admin|\/cli\/admin/);
  const own = await run(ctx, ["admin", "--help"]);
  assert.match(own.stdout, /^minimoji admin numbers/);
});

// in the monorepo only: the exported CLI (minimoji-sdk) has no convex/ beside it
const SERVER = new URL("../../../convex/lib/numbers.ts", import.meta.url);
test("the summary's metric names are the server's: a rename there fails here, not silently as zeros", { skip: !existsSync(SERVER) && "no convex/ here" }, async () => {
  const { METRICS, ROUTE_METRICS } = await import(SERVER.href);
  assert.deepEqual(ROUTES, ROUTE_METRICS);
  for (const [, [from, key]] of HEADLINE) {
    if (from === "series") assert.ok(METRICS.includes(key), key);
    else assert.ok(["madeAvatar", "connected"].includes(key), key);
  }
});
