import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROBOT, lettersFromCharacters, lineName, parseSettings, pcmFromS16, robot, wav, wordsFromCharacters } from "../src/voice.js";
import { fixtureServer, makeCtx, run, signIn, tempDir } from "./helpers.mjs";

const RACHEL = "21m00Tcm4TlvDq8ikWAM";
const BRIAN = "nPczCjzI2devNBz1zQrb";
const KAI = "a".repeat(64);
const DASH = "d".repeat(64);
const LOOSE = "c".repeat(64);
const SECRET = "sk_test_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const RATE = 24000;
// the repo's real bundle where it is beside the tests; the exported CLI has only the stand-in
const REAL = fileURLToPath(new URL("../../../apps/web/public/sdk/minimoji-heads.js", import.meta.url));
const BUNDLE = existsSync(REAL) ? REAL : fileURLToPath(new URL("./fixtures/line-builder.mjs", import.meta.url));

/** ElevenLabs' answer for `text`: a voiced tone, each character 60 ms from 0.1 s, as 16-bit PCM */
function speech(text) {
  const characters = [...text];
  const starts = characters.map((_, i) => +(0.1 + i * 0.06).toFixed(3));
  const ends = starts.map((s) => +(s + 0.06).toFixed(3));
  const n = Math.round((ends.at(-1) + 0.2) * RATE);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const voiced = t >= 0.1 && t <= ends.at(-1) ? 0.5 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * t)) : 0;
    pcm.writeInt16LE(Math.round(voiced * Math.sin(2 * Math.PI * 200 * t) * 32767), i * 2);
  }
  return { audio_base64: pcm.toString("base64"), alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: ends }, normalized_alignment: null };
}

/** our service (a library of one owner, shared by every terminal signed in to it), ElevenLabs and the site, on one fixture */
async function world({ bundle = BUNDLE, elevenStatus = 200 } = {}) {
  const library = new Map([
    ["kai", { name: "kai", avatarKey: KAI, kind: "person", createdAt: 1, updatedAt: 1, voice: "juniper", ttsVoice: null }],
    ["dash", { name: "dash", avatarKey: DASH, kind: "species", createdAt: 1, updatedAt: 1, voice: null, ttsVoice: null }],
  ]);
  const svc = await fixtureServer({
    "GET /cli/avatars": () => ({ json: { avatars: [...library.values()] } }),
    "POST /cli/avatars/voice": ({ body }) => {
      let entry = [...library.values()].find((e) => (body.name != null ? e.name === body.name : e.avatarKey === body.avatarKey));
      let added = false;
      if (!entry && body.avatarKey === LOOSE && body.ttsVoice) {
        entry = { name: "avatar", avatarKey: LOOSE, kind: "person", createdAt: 2, updatedAt: 2, voice: null, ttsVoice: null };
        library.set("avatar", entry);
        added = true;
      }
      if (!entry) return { status: 404, json: { error: "no avatar in your library" } };
      entry.ttsVoice = body.ttsVoice;
      return { json: { avatar: entry, ttsVoice: body.ttsVoice, added } };
    },
    "GET /avatars/*": (c) => c.path.includes(LOOSE) ? { status: 404, json: { error: "no avatar" } } : { json: c.path.includes(DASH) ? { character: { id: "dash" } } : { v: 2, seed: 1 } },
    "GET /v2/voices": () => ({ json: { voices: [{ voice_id: RACHEL, name: "Rachel", category: "premade" }, { voice_id: BRIAN, name: "Brian", category: "premade" }], has_more: false } }),
    "POST /v1/text-to-speech/*": ({ body }) => elevenStatus === 200 ? { json: speech(body.text) } : { status: elevenStatus, json: { detail: { status: "invalid_api_key", message: `Invalid API key: ${SECRET}` } } },
    "GET /sdk/minimoji-heads.js": async ({ headers }) => {
      if (bundle === null) return { status: 503, body: "down" };
      const etag = '"heads-1"';
      if (headers["if-none-match"] === etag) return { status: 304, headers: { ETag: etag } };
      return { body: await readFile(bundle), headers: { "Content-Type": "application/javascript", ETag: etag } };
    },
  });
  svc.library = library;
  svc.tts = () => svc.calls.filter((c) => c.path.startsWith("/v1/text-to-speech/"));
  svc.eleven = () => svc.calls.filter((c) => c.path.startsWith("/v1/") || c.path.startsWith("/v2/"));
  return svc;
}

/** a terminal signed in to the fixture, its ElevenLabs and its site pointed there too */
async function terminal(svc, env = {}) {
  const ctx = await makeCtx({ env: { MINIMOJI_API: svc.url, ...env } });
  ctx.elevenlabsAPI = svc.url;
  ctx.headsURL = `${svc.url}/sdk/minimoji-heads.js`;
  await signIn(ctx, svc.url);
  return ctx;
}

/** every file under a folder, as text */
async function filesUnder(dir) {
  const out = [];
  for (const name of await readdir(dir, { recursive: true }).catch(() => [])) {
    const path = join(dir, name);
    if ((await stat(path)).isFile()) out.push([path, await readFile(path, "latin1")]);
  }
  return out;
}

