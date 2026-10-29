// `minimoji mcp` driven as an MCP client drives it: the real process, its
// stdin and stdout as the pipe, against the fixture service (no network, no
// paid call). Every line it writes to stdout must be a JSON-RPC message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fixtureServer, makeCtx, prefixOf, sec, signIn, SESSION, tempDir } from "./helpers.mjs";
import { PROTOCOL_VERSION, TOOLS, checkArgs } from "../src/mcp.js";
import { SKILLS_REPO } from "../src/skills.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const KAI = "a".repeat(64), MADE = "b".repeat(64), DASH = "c".repeat(64);
const SHA = "1".repeat(40);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const TOOL_NAMES = ["whoami", "list_avatars", "make_avatar", "edit_avatar", "list_species", "make_species_avatar", "get_status", "set_status", "list_voices", "say", "lines", "render_still", "preview_link"];

/** the routes the tools call, plus GitHub's for the skill resources */
async function service() {
  let origin = null;
  const saved = (avatarKey) => ({ avatarKey, png: `${origin}/avatars/${avatarKey}.png`, json: `${origin}/avatars/${avatarKey}.json`, glb: `${origin}/avatars/${avatarKey}.glb` });
  const kai = { name: "kai", avatarKey: KAI, kind: "person", createdAt: 1, updatedAt: 1, status: null, ttsVoice: null };
  const svc = await fixtureServer({
    "GET /cli/whoami": () => ({ json: SESSION }),
    "GET /cli/avatars": () => ({ json: { avatars: [kai] } }),
    "POST /cli/avatars": ({ body }) => ({ json: { avatar: { ...kai, name: body.name ?? body.defaultName, avatarKey: body.avatarKey, kind: body.avatarKey === DASH ? "species" : "person" }, outcome: "added" } }),
    "POST /cli/avatars/status": ({ body }) => ({ json: { avatar: kai, status: body.text ? { text: body.text, mood: "happy", setAt: Date.now() } : null } }),
    "POST /avatars/generate": () => ({ json: { doc: { v: 1, hair: "red curls" }, notes: null } }),
    "POST /avatars": ({ body }) => ({ json: saved(body.character ? DASH : MADE) }),
    "GET /avatars/*": ({ path }) => (path.endsWith(".png") ? { body: PNG, headers: { "Content-Type": "image/png" } } : { json: { v: 1 } }),
    "GET /capabilities": () => ({ json: { characters: [{ id: "dash", name: "D.A.S.H.", family: "robot", kit: null }], characterKits: {} } }),
    "GET /lines/voices": () => ({ json: { voices: [{ name: "person", voiceId: "21m00Tcm4TlvDq8ikWAM", effect: "none", hint: "warm" }] } }),
    "POST /lines/say": ({ body }) => ({ json: {
      audio: `${origin}/say/o/${body.text.toLowerCase()}.wav`, format: "wav", durationMs: 500, transcript: body.text, chars: body.text.length, charged: body.text.length, cached: false,
      line: { v: 1, duration: 0.5, words: [{ text: "Hi", start: 0, end: 0.3 }] }, words: [{ text: "Hi", start: 0, end: 0.3 }], letters: [{ text: "H", start: 0, end: 0.1 }, { text: "i", start: 0.1, end: 0.3 }],
      voice: { name: "person", voiceId: "21m00Tcm4TlvDq8ikWAM", effect: "none" },
    } }),
    "GET /say/*": ({ path }) => (path.includes("broken") ? { status: 500, body: "no" } : { body: Buffer.from(`RIFF${path}WAVE`), headers: { "Content-Type": "audio/wav" } }),
    [`GET /repos/${SKILLS_REPO}/commits/main`]: () => ({ body: SHA, headers: { "Content-Type": "text/plain" } }),
    [`GET /${SKILLS_REPO}/${SHA}/skills/*`]: ({ path }) => ({ body: `---\nname: ${path.split("/")[5]}\n---\n\n# The ${path.split("/")[5]} guide\n` }),
    "GET /photo.png": () => ({ body: PNG, headers: { "Content-Type": "image/png" } }),
  });
  origin = svc.url;
  return svc;
}

