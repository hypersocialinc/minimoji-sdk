import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureServer, makeCtx, prefixOf, pub, run, sec, signIn, tempDir } from "./helpers.mjs";

/** a service that mints whatever kind it is asked for, counting */
async function minting(answer = (kind) => (kind === "publishable" ? pub("1") : sec("2"))) {
  return fixtureServer({ "POST /cli/keys": (c) => { const key = answer(c.body.kind); return { json: { key, prefix: prefixOf(key), kind: c.body.kind } }; } });
}

async function project(files) {
  const dir = await tempDir("minimoji-app-");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    if (!path.endsWith("/")) await writeFile(join(dir, path), text);
    else await mkdir(join(dir, path), { recursive: true });
  }
  return dir;
}

async function initIn(files, args = []) {
  const svc = await minting();
  const cwd = await project(files);
  const ctx = await makeCtx({ cwd });
  await signIn(ctx, svc.url);
  const r = await run(ctx, ["init", "--base", svc.url, "--json", ...args]);
  await svc.close();
  return { r, cwd, calls: svc.calls, base: svc.url };
}

test("init in a Next app writes a publishable key to .env.local, keeping other lines", async () => {
  const { r, cwd, calls, base } = await initIn({ "package.json": JSON.stringify({ name: "@acme/shop", dependencies: { next: "16", react: "19" } }), ".env.local": "OTHER=1" });
  assert.equal(r.code, 0, r.json?.error);
  assert.deepEqual(calls.map((c) => [c.path, c.body]), [["/cli/keys", { kind: "publishable", label: "shop (minimoji init)" }]]);
  const env = await readFile(join(cwd, ".env.local"), "utf8");
  assert.equal(env, `OTHER=1\nNEXT_PUBLIC_MINIMOJI_KEY=${pub("1")}\nNEXT_PUBLIC_MINIMOJI_SERVICE_URL=${base}\n`);
  assert.ok(!env.includes("mk_sec_"));
  assert.equal(r.json.project.framework, "next");
  assert.equal(r.json.key.kind, "publishable");
});

test("init in a Vite React app uses the VITE_ prefix", async () => {
  const { r, cwd } = await initIn({ "package.json": JSON.stringify({ dependencies: { react: "19" }, devDependencies: { vite: "7" } }) });
  assert.equal(r.code, 0);
  assert.match(await readFile(join(cwd, ".env.local"), "utf8"), /^VITE_MINIMOJI_KEY=mk_pub_/m);
});