test("voice: set on kai's library entry, read back from another terminal of the same owner, with the app persona beside it", async () => {
  const svc = await world();
  try {
    const one = await terminal(svc);
    const set = await run(one, ["voice", "kai", RACHEL, "--json"]);
    assert.equal(set.code, 0, set.stderr);
    assert.deepEqual(set.json.ttsVoice, { provider: "elevenlabs", voiceId: RACHEL, effect: "none" });
    assert.deepEqual(svc.calls.find((c) => c.path === "/cli/avatars/voice").body, { name: "kai", ttsVoice: { provider: "elevenlabs", voiceId: RACHEL, effect: "none" } }, "the CLI writes ttsVoice, never voice");
    assert.equal(svc.eleven().length, 0, "an id needs no ElevenLabs call (and no key)");

    const two = await terminal(svc);
    const read = await run(two, ["voice", "kai"]);
    assert.equal(read.code, 0, read.stderr);
    assert.match(read.stdout, new RegExp(`kai: ${RACHEL}`));
    assert.match(read.stdout, /app voice: juniper/, "the Minimoji app's persona shows too, so two voices never puzzle anyone");
    assert.equal(svc.library.get("kai").voice, "juniper");

    const robotic = await run(two, ["voice", "kai", RACHEL, "--effect", "robot", "--settings", "stability=0.4,speed=1.1", "--json"]);
    assert.deepEqual(robotic.json.ttsVoice, { provider: "elevenlabs", voiceId: RACHEL, effect: "robot", settings: { stability: 0.4, speed: 1.1 } });
    assert.equal((await run(two, ["voice", "kai", "--clear", "--json"])).json.ttsVoice, null);
    assert.equal(svc.library.get("kai").ttsVoice, null);
  } finally { await svc.close(); }
});

test("voice: --list and a voice by name use the key, straight from ElevenLabs; without a key a name says so", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    const list = await run(ctx, ["voice", "--list"]);
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /Rachel\s+21m00Tcm4TlvDq8ikWAM\s+premade/);
    const listed = svc.calls.find((c) => c.path === "/v2/voices");
    assert.equal(listed.headers["xi-api-key"], SECRET, "the key goes to ElevenLabs as xi-api-key");
    const named = await run(ctx, ["voice", "dash", "brian", "--effect", "robot", "--json"]);
    assert.equal(named.code, 0, named.stderr);
    assert.equal(named.json.ttsVoice.voiceId, BRIAN);
    assert.ok(!list.stdout.includes(SECRET) && !named.stdout.includes(SECRET));

    const keyless = await terminal(svc);
    const refused = await run(keyless, ["voice", "kai", "Rachel"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /needs ELEVENLABS_API_KEY; or pass its id/);
    assert.equal((await run(keyless, ["voice", "--list"])).code, 1);
  } finally { await svc.close(); }
});

test("voice: a key not yet in the library is kept first; with no voice, a suggestion for the species", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc);
    const added = await run(ctx, ["voice", LOOSE, RACHEL]);
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stdout, /Kept cccccccccccc as avatar and gave it/);
    assert.deepEqual(svc.calls.find((c) => c.path === "/cli/avatars/voice").body.avatarKey, LOOSE);
    const dash = await run(ctx, ["voice", "dash", "--json"]);
    assert.deepEqual(dash.json.suggestion, { name: "Brian", voiceId: BRIAN, effect: "robot" });
  } finally { await svc.close(); }
});

test("say: one TTS request, a line that passes validateLine, a WAV as long as the line, words that match the text, [excited] a mood not a caption", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    await run(ctx, ["voice", "kai", RACHEL]);
    const said = await run(ctx, ["say", "kai", "[excited] Hi, I'm Billie", "--out", "lines", "--json"]);
    assert.equal(said.code, 0, said.stderr);
    assert.equal(svc.tts().length, 1, "one paid call");
    const call = svc.tts()[0];
    assert.equal(call.path, `/v1/text-to-speech/${RACHEL}/with-timestamps`);
    assert.equal(call.search, "?output_format=pcm_24000");
    assert.deepEqual(call.body, { text: "[excited] Hi, I'm Billie", model_id: "eleven_v4" });
    assert.deepEqual(said.json, { line: join(ctx.cwd, "lines/hi-i-m-billie.json"), audio: join(ctx.cwd, "lines/hi-i-m-billie.wav"), duration: said.json.duration, play: null, playNote: said.json.playNote });
    assert.match(said.json.playNote, /say --server keeps it at Minimoji/, "a line kept only here has no play link, and says how to get one");

    const { validateLine, buildLine } = await import(BUNDLE);
    const line = validateLine(JSON.parse(await readFile(said.json.line, "utf8")));
    // the mouth is shaped from the reply's timed letters, not the waveform alone
    const reply = speech(call.body.text), pcm = pcmFromS16((await readFile(said.json.audio)).subarray(44));
    assert.deepEqual(line.frames, buildLine({ pcm, sampleRate: RATE, words: wordsFromCharacters(reply.alignment), letters: lettersFromCharacters(reply.alignment) }).frames);
    assert.deepEqual(line.words.map((w) => w.text), ["Hi,", "I'm", "Billie"], "the words match the text, the tag gone");
    assert.ok(line.captions.every((c) => !c.text.includes("[")), "the tag is dropped from the captions");
    assert.equal(line.captions.map((c) => c.text).join(" "), "Hi, I'm Billie");
    assert.ok(line.cues.some((c) => c.mood === "joy"), "[excited] sets the mood");

    const audio = await readFile(said.json.audio);
    assert.equal(audio.toString("ascii", 0, 4), "RIFF");
    assert.equal(audio.readUInt32LE(24), RATE);
    const seconds = audio.readUInt32LE(40) / 2 / RATE;
    assert.ok(Math.abs(seconds - line.duration) < 1 / 60, `the audio (${seconds} s) is as long as the line (${line.duration} s)`);
    assert.match((await run(ctx, ["say", "kai", "Hello there", "--out", "lines"])).stdout, /hello-there\.json\n {2}and .*hello-there\.wav \(\d+\.\d\d s\)/);
  } finally { await svc.close(); }
});