/** a client on the server's pipe: request() answers by id; every stdout line is kept and must parse */
async function client(env, { signedIn = true } = {}) {
  const svc = await service();
  const ctx = await makeCtx();
  if (signedIn) await signIn(ctx, svc.url, { secretKey: { key: sec(), prefix: prefixOf(sec()), label: "t" } });
  const out = await tempDir("minimoji-mcp-out-");
  const child = spawn(process.execPath, [CLI, "mcp", "--out", out], {
    cwd: ctx.cwd,
    env: { PATH: process.env.PATH, ...ctx.env, MINIMOJI_MCP_LOCAL_URLS: "1", MINIMOJI_API: svc.url, MINIMOJI_SKILLS_API: svc.url, MINIMOJI_SKILLS_RAW: svc.url, MINIMOJI_NO_BROWSER: "1", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages = [], waiting = new Map(), orphans = [];
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);   // a line that is not JSON fails the test right here
    assert.equal(message.jsonrpc, "2.0");
    messages.push(message);
    if (waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); } else orphans.push(message);
  });
  const exited = new Promise((r) => child.on("exit", r));
  let next = 1;
  const send = (text) => child.stdin.write(`${text}\n`);
  const request = (method, params) => {
    const id = next++;
    const answer = new Promise((r) => waiting.set(id, r));
    send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }));
    return answer;
  };
  const tool = async (name, args = {}) => {
    const r = await request("tools/call", { name, arguments: args });
    assert.ok(r.result, `${name} answered ${JSON.stringify(r.error)}`);
    return { ...r.result, data: r.result.isError ? null : JSON.parse(r.result.content[0].text) };
  };
  const close = async () => { child.stdin.end(); const code = await exited; await svc.close(); return code; };
  return { svc, out, cwd: ctx.cwd, send, request, tool, messages, orphans, close, stderr: () => stderr };
}

const initialize = (c) => c.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } });

test("mcp: initialize, tools/list (every tool, a schema and what it spends), resources over a pipe", async () => {
  const c = await client();
  try {
    const init = await initialize(c);
    assert.equal(init.result.protocolVersion, PROTOCOL_VERSION);
    assert.equal(init.result.serverInfo.name, "minimoji");
    assert.match(init.result.serverInfo.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(init.result.capabilities, { tools: {}, resources: {} });
    assert.match(init.result.instructions, /minimoji login/);
    assert.match(init.result.instructions, /make_avatar → say → show the person say.s play link/);
    c.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const older = await c.request("initialize", { protocolVersion: "2025-03-26", capabilities: {} });
    assert.equal(older.result.protocolVersion, "2025-03-26", "an older protocol is spoken as asked");
    assert.equal((await c.request("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, PROTOCOL_VERSION);

    const { tools } = (await c.request("tools/list")).result;
    assert.deepEqual(tools.map((t) => t.name), TOOL_NAMES);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      assert.match(t.description, /[Ss]pends/, `${t.name} says what it spends`);
      // no key in any schema: not a property, not a word in one
      assert.doesNotMatch(JSON.stringify(t.inputSchema), /key/i, `${t.name}'s schema names no key`);
    }
    assert.match(tools.find((t) => t.name === "make_avatar").description, /one generation/);
    assert.match(tools.find((t) => t.name === "say").description, /characters/);
    assert.match(tools.find((t) => t.name === "say").description, /Show the person play/, "the agent is told to show the link that talks");
    assert.ok(!tools.some((t) => /login|logout|keys/.test(t.name)), "signing in and keys stay in the terminal");

    const { resources } = (await c.request("resources/list")).result;
    assert.deepEqual(resources.map((r) => r.uri), ["minimoji://skill/web", "minimoji://skill/swift"]);
    const web = (await c.request("resources/read", { uri: "minimoji://skill/web" })).result.contents[0];
    assert.equal(web.mimeType, "text/markdown");
    assert.match(web.text, /# The minimoji-web guide/);
    assert.match(web.text, new RegExp(`minimoji-source: ${SKILLS_REPO}@${SHA}`));
    assert.match((await c.request("resources/read", { uri: "minimoji://skill/swift" })).result.contents[0].text, /minimoji-swift guide/);
    assert.equal((await c.request("resources/read", { uri: "minimoji://skill/nope" })).error.code, -32002);
    assert.deepEqual((await c.request("ping")).result, {});
  } finally { assert.equal(await c.close(), 0, "stdin closing ends the server cleanly"); }
});

test("mcp: the tools run the commands on the signed-in terminal and answer their --json", async () => {
  const c = await client();
  try {
    await initialize(c);
    assert.equal((await c.tool("whoami")).data.email, SESSION.email);
    assert.deepEqual((await c.tool("list_avatars")).data.avatars.map((a) => a.name), ["kai"]);

    const made = await c.tool("make_avatar", { description: "red curls, round glasses" });
    assert.equal(made.isError, undefined);
    assert.equal(made.data.avatars[0].avatarKey, MADE);
    assert.equal(made.data.avatars[0].name, "red-curls-round-glasses");
    assert.equal(made.data.avatars[0].doc, undefined, "the document stays out of the agent's context");
    assert.deepEqual(made.structuredContent, made.data);
    const generate = c.svc.calls.find((x) => x.path === "/avatars/generate");
    assert.equal(generate.auth, `Bearer ${sec()}`, "the terminal's own secret key, never an argument");

    // a photo URL is downloaded and sent as the photo
    const fromURL = await c.tool("make_avatar", { photo: `${c.svc.url}/photo.png`, name: "me" });
    assert.equal(fromURL.data.avatars[0].name, "me");
    assert.equal(c.svc.calls.filter((x) => x.path === "/avatars/generate").at(-1).body.image, PNG.toString("base64"));
    assert.match((await c.tool("make_avatar", { photo: "file:///etc/passwd" })).content[0].text, /local path or an https URL/);

    const dash = await c.tool("make_species_avatar", { species: "dash" });
    assert.equal(dash.data.avatar.avatarKey, DASH);
    assert.equal(dash.data.avatar.name, "dash", "kept in the library, named after the species");

    const set = await c.tool("set_status", { avatar: "kai", text: "back at 3" });
    assert.equal(set.data.status.text, "back at 3");
    assert.match((await c.tool("set_status", { avatar: "kai" })).content[0].text, /needs text, or clear/);

    const said = await c.tool("say", { avatar: "kai", text: "Hi", voice: "person" });
    assert.equal(said.data.audio, `${c.svc.url}/say/o/hi.wav`, "the public URL: a web agent needs no file");
    assert.deepEqual(said.data.letters.map((l) => l.text), ["H", "i"]);
    assert.equal(said.data.words[0].text, "Hi");
    assert.equal(said.data.line.duration, 0.5);
    assert.equal(said.data.charged, 2);
    assert.equal(said.data.lineFile, join(c.out, "kai-hi.json"), "named for the avatar and the words");
    assert.equal(said.data.play, null, "the fixture keeps lines where the preview page does not read");
    assert.match(said.data.playNote, /does not read/, "and the answer says why there is no play link");
    assert.equal((await stat(said.data.audioFile)).isFile(), true);
    assert.deepEqual(c.svc.calls.find((x) => x.path === "/lines/say").body, { text: "Hi", voice: "person", model: "eleven_v4" });

    const still = await c.tool("render_still", { avatar: "kai", size: 128 });
    assert.equal(still.data.file, join(c.out, "kai-128.png"));
    assert.deepEqual(await readFile(still.data.file), PNG);
    assert.match((await c.tool("render_still", { avatar: "kai", size: 100 })).content[0].text, /size is one of 64, 128, 256, 512/);

    const link = await c.tool("preview_link", { avatar: "kai" });
    assert.match(link.data.url, /^https:\/\/www\.minimoji\.com\/preview#doc=/);
    assert.equal((await c.tool("list_voices")).data.voices[0].name, "person");
    assert.equal((await c.tool("list_species")).data.characters[0].id, "dash");
  } finally { await c.close(); }
});

test("mcp: paths, files and refusals an agent can run into", async () => {
  const c = await client();
  try {
    await initialize(c);
    // a relative photo is the client's (where the server runs), not the --out folder's
    await writeFile(join(c.cwd, "me.png"), PNG);
    assert.equal((await c.tool("make_avatar", { photo: "me.png" })).isError, undefined);
    assert.equal(c.svc.calls.filter((x) => x.path === "/avatars/generate").at(-1).body.image, PNG.toString("base64"));

    // two avatars saying the same words at once keep two pairs of files, each its own
    const [kai, bo] = await Promise.all([c.tool("say", { avatar: "kai", text: "Hi", voice: "person" }), c.tool("say", { avatar: "bo", text: "Hi", voice: "person" })]);
    assert.notEqual(kai.data.audioFile, bo.data.audioFile);
    assert.deepEqual(JSON.parse(await readFile(kai.data.lineFile, "utf8")), kai.data.line);
    assert.equal((await stat(bo.data.audioFile)).isFile(), true);

    // spoken and paid for, but the download failed: the answer still names the audio's URL
    const broken = await c.tool("say", { avatar: "kai", text: "Broken", voice: "person" });
    assert.equal(broken.isError, true);
    assert.match(broken.content[0].text, new RegExp(`${c.svc.url}/say/o/broken\\.wav.*costs no characters`));

    const edited = await c.tool("edit_avatar", { avatar: "kai", change: "make the hair blue", save_as: "kai-blue" });
    assert.equal(edited.data.name, "kai-blue");
    assert.equal(edited.data.previousKey, KAI);

    assert.match((await c.tool("preview_link", { avatar: "../secrets.json" })).content[0].text, /name or id/);
    await mkdir(join(c.cwd, "clips"));
    assert.match((await c.tool("lines", { clip: "clips" })).content[0].text, /not a file; lines takes one clip/);
    assert.match((await c.tool("make_species_avatar", { species: "dash", name: "Bad Name" })).content[0].text, /not a name/);
    assert.ok(!c.svc.calls.some((x) => x.path === "/avatars" && x.body?.character), "a bad name is refused before the species is saved");
  } finally { await c.close(); }
});

test("mcp: an unsigned terminal answers every tool with an error naming minimoji login and calls nothing", async () => {
  const c = await client({}, { signedIn: false });
  try {
    await initialize(c);
    const args = { avatar: "kai", text: "Hi", species: "dash", clip: "hi.wav", description: "red curls" };
    for (const t of TOOLS) {
      const wanted = Object.fromEntries(Object.entries(args).filter(([k]) => k in t.inputSchema.properties));
      const r = await c.tool(t.name, wanted);
      assert.equal(r.isError, true, t.name);
      assert.match(r.content[0].text, /minimoji login/, t.name);
    }
    assert.ok(!c.svc.calls.some((x) => !x.path.startsWith("/repos/")), "no service call before signing in");
  } finally { await c.close(); }
});

test("mcp: a malformed frame answers a JSON-RPC error and the server carries on", async () => {
  const c = await client();
  try {
    await initialize(c);
    c.send("{this is not json");
    c.send("[1, 2]");
    c.send(JSON.stringify({ jsonrpc: "2.0", id: 99 }));
    assert.deepEqual((await c.request("ping")).result, {}, "still answering");
    assert.deepEqual(c.orphans.filter((m) => m.id === null).map((m) => m.error.code), [-32700, -32600], "parse error, then a batch refused");
    assert.equal(c.messages.find((m) => m.id === 99).error.code, -32600);
    assert.equal((await c.request("no/such")).error.code, -32601);
    assert.equal((await c.request("tools/call", { name: "nope" })).error.code, -32602);
    // a key is never an argument: an extra property is refused, not ignored
    const keyed = await c.tool("say", { avatar: "kai", text: "Hi", elevenlabs_key: "sk_x" });
    assert.equal(keyed.isError, true);
    assert.match(keyed.content[0].text, /takes no argument "elevenlabs_key"/);
    assert.match((await c.tool("make_avatar", { count: 4, description: "x" })).content[0].text, /count is at most 3/);
    assert.ok(!c.svc.calls.some((x) => x.path === "/lines/say" || x.path === "/avatars/generate"), "a refused call spends nothing");
  } finally { await c.close(); }
});

test("checkArgs: types, enums, ranges and unknown names", () => {
  const say = TOOLS.find((t) => t.name === "say");
  assert.deepEqual(checkArgs(say, { avatar: "kai", text: "hi", voice_source: "elevenlabs" }), { avatar: "kai", text: "hi", voice_source: "elevenlabs" });
  assert.throws(() => checkArgs(say, { avatar: "kai" }), /needs text/);
  assert.throws(() => checkArgs(say, { avatar: "kai", text: 3 }), /text must be a string/);
  assert.throws(() => checkArgs(say, { avatar: "kai", text: "hi", voice_source: "openai" }), /one of minimoji, elevenlabs/);
  const species = TOOLS.find((t) => t.name === "make_species_avatar");
  assert.throws(() => checkArgs(species, { species: "dash", picks: { eyes: 1 } }), /an object of strings/);
  assert.throws(() => checkArgs(TOOLS[0], []), /object of arguments/);
});