test("init in an Xcode project with an Info.plist adds the demo app's two keys to it", async () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>Hello</string>\n</dict>\n</plist>\n`;
  const { r, cwd, base } = await initIn({ "Hello.xcodeproj/project.pbxproj": "", "Hello/Info.plist": plist, "HelloTests/Info.plist": plist });
  assert.equal(r.code, 0, r.json?.error);
  const text = await readFile(join(cwd, "Hello/Info.plist"), "utf8");
  assert.match(text, new RegExp(`<key>MINIMOJI_PUBLISHABLE_KEY</key>\\n\\t<string>${pub("1")}</string>`));
  assert.match(text, new RegExp(`<key>MINIMOJI_SERVICE_URL</key>\\n\\t<string>${base}</string>`));
  assert.match(text, /<key>CFBundleName<\/key>/);
  assert.equal(await readFile(join(cwd, "HelloTests/Info.plist"), "utf8"), plist, "a test bundle's plist is left alone");
});

test("init in an Xcode project without an Info.plist writes Minimoji.plist in the app folder", async () => {
  const { r, cwd } = await initIn({ "Hello.xcodeproj/project.pbxproj": "", "Hello/HelloApp.swift": "import SwiftUI" });
  assert.equal(r.code, 0, r.json?.error);
  const text = await readFile(join(cwd, "Hello/Minimoji.plist"), "utf8");
  assert.match(text, /<key>MINIMOJI_PUBLISHABLE_KEY<\/key>\n\t<string>mk_pub_/);
  assert.ok(r.json.next.some((n) => n.includes('forResource: "Minimoji"')));
});

test("init in an xcodegen project updates project.yml's key as well as the plist", async () => {
  const yml = "targets:\n  App:\n    info:\n      properties:\n        MINIMOJI_SERVICE_URL: https://old.convex.site\n        MINIMOJI_PUBLISHABLE_KEY: placeholder\n";
  const { r, cwd } = await initIn({ "project.yml": yml, "App/Info.plist": "<plist><dict>\n</dict></plist>" });
  assert.equal(r.code, 0, r.json?.error);
  const after = await readFile(join(cwd, "project.yml"), "utf8");
  assert.match(after, new RegExp(`MINIMOJI_PUBLISHABLE_KEY: ${pub("1")}`));
  assert.ok(!after.includes("old.convex.site"));
});

test("init keeps a publishable key already in place and mints nothing", async () => {
  const { r, calls } = await initIn({ "package.json": JSON.stringify({ dependencies: { next: "16" } }), ".env.local": `NEXT_PUBLIC_MINIMOJI_KEY=${pub("9")}\n` });
  assert.equal(r.code, 0);
  assert.deepEqual(calls, []);
  assert.equal(r.json.key.minted, false);
});

test("init replaces a secret key it finds in an app, and says to revoke it", async () => {
  const { r, cwd } = await initIn({ "package.json": JSON.stringify({ dependencies: { next: "16" } }), ".env.local": `NEXT_PUBLIC_MINIMOJI_KEY=${sec("7")}\n` });
  assert.equal(r.code, 0);
  assert.equal(r.json.replacedSecret, true);
  const env = await readFile(join(cwd, ".env.local"), "utf8");
  assert.ok(!env.includes("mk_sec_"));
});

test("init never writes a secret key, even if the service answers with one", async () => {
  const svc = await minting(() => sec("3"));
  const cwd = await project({ "package.json": JSON.stringify({ dependencies: { react: "19" } }) });
  const ctx = await makeCtx({ cwd });
  await signIn(ctx, svc.url);
  const r = await run(ctx, ["init", "--base", svc.url]);
  await svc.close();
  assert.equal(r.code, 1);
  assert.match(r.stderr, /refusing to write a key that is not a publishable/);
  assert.equal(await readFile(join(cwd, ".env.local"), "utf8").catch(() => null), null);
});

test("init refuses an empty folder, and a folder that is both kinds without --platform", async () => {
  let { r } = await initIn({});
  assert.equal(r.code, 1);
  assert.match(r.json.error, /no Xcode project/);
  ({ r } = await initIn({ "package.json": JSON.stringify({ dependencies: { react: "19" } }), "Package.swift": "" }));
  assert.match(r.json.error, /--platform/);
  ({ r } = await initIn({ "package.json": JSON.stringify({ dependencies: { react: "19" } }), "Package.swift": "" }, ["--platform", "web"]));
  assert.equal(r.code, 0);
});

test("init with two candidate Info.plists asks for --plist", async () => {
  const { r } = await initIn({ "A.xcodeproj/x": "", "A/Info.plist": "<plist><dict></dict></plist>", "B/Info.plist": "<plist><dict></dict></plist>" });
  assert.equal(r.code, 1);
  assert.match(r.json.error, /pass --plist/);
});

test("init replaces a secret key in a Swift app's Info.plist in place, leaving one entry", async () => {
  const plist = `<plist version="1.0">\n<dict>\n\t<key>MINIMOJI_PUBLISHABLE_KEY</key>\n\t<string>${sec("7")}</string>\n</dict>\n</plist>\n`;
  const { r, cwd } = await initIn({ "Hello.xcodeproj/x": "", "Hello/Info.plist": plist });
  assert.equal(r.code, 0, r.json?.error);
  assert.equal(r.json.replacedSecret, true);
  const text = await readFile(join(cwd, "Hello/Info.plist"), "utf8");
  assert.ok(!text.includes("mk_sec_"));
  assert.equal(text.match(/<key>MINIMOJI_PUBLISHABLE_KEY<\/key>/g).length, 1);
});

test("init --force mints a new key over one already in place", async () => {
  const { r, calls, cwd } = await initIn({ "package.json": JSON.stringify({ dependencies: { next: "16" } }), ".env.local": `NEXT_PUBLIC_MINIMOJI_KEY=${pub("9")}\n` }, ["--force"]);
  assert.equal(r.code, 0);
  assert.equal(calls.length, 1);
  assert.match(await readFile(join(cwd, ".env.local"), "utf8"), new RegExp(`^NEXT_PUBLIC_MINIMOJI_KEY=${pub("1")}$`, "m"));
});

test("init mints anew when the key in place is another deployment's", async () => {
  const { r, calls, cwd, base } = await initIn({ "package.json": JSON.stringify({ dependencies: { next: "16" } }), ".env.local": `NEXT_PUBLIC_MINIMOJI_KEY=${pub("9")}\nNEXT_PUBLIC_MINIMOJI_SERVICE_URL=https://other.convex.site\n` });
  assert.equal(r.code, 0);
  assert.equal(calls.length, 1);
  const env = await readFile(join(cwd, ".env.local"), "utf8");
  assert.match(env, new RegExp(`NEXT_PUBLIC_MINIMOJI_KEY=${pub("1")}`));
  assert.match(env, new RegExp(`NEXT_PUBLIC_MINIMOJI_SERVICE_URL=${base}`));
});

test("plist and yml edits: an empty <string/> is replaced, a missing service URL joins the key in project.yml, a blank line survives", async () => {
  const { upsertPlist, upsertYml, upsertEnv } = await import("../src/init.js");
  const plist = upsertPlist("<plist><dict>\n\t<key>MINIMOJI_PUBLISHABLE_KEY</key>\n\t<string/>\n</dict></plist>", "MINIMOJI_PUBLISHABLE_KEY", pub("1"));
  assert.equal(plist.match(/MINIMOJI_PUBLISHABLE_KEY/g).length, 1);
  assert.match(plist, new RegExp(pub("1")));
  assert.equal(upsertYml("      properties:\n        MINIMOJI_PUBLISHABLE_KEY: x\n", "MINIMOJI_SERVICE_URL", "https://s"), "      properties:\n        MINIMOJI_PUBLISHABLE_KEY: x\n        MINIMOJI_SERVICE_URL: https://s\n");
  assert.equal(upsertEnv("A=1\n\nK=old\n", "K", "new"), "A=1\n\nK=new\n");
});