test("say: --voice wins over the entry's, --mood sets the start face, --name names the files, --effect robot changes the samples", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    const plain = await run(ctx, ["say", "kai", "Hello", "--voice", BRIAN, "--mood", "happy", "--name", "hello", "--json"]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(svc.tts()[0].path, new RegExp(BRIAN));
    assert.equal(plain.json.line, join(ctx.cwd, "minimoji-lines/hello.json"), "the default folder");
    const line = JSON.parse(await readFile(plain.json.line, "utf8"));
    assert.deepEqual(line.cues.find((c) => c.at === 0)?.mood, "happy");
    const robotic = await run(ctx, ["say", "kai", "Hello", "--voice", BRIAN, "--effect", "robot", "--name", "hello-robot", "--json"]);
    const [a, b] = await Promise.all([readFile(plain.json.audio), readFile(robotic.json.audio)]);
    assert.equal(a.length, b.length, "same length: no tempo change");
    assert.ok(!a.equals(b), "the robot changes the samples");
    const paid = svc.tts().length;
    const bad = await run(ctx, ["say", "kai", "Hello", "--voice", BRIAN, "--mood", "elated"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /"elated" is not a mood the line format knows/);
    assert.equal(svc.tts().length, paid, "a bad mood is refused before the paid call");
  } finally { await svc.close(); }
});

test("say: the entry's stored effect and settings are used with no flags, and a flag overrides them for one line", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    await run(ctx, ["voice", "dash", BRIAN, "--effect", "robot", "--settings", "stability=0.4"]);
    const stored = await run(ctx, ["say", "dash", "Greetings", "--name", "stored", "--json"]);
    assert.equal(stored.code, 0, stored.stderr);
    assert.deepEqual(svc.tts()[0].body, { text: "Greetings", model_id: "eleven_v4", voice_settings: { stability: 0.4 } }, "the stored settings reach ElevenLabs");
    assert.match(svc.tts()[0].path, new RegExp(BRIAN));
    const plain = await run(ctx, ["say", "dash", "Greetings", "--name", "plain", "--effect", "none", "--json"]);
    const [robotic, clean] = await Promise.all([readFile(stored.json.audio), readFile(plain.json.audio)]);
    assert.ok(!robotic.equals(clean), "the stored robot effect ran; --effect none skips it");
  } finally { await svc.close(); }
});

test("say: no voice anywhere is an error that suggests minimoji voice; too much text is refused before anything is sent", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    const none = await run(ctx, ["say", "kai", "Hello"]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /kai has no voice yet; minimoji voice kai <voice> sets one/);
    const long = await run(ctx, ["say", "kai", "a".repeat(1001), "--voice", RACHEL]);
    assert.equal(long.code, 1);
    assert.match(long.stderr, /1001 characters; say takes at most 1000/);
    assert.equal(svc.eleven().length, 0);
  } finally { await svc.close(); }
});

test("say: with no ElevenLabs key, one line, exit 1, no request; --dry-run sends nothing", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc);
    await run(ctx, ["voice", "kai", RACHEL]);
    const before = svc.calls.length;
    const keyless = await run(ctx, ["say", "kai", "Hello"]);
    assert.equal(keyless.code, 1);
    assert.equal(keyless.stderr.trim().split("\n").length, 1);
    assert.match(keyless.stderr, /no ElevenLabs key: export ELEVENLABS_API_KEY/);
    assert.equal(svc.eleven().length, 0, "no ElevenLabs request");
    assert.ok(svc.calls.slice(before).every((c) => c.path === "/cli/avatars"), "only the library was read");

    const keyed = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    const dry = await run(keyed, ["say", "kai", "[excited] Hi there", "--dry-run", "--json"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.deepEqual({ ...dry.json, out: undefined }, { dryRun: true, voice: RACHEL, effect: "none", model: "eleven_v4", text: "[excited] Hi there", characters: 18, out: undefined });
    assert.equal(svc.eleven().length, 0, "dry run: nothing sent to ElevenLabs");
    assert.ok(!svc.calls.some((c) => c.path.startsWith("/sdk/")), "nor the bundle fetched");
    assert.equal(existsSync(join(keyed.cwd, "minimoji-lines")), false, "nor anything written");
  } finally { await svc.close(); }
});

test("the ElevenLabs key never appears in stdout, stderr, files, --json, or anything sent to our service", async () => {
  const svc = await world();
  const bad = await world({ elevenStatus: 401 });
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    const outputs = [];
    for (const argv of [["voice", "kai", "Rachel", "--json"], ["voice", "kai"], ["voice", "--list", "--json"], ["say", "kai", "Hello", "--json"], ["say", "kai", "Hi", "--elevenlabs-key", SECRET, "--name", "x"], ["say", "kai", "Hi", "--dry-run", "--json"]]) {
      const r = await run(ctx, argv);
      assert.equal(r.code, 0, `${argv.join(" ")}: ${r.stderr}`);
      outputs.push(r.stdout, r.stderr);
    }
    const flagged = await terminal(bad);
    await signIn(flagged, bad.url);
    bad.library.get("kai").ttsVoice = { provider: "elevenlabs", voiceId: RACHEL, effect: "none" };
    const refused = await run(flagged, ["say", "kai", "Hello", "--elevenlabs-key", SECRET, "--json"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /ElevenLabs POST \/v1\/text-to-speech\/.* failed \(401\): Invalid API key: \[key\]; check ELEVENLABS_API_KEY/, "an error that echoes the key is scrubbed");
    outputs.push(refused.stdout, refused.stderr);

    for (const text of outputs) assert.ok(!text.includes(SECRET), `the key leaked into: ${text.slice(0, 120)}`);
    const files = [...await filesUnder(ctx.cwd), ...await filesUnder(ctx.home), ...await filesUnder(flagged.cwd), ...await filesUnder(flagged.home)];
    assert.ok(files.length >= 4, "the line, the audio, the credentials and the cached bundle were all checked");
    for (const [path, text] of files) assert.ok(!text.includes(SECRET), `the key leaked into ${path}`);
    for (const c of [...svc.calls, ...bad.calls].filter((c) => !c.path.startsWith("/v1/") && !c.path.startsWith("/v2/")))
      assert.ok(!JSON.stringify(c.headers).includes(SECRET) && !c.raw.includes(SECRET) && !c.search.includes(SECRET), `the key went to our service: ${c.method} ${c.path}`);
  } finally { await svc.close(); await bad.close(); }
});

test("the line builder: downloaded once, revalidated by ETag, works offline from the cache; a missing or broken one is one error before any paid call", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    await run(ctx, ["voice", "kai", RACHEL]);
    assert.equal((await run(ctx, ["say", "kai", "One"])).code, 0);
    assert.equal((await run(ctx, ["say", "kai", "Two"])).code, 0);
    const fetches = svc.calls.filter((c) => c.path === "/sdk/minimoji-heads.js");
    assert.equal(fetches.length, 2);
    assert.equal(fetches[1].headers["if-none-match"], '"heads-1"', "the second run asks only whether it changed");
    const cached = (await readdir(join(ctx.home, ".cache/minimoji"))).filter((n) => n.endsWith(".mjs"));
    assert.equal(cached.length, 1);
    assert.match(cached[0], /^heads-[0-9a-f]{64}\.mjs$/);
  } finally { await svc.close(); }

  const offline = await world({ bundle: null });
  try {
    const fresh = await terminal(offline, { ELEVENLABS_API_KEY: SECRET });
    await run(fresh, ["voice", "kai", RACHEL]);
    const down = await run(fresh, ["say", "kai", "Hello"]);
    assert.equal(down.code, 1);
    assert.match(down.stderr, /could not download the line builder from .*say needs it once, then works offline/);
    assert.equal(offline.tts().length, 0, "no paid call without a builder");
    assert.equal(existsSync(join(fresh.cwd, "minimoji-lines")), false, "no half-written line");

    // a terminal that has the bundle from before keeps working while the site is down
    const cache = join(fresh.home, ".cache/minimoji");
    await mkdir(cache, { recursive: true });
    const { createHash } = await import("node:crypto");
    const bytes = await readFile(BUNDLE);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(cache, `heads-${sha256}.mjs`), bytes);
    await writeFile(join(cache, "heads.json"), JSON.stringify({ url: fresh.headsURL, etag: '"old"', sha256 }));
    assert.equal((await run(fresh, ["say", "kai", "Hello"])).code, 0, "offline from the cache");
  } finally { await offline.close(); }

  for (const [file, source, why] of [["broken.mjs", "export const buildLine = (", /did not load .*update the CLI/], ["reshaped.mjs", "export const makeLine = () => ({});\nexport const LINE_VERSION = 2;", /is not the one this CLI knows .*update the CLI \(npx minimoji@latest/]]) {
    const path = join(await tempDir(), file);
    await writeFile(path, source);
    const odd = await world({ bundle: path });
    try {
      const ctx = await terminal(odd, { ELEVENLABS_API_KEY: SECRET });
      await run(ctx, ["voice", "kai", RACHEL]);
      const r = await run(ctx, ["say", "kai", "Hello"]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, why);
      assert.equal(r.stderr.trim().split("\n").length, 1);
      assert.equal(odd.tts().length, 0, `${file}: no paid call`);
    } finally { await odd.close(); }
  }
});

test("refusals that cost nothing or keep what was paid for: a key in the voice slot, odd settings, an unwritable cache, an over-long line", async () => {
  const svc = await world();
  try {
    const ctx = await terminal(svc, { ELEVENLABS_API_KEY: SECRET });
    for (const given of [SECRET, "sk_somebody_elses_key"]) {
      const r = await run(ctx, ["voice", "kai", given]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /looks like an ElevenLabs API key, not a voice/);
      assert.ok(!r.stderr.includes(given), "the pasted key is not echoed");
    }
    assert.equal(svc.eleven().length, 0, "nor sent as a search");
    for (const pair of ["constructor=1", "toString=0.5", "__proto__=1"]) assert.equal((await run(ctx, ["voice", "kai", RACHEL, "--settings", pair])).code, 1, pair);

    // the readout survives a suggestion that can't be fetched
    svc.library.get("kai").avatarKey = LOOSE;
    const read = await run(ctx, ["voice", "kai", "--json"]);
    assert.equal(read.code, 0, read.stderr);
    assert.equal(read.json.suggestion, undefined);

    // a cache folder that can't be written is named, not blamed on the network
    const locked = await terminal(svc, { ELEVENLABS_API_KEY: SECRET, XDG_CACHE_HOME: join(ctx.cwd, "file-not-dir") });
    await writeFile(join(ctx.cwd, "file-not-dir"), "");
    await run(locked, ["voice", "kai", RACHEL]);
    const r = await run(locked, ["say", "kai", "Hello"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /could not cache it in .*file-not-dir/);
    assert.doesNotMatch(r.stderr, /could not download/);

    // over 60 s: ElevenLabs was paid, so the audio is kept, and no line pretends to be one
    const long = await run(ctx, ["say", "kai", "a ".repeat(500), "--name", "long"]);
    assert.equal(long.code, 1);
    assert.match(long.stderr, /came to 60\.\d s and a line is at most 60 s; the audio is kept at .*long\.wav/);
    assert.ok(existsSync(join(ctx.cwd, "minimoji-lines/long.too-long.wav")));
    assert.equal(existsSync(join(ctx.cwd, "minimoji-lines/long.wav")), false, "never beside an older line of that name");
    assert.equal(existsSync(join(ctx.cwd, "minimoji-lines/long.json")), false);
    assert.deepEqual((await readdir(join(ctx.cwd, "minimoji-lines"))).filter((n) => n.endsWith(".tmp")), [], "no temp files left behind");
  } finally { await svc.close(); }
});

test("the robot effect: a 45 Hz tremolo of the set depth, the pitch unchanged", () => {
  const n = RATE; // one second of a steady 220 Hz tone
  const tone = new Float32Array(n).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 220 * (i / RATE)));
  const out = robot(tone, RATE, { ...ROBOT, echo: 0 });
  // the envelope: the peak of each 220 Hz cycle
  const period = RATE / 220, peaks = [];
  for (let c = 0; c + period < n; c += period) {
    let peak = 0;
    for (let i = Math.floor(c); i < c + period; i++) peak = Math.max(peak, Math.abs(out[i]));
    peaks.push(peak / 0.5);
  }
  const lo = Math.min(...peaks), hi = Math.max(...peaks);
  assert.ok(Math.abs(hi - 1) < 0.01 && Math.abs(lo - (1 - ROBOT.depth)) < 0.02, `the gain swings from ${lo.toFixed(3)} to ${hi.toFixed(3)}`);
  // the envelope's own rate: its cycles in one second
  const mid = (hi + lo) / 2;
  let rises = 0;
  for (let i = 1; i < peaks.length; i++) if (peaks[i - 1] < mid && peaks[i] >= mid) rises++;
  assert.ok(Math.abs(rises - 45) <= 1, `${rises} tremolo cycles a second`);
  // the pitch: the same zero crossings as the tone
  const crossings = (x) => { let k = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) k++; return k; };
  assert.ok(Math.abs(crossings(out) - crossings(tone)) <= 2, "no pitch change");
  const echoed = robot(tone, RATE);
  assert.equal(echoed.length, tone.length, "no tempo change");
  assert.ok(echoed.every((x) => x >= -1 && x <= 1));
});

test("audio and words: PCM in, WAV out; character timestamps to words, a tag kept whole in its word", () => {
  const bytes = Buffer.alloc(8);
  [0, 16384, -32768, 32767].forEach((s, i) => bytes.writeInt16LE(s, i * 2));
  assert.deepEqual([...pcmFromS16(bytes)], [0, 0.5, -1, 32767 / 32768]);
  const file = wav(new Float32Array([0, 0.5, -1]), RATE);
  assert.equal(file.length, 44 + 6);
  assert.equal(file.toString("ascii", 8, 12), "WAVE");
  const text = "[excited] Hi, Bo";
  const chars = [...text];
  const words = wordsFromCharacters({ characters: chars, character_start_times_seconds: chars.map((_, i) => i / 10), character_end_times_seconds: chars.map((_, i) => (i + 1) / 10) });
  assert.deepEqual(words, [{ text: "[excited]", start: 0, end: 0.9 }, { text: "Hi,", start: 1, end: 1.3 }, { text: "Bo", start: 1.4, end: 1.6 }]);
  assert.deepEqual(wordsFromCharacters({ characters: [..."[soft whisper] ok"], character_start_times_seconds: Array(17).fill(0), character_end_times_seconds: Array(17).fill(0) }).map((w) => w.text), ["[soft whisper]", "ok"], "a tag with a space stays one word");
  assert.deepEqual(lettersFromCharacters({ characters: chars, character_start_times_seconds: chars.map((_, i) => i / 10), character_end_times_seconds: chars.map((_, i) => (i + 1) / 10) }).map((l) => l.text).join(""), " Hi, Bo", "a tag is not spoken; spaces part the words");
  assert.deepEqual(lettersFromCharacters({ characters: ["m"], character_start_times_seconds: [0.1], character_end_times_seconds: [0.2] }), [{ text: "m", start: 0.1, end: 0.2 }]);
  assert.equal(lineName("[excited] Hi, I'm Billie!"), "hi-i-m-billie");
  assert.equal(lineName("[sighs]"), "line");
  assert.deepEqual(parseSettings(["stability=0.4", "speed=1.1,use_speaker_boost=false"]), { stability: 0.4, speed: 1.1, use_speaker_boost: false });
  for (const bad of [["stability=2"], ["volume=1"], ["speed="], ["use_speaker_boost=yes"]]) assert.throws(() => parseSettings(bad), /--settings/);
});

test("say --server: POST /lines/say on the Minimoji key, the same <name>.wav + <name>.json as the local path, no ElevenLabs call and never the ElevenLabs key", async () => {
  const { buildLine, validateLine } = await import(BUNDLE);
  const wavBytes = wav(new Float32Array(RATE / 2).fill(0.1), RATE);
  const said = [];
  let origin = null;
  const answer = (body) => {
    const tts = speech(body.text);
    const line = buildLine({ pcm: pcmFromS16(Buffer.from(tts.audio_base64, "base64")), sampleRate: RATE, words: wordsFromCharacters(tts.alignment), letters: lettersFromCharacters(tts.alignment) });
    return { audio: `${origin}/say/owner/abc.wav`, format: "wav", durationMs: Math.round(line.duration * 1000), line, words: [], letters: [], transcript: body.text, chars: body.text.length, charged: body.text.length, cached: false, voice: { name: null, voiceId: RACHEL, effect: "none" } };
  };
  const server = await fixtureServer({
    "GET /cli/avatars": () => ({ json: { avatars: [{ name: "kai", avatarKey: KAI, kind: "person", createdAt: 1, updatedAt: 1, ttsVoice: { provider: "elevenlabs", voiceId: RACHEL, effect: "robot" } }] } }),
    "POST /lines/say": ({ body, auth }) => { said.push({ body, auth }); return { json: answer(body) }; },
    "GET /say/*": () => ({ body: wavBytes, headers: { "Content-Type": "audio/wav" } }),
  });
  origin = server.url;
  try {
    const ctx = await makeCtx({ env: { MINIMOJI_API: server.url, MINIMOJI_KEY: "mk_sec_" + "1".repeat(40), ELEVENLABS_API_KEY: SECRET } });
    ctx.elevenlabsAPI = server.url;
    await signIn(ctx, server.url);
    const r = await run(ctx, ["say", "kai", "Hello there", "--server", "--out", "lines", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(said[0].body, { text: "Hello there", voice: { voiceId: RACHEL, effect: "robot" }, model: "eleven_v4" }, "the entry's voice, its effect too");
    assert.equal(said[0].auth, `Bearer mk_sec_${"1".repeat(40)}`, "on the Minimoji key");
    assert.equal(r.json.line, join(ctx.cwd, "lines", "hello-there.json"));
    assert.equal(r.json.audio, join(ctx.cwd, "lines", "hello-there.wav"));
    assert.deepEqual(await readFile(r.json.audio), wavBytes, "the audio the service answered, byte for byte");
    validateLine(JSON.parse(await readFile(r.json.line, "utf8")));
    assert.ok(!server.calls.some((c) => c.path.startsWith("/v1/") || c.path.startsWith("/v2/")), "no ElevenLabs call");
    assert.ok(server.calls.every((c) => !c.raw.includes(SECRET) && !JSON.stringify(c.headers).includes(SECRET)), "the ElevenLabs key never reaches our service");
    const named = await run(ctx, ["say", "kai", "Beep", "--server", "--voice", "dash", "--name", "beep", "--json"]);
    assert.equal(named.code, 0, named.stderr);
    assert.equal(said[1].body.voice, "dash", "a catalogue name goes as a name");
    const dry = await run(ctx, ["say", "kai", "Hi", "--server", "--dry-run", "--json"]);
    assert.equal(dry.json.dryRun, true);
    assert.equal(said.length, 2, "--dry-run sends nothing");
    const mixed = await run(ctx, ["say", "kai", "Hi", "--server", "--elevenlabs-key", SECRET]);
    assert.equal(mixed.code, 1);
    assert.match(mixed.stderr, /--server speaks on Minimoji's voice.*drop one of them/);
    assert.ok(!mixed.stderr.includes(SECRET));
    const bad = await run(ctx, ["say", "kai", "Hi", "--server", "--voice", "Rachel Green"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--server takes a voice id or a name from GET \/lines\/voices/);
  } finally { await server.close(); }
});

test("say --server answers play: the preview page speaking the kept line, by key where the site reads it, else by document; never a failed say", async () => {
  const { buildLine } = await import(BUNDLE);
  const LINE_ID = `${"c".repeat(32)}/${"d".repeat(64)}-${"e".repeat(16)}`;
  let origin = null, audioPath = `/say/${LINE_ID}.wav`;
  const answer = (body) => {
    const tts = speech(body.text);
    const line = buildLine({ pcm: pcmFromS16(Buffer.from(tts.audio_base64, "base64")), sampleRate: RATE, words: wordsFromCharacters(tts.alignment), letters: lettersFromCharacters(tts.alignment) });
    return { audio: `${origin}${audioPath}`, format: "wav", durationMs: Math.round(line.duration * 1000), line, words: [], letters: [], transcript: body.text, chars: body.text.length, charged: 0, cached: true, voice: { name: null, voiceId: RACHEL, effect: "none" } };
  };
  const doc = { v: 1, hair: "red curls" };
  const server = await fixtureServer({
    "GET /cli/avatars": () => ({ json: { avatars: [{ name: "kai", avatarKey: KAI, kind: "person", createdAt: 1, updatedAt: 1, ttsVoice: { provider: "elevenlabs", voiceId: RACHEL, effect: "none" } }] } }),
    "POST /lines/say": ({ body }) => ({ json: answer(body) }),
    "GET /say/*": () => ({ body: wav(new Float32Array(RATE / 2), RATE), headers: { "Content-Type": "audio/wav" } }),
    [`GET /avatars/${KAI}.json`]: () => ({ json: doc }),
  });
  origin = server.url;
  try {
    const env = { MINIMOJI_API: server.url, MINIMOJI_KEY: "mk_sec_" + "1".repeat(40) };
    const ctx = await makeCtx({ env: { ...env, MINIMOJI_SITE: "https://www.minimoji.com" } });
    await signIn(ctx, server.url);
    const r = await run(ctx, ["say", "kai", "Hello from space", "--server", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.play, `https://www.minimoji.com/preview/${KAI}?line=${LINE_ID}`, "the key in the path, the line's id with its slash");
    assert.equal(r.json.playNote, undefined);
    const text = await run(ctx, ["say", "kai", "Hello from space", "--server"]);
    assert.match(text.stdout, new RegExp(`Play it: https://www\\.minimoji\\.com/preview/${KAI}\\?line=${LINE_ID}`));
    // --voice skips the entry's voice, and the avatar's key is still read from the library
    const voiced = await run(ctx, ["say", "kai", "Beep", "--server", "--voice", "dash", "--json"]);
    assert.equal(voiced.json.play, `https://www.minimoji.com/preview/${KAI}?line=${LINE_ID}`);

    // a deployment the site doesn't read keys from: the document rides the fragment, the line the query
    const dev = await makeCtx({ env });
    await signIn(dev, server.url);
    const fragment = await run(dev, ["say", KAI, "Hi", "--server", "--voice", "dash", "--json"]);
    const url = new URL(fragment.json.play);
    assert.equal(url.pathname, "/preview");
    assert.equal(url.searchParams.get("line"), LINE_ID);
    assert.deepEqual(JSON.parse(Buffer.from(url.hash.slice("#doc=".length), "base64url").toString()), doc);

    // the service kept it somewhere else: the say still answers, with a note in place of the link
    audioPath = "/say/o/hi.wav";
    const elsewhere = await run(ctx, ["say", "kai", "Hi", "--server", "--json"]);
    assert.equal(elsewhere.code, 0, elsewhere.stderr);
    assert.equal(elsewhere.json.play, null);
    assert.match(elsewhere.json.playNote, /does not read/);
    // an avatar the library doesn't have: kept and answered, the link says why it's missing
    audioPath = `/say/${LINE_ID}.wav`;
    const stranger = await run(ctx, ["say", "nobody", "Hi", "--server", "--voice", "dash", "--json"]);
    assert.equal(stranger.code, 0, stranger.stderr);
    assert.equal(stranger.json.play, null);
    assert.match(stranger.json.playNote, /the link could not be made/);
  } finally { await server.close(); }
});

// ─── say --texts: a presenter deck ─────────────────────────────────────────

const MK = "mk_sec_" + "k".repeat(40);
const SIX = ["Hi, I'm Dash.", "Save anything you love.", "I file it in the right pile.", "All of it is open to your assistants.", "Swipe through them to react.", "A passport for your taste."];
const deckOf = (says, extra = {}) => ({ voice: { provider: "elevenlabs", voiceId: RACHEL, model: "eleven_v4" }, holdMs: 250, slides: says.map((say, n) => ({ id: `s${n}`, say, mood: n === 5 ? "joy" : "happy" })), ...extra });

/** ElevenLabs, POST /lines and the site on one fixture, with a fake clock the CLI's sleeps advance; `lines` is
 *  the answers to POST /lines in order (the last repeats), a status for a refusal */
async function deckWorld({ lines = [200], elevenStatus = 200 } = {}) {
  const clock = { now: 1_000_000 }, slept = [], log = [];
  let n = 0;
  const svc = await fixtureServer({
    "POST /v1/text-to-speech/*": ({ body }) => {
      log.push({ what: "tts", text: body.text, at: clock.now });
      return elevenStatus === 200 ? { json: speech(body.text) } : { status: elevenStatus, json: { detail: { message: `Invalid API key: ${SECRET}` } } };
    },
    "POST /lines": async ({ bytes, headers, auth, search }) => {
      const form = await new Response(bytes, { headers: { "content-type": headers["content-type"] } }).formData();
      const answer = lines[Math.min(n++, lines.length - 1)];
      log.push({ what: "lines", text: form.get("text"), mood: new URLSearchParams(search).get("mood"), auth, at: clock.now, status: answer.status ?? 200 });
      if (answer.status) return { status: answer.status, json: { error: "rate limit for lines reached", retryAfterMs: answer.retryAfterMs } };
      return { json: { line: { version: 1, fps: 60, duration: 1, frames: [], captions: [{ text: form.get("text"), start: 0, end: 1 }], words: [], cues: [], aligned: true }, words: [{ text: "x", start: 0, end: 1 }], letters: [], transcript: form.get("text"), alignedTo: "text" } };
    },
    "GET /sdk/minimoji-heads.js": async () => ({ body: await readFile(BUNDLE), headers: { "Content-Type": "application/javascript" } }),
  });
  const ctx = await makeCtx({ env: { MINIMOJI_API: svc.url, ELEVENLABS_API_KEY: SECRET, MINIMOJI_KEY: MK } });
  Object.assign(ctx, { elevenlabsAPI: svc.url, headsURL: `${svc.url}/sdk/minimoji-heads.js`, now: () => clock.now, sleep: async (ms) => { slept.push(ms); clock.now += ms; } });
  const writeDeck = (deck) => writeFile(join(ctx.cwd, "slides.json"), JSON.stringify(deck));
  return { svc, ctx, log, slept, writeDeck };
}

test("say --texts: a 6-slide deck is said and re-timed slide by slide, /lines at least 3 s apart, the files and the manifest written", async () => {
  const { svc, ctx, log, writeDeck } = await deckWorld();
  try {
    await writeDeck(deckOf(SIX));
    const r = await run(ctx, ["say", "--texts", "slides.json", "--out", "lines", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(log.map((c) => `${c.what}:${c.text}`), SIX.flatMap((say) => [`tts:${say}`, `lines:${say}`]), "one TTS then one /lines per slide, in order");
    const at = log.filter((c) => c.what === "lines").map((c) => c.at);
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 3000, `/lines calls ${i - 1}→${i} were ${at[i] - at[i - 1]} ms apart`);
    assert.ok(log.filter((c) => c.what === "lines").every((c) => c.auth === `Bearer ${MK}` && (c.mood === "happy" || c.mood === "joy")), "re-timed on the Minimoji key, with the slide's mood");
    const dir = join(ctx.cwd, "lines");
    for (let i = 0; i < 6; i++) {
      assert.ok(existsSync(join(dir, `slide${i}.wav`)), `slide${i}.wav`);
      assert.equal(JSON.parse(await readFile(join(dir, `slide${i}.json`), "utf8")).aligned, true, "the line on disk is the re-timed one");
    }
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.lines.slide0, { textSha256: createHash("sha256").update(SIX[0]).digest("hex"), voice: RACHEL, model: "eleven_v4", mood: "happy", effect: "none", retimed: true });
    assert.deepEqual(r.json.lines.map((l) => l.status), Array(6).fill("written"));
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  } finally { await svc.close(); }
});

test("say --texts: a short 429 on /lines waits its retryAfterMs and retries the same clip", async () => {
  const { svc, ctx, log, slept, writeDeck } = await deckWorld({ lines: [{}, { status: 429, retryAfterMs: 4000 }, {}] });
  try {
    await writeDeck(deckOf(SIX));
    const r = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const calls = log.filter((c) => c.what === "lines");
    assert.equal(calls.length, 7);
    assert.deepEqual([calls[1].text, calls[1].status, calls[2].text, calls[2].status], [SIX[1], 429, SIX[1], 200], "the same clip, sent again");
    assert.ok(slept.includes(4000), "waited the 4 s the 429 asked for");
    assert.ok(calls[2].at - calls[1].at >= 4000);
    assert.deepEqual(r.json.lines.map((l) => l.status), Array(6).fill("written"));
  } finally { await svc.close(); }
});

test("say --texts: a day-long 429 stops the run and says what was written; re-run, only what is left is sent", async () => {
  const { svc, ctx, log, writeDeck } = await deckWorld({ lines: [{}, {}, { status: 429, retryAfterMs: 3_600_000 }, {}] });
  try {
    await writeDeck(deckOf(SIX));
    const r = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.json.lines.map((l) => l.status), ["written", "written", "not re-timed", "not sent", "not sent", "not sent"]);
    assert.match(r.json.stopped, /429/);
    assert.match(r.stderr, /rate limit for lines reached/);
    assert.equal(log.filter((c) => c.what === "tts").length, 3, "nothing said after the stop");
    log.length = 0;
    const again = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(log.map((c) => `${c.what}:${c.text}`), [`lines:${SIX[2]}`, ...SIX.slice(3).flatMap((say) => [`tts:${say}`, `lines:${say}`])], "slide 2 only re-timed, not said again");
  } finally { await svc.close(); }
});

test("say --texts: unchanged, nothing is sent; one say edited, exactly one TTS and one /lines", async () => {
  const { svc, ctx, log, writeDeck } = await deckWorld();
  try {
    await writeDeck(deckOf(SIX));
    assert.equal((await run(ctx, ["say", "--texts", "slides.json"])).code, 0);
    log.length = 0;
    const same = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(same.code, 0, same.stderr);
    assert.equal(log.length, 0);
    assert.deepEqual(same.json.lines.map((l) => l.status), Array(6).fill("unchanged"));
    const edited = [...SIX]; edited[3] = "All of it is open to every assistant you use.";
    await writeDeck(deckOf(edited));
    const one = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(one.code, 0, one.stderr);
    assert.deepEqual(log.map((c) => `${c.what}:${c.text}`), [`tts:${edited[3]}`, `lines:${edited[3]}`]);
    const dry = await run(ctx, ["say", "--texts", "slides.json", "--voice", BRIAN, "--dry-run", "--json"]);
    assert.equal(dry.json.lines.filter((l) => l.status === "would say and re-time").length, 6, "another voice is another line");
    assert.equal(log.length, 2, "a dry run sends nothing");
    const tuned = await run(ctx, ["say", "--texts", "slides.json", "--settings", "stability=0.4", "--dry-run", "--json"]);
    assert.equal(tuned.json.lines.filter((l) => l.status === "would say and re-time").length, 6, "other voice settings are other audio");
    const server = await run(ctx, ["say", "--texts", "slides.json", "--server", "--dry-run", "--json"]);
    assert.equal(server.json.lines.filter((l) => l.status === "would say and re-time").length, 6, "Minimoji's voice is not the same audio as your key's");
  } finally { await svc.close(); }
});

test("say --texts --no-retime: no /lines call; a later full run only re-times", async () => {
  const { svc, ctx, log, writeDeck } = await deckWorld();
  try {
    await writeDeck(deckOf(SIX.slice(0, 2)));
    const r = await run(ctx, ["say", "--texts", "slides.json", "--no-retime", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(log.map((c) => c.what), ["tts", "tts"]);
    log.length = 0;
    assert.equal((await run(ctx, ["say", "--texts", "slides.json"])).code, 0);
    assert.deepEqual(log.map((c) => c.what), ["lines", "lines"]);
  } finally { await svc.close(); }
});

test("say --texts: a slide that waits for the viewer has its nudge said and re-timed right after it, cached as slide<N>-nudge", async () => {
  const { svc, ctx, log, writeDeck } = await deckWorld();
  try {
    const deck = deckOf(SIX.slice(0, 2));
    deck.slides[0].wait = { for: "tap", prompt: "Tap the card", nudge: "Go on, tap it.", nudgeAfterMs: 8000 };
    await writeDeck(deck);
    const r = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(log.map((c) => `${c.what}:${c.text}`), [`tts:${SIX[0]}`, `lines:${SIX[0]}`, "tts:Go on, tap it.", "lines:Go on, tap it.", `tts:${SIX[1]}`, `lines:${SIX[1]}`]);
    assert.ok(log.every((c) => c.text !== "Tap the card"), "the prompt is shown, never said");
    const dir = join(ctx.cwd, "lines");
    assert.ok(existsSync(join(dir, "slide0-nudge.wav")) && existsSync(join(dir, "slide0-nudge.json")));
    assert.equal(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")).lines["slide0-nudge"].textSha256, createHash("sha256").update("Go on, tap it.").digest("hex"));
  } finally { await svc.close(); }
});

test("say --texts: an ElevenLabs refusal that echoes the key stops the deck and never prints it; a deck is checked before any call", async () => {
  const { svc, ctx, log, writeDeck } = await deckWorld({ elevenStatus: 401 });
  try {
    await writeDeck(deckOf(SIX));
    const r = await run(ctx, ["say", "--texts", "slides.json", "--json"]);
    assert.equal(r.code, 1);
    assert.equal(log.length, 1, "stopped on the first refusal");
    assert.deepEqual(r.json.lines.map((l) => l.status), ["failed", ...Array(5).fill("not sent")]);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET), "the key is never printed");
    await writeDeck({ slides: [{ say: "ok" }, { say: "" }] });
    const empty = await run(ctx, ["say", "--texts", "slides.json", "--voice", RACHEL]);
    assert.equal(empty.code, 1);
    assert.match(empty.stderr, /slide 1 has nothing to say/);
    await writeDeck({ slides: [{ say: "No voice anywhere." }] });
    assert.match((await run(ctx, ["say", "--texts", "slides.json"])).stderr, /needs a voice/);
    assert.match((await run(ctx, ["say", "kai", "Hi", "--texts", "slides.json"])).stderr, /no text/);
    assert.equal(log.length, 1);
  } finally { await svc.close(); }
});
