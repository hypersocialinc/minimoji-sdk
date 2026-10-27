import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { downsample, readWav } from "../src/lines.js";
import { wav } from "../src/voice.js";
import { fixtureServer, makeCtx, run, signIn, tempDir } from "./helpers.mjs";

const SECRET = "mk_sec_" + "s".repeat(40);
/** a voiced tone of `seconds` at `rate` */
function clip(seconds, rate = 24000) {
  const pcm = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.4 * Math.sin(2 * Math.PI * 200 * (i / rate));
  return wav(pcm, rate);
}

/** our service: POST /lines answering a line, aligned when a text part came */
async function world(answer = {}) {
  const seen = [];
  const svc = await fixtureServer({
    "POST /lines": async ({ bytes, headers, auth }) => {
      const form = await new Response(bytes, { headers: { "content-type": headers["content-type"] } }).formData();
      const audio = new Uint8Array(await form.get("audio").arrayBuffer()), text = form.get("text");
      seen.push({ auth, text, audio });
      if (answer.status) return { status: answer.status, json: { error: answer.error } };
      const words = [{ text: text ? `${text.split(" ")[0]}` : "heard", start: 0.1, end: 0.4 }];
      return { json: { line: { version: 1, fps: 60, duration: 1, frames: [], captions: [], cues: [] }, words, letters: [{ text: "M", start: 0.1, end: 0.2 }], transcript: text ?? "heard", language: null,
        alignedTo: text ? "text" : "transcript", ...(text ? { loss: 0.25 } : {}) } };
    },
  });
  const ctx = await makeCtx({ env: { MINIMOJI_KEY: SECRET } });
  return { svc, ctx, seen };
}

test("a folder with --texts --timings: one POST /lines per clip on the Minimoji key, the text beside the audio, <name>.json + .timings.json written", async () => {
  const { svc, ctx, seen } = await world();
  const dir = join(ctx.cwd, "clips"); await mkdir(dir);
  await writeFile(join(dir, "dash-hello.wav"), clip(1.2));
  await writeFile(join(dir, "dash-name.wav"), clip(0.8, 48000));
  await writeFile(join(dir, "notes.md"), "not a clip");
  await writeFile(join(ctx.cwd, "lines.json"), JSON.stringify({ "dash-hello": { text: "Make my day.", words: [] }, "dash-name": "What's your name?" }));
  const r = await run(ctx, ["lines", "clips", "--texts", "lines.json", "--timings", "--base", svc.url, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => s.text), ["Make my day.", "What's your name?"]);
  assert.ok(seen.every((s) => s.auth === `Bearer ${SECRET}`), "the Minimoji key, never an ElevenLabs one");
  const sent = readWav(Buffer.from(seen[1].audio));
  assert.equal(sent.sampleRate, 48000, "at its own rate");
  assert.ok(Math.abs(sent.pcm.length / 48000 - 0.8) < 1e-3);
  assert.deepEqual((await readdir(dir)).sort(), ["dash-hello.json", "dash-hello.timings.json", "dash-hello.wav", "dash-name.json", "dash-name.timings.json", "dash-name.wav", "notes.md"]);
  const timings = JSON.parse(await readFile(join(dir, "dash-hello.timings.json"), "utf8"));
  assert.deepEqual(timings, { transcript: "Make my day.", words: [{ text: "Make", start: 0.1, end: 0.4 }], letters: [{ text: "M", start: 0.1, end: 0.2 }], alignedTo: "text", loss: 0.25 });
  assert.equal(JSON.parse(await readFile(join(dir, "dash-hello.json"), "utf8")).version, 1);
  assert.deepEqual(r.json.clips.map((c) => [c.name, c.status, c.alignedTo]), [["dash-hello", "written", "text"], ["dash-name", "written", "text"]]);
  await svc.close();
});

test("one clip: --text, else <name>.txt, else transcribed; --out writes elsewhere; --dry-run sends nothing", async () => {
  const { svc, ctx, seen } = await world();
  await writeFile(join(ctx.cwd, "a.wav"), clip(0.5));
  await writeFile(join(ctx.cwd, "b.wav"), clip(0.5));
  await writeFile(join(ctx.cwd, "b.txt"), "  Bye, Mom.\n");
  const dry = await run(ctx, ["lines", "a.wav", "b.wav", "--dry-run", "--base", svc.url]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.equal(seen.length, 0, "nothing sent");
  assert.match(dry.stdout, /would send a\.wav \(0\.5 s, transcribed: no text\)/);
  assert.match(dry.stdout, /would send b\.wav \(0\.5 s, aligned to its text: "Bye, Mom\."\)/);
  assert.match(dry.stdout, /Nothing was sent\./);
  const r = await run(ctx, ["lines", "a.wav", "b.wav", "--out", "out", "--base", svc.url]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.deepEqual(seen.map((s) => s.text), [null, "Bye, Mom."]);
  assert.deepEqual((await readdir(join(ctx.cwd, "out"))).sort(), ["a.json", "b.json"]);
  assert.match(r.stdout, /a\.json \(transcribed\)/);
  const one = await run(ctx, ["lines", "a.wav", "--text", "Hi!", "--base", svc.url]);
  assert.equal(one.code, 0, one.stderr); assert.equal(seen.at(-1).text, "Hi!");
  const many = await run(ctx, ["lines", "a.wav", "b.wav", "--text", "Hi!", "--base", svc.url]);
  assert.equal(many.code, 1); assert.match(many.stderr, /--text is one clip's words, and there are 2 clips/);
  await svc.close();
});

test("an over-long clip, an mp3 without ffmpeg and a broken WAV are skipped with the reason; the rest are written and the exit code is 1", async () => {
  const { svc, ctx, seen } = await world();
  await writeFile(join(ctx.cwd, "long.wav"), clip(31, 8000));
  await writeFile(join(ctx.cwd, "ok.wav"), clip(0.5));
  await writeFile(join(ctx.cwd, "song.mp3"), Buffer.from("ID3 not really"));
  await writeFile(join(ctx.cwd, "bad.wav"), Buffer.from("RIFF....WAVEjunk"));
  ctx.ffmpeg = "minimoji-no-such-ffmpeg";
  const r = await run(ctx, ["lines", ".", "--base", svc.url]);
  assert.equal(r.code, 1);
  assert.equal(seen.length, 1, "only the good clip is sent");
  assert.match(r.stdout, /skipped long\.wav: it is 31\.0 s; a clip is at most 30 s/);
  assert.match(r.stdout, /skipped song\.mp3: reading \.mp3 needs ffmpeg on the PATH/);
  assert.match(r.stdout, /skipped bad\.wav: .*no samples/);
  assert.match(r.stdout, /wrote .*ok\.json/);
  assert.match(r.stdout, /3 of 4 clip\(s\) not written/);
  await svc.close();
});

test("an mp3 goes through ffmpeg at 48 kHz mono; a spent day stops the run in the service's words", async () => {
  const { svc, ctx, seen } = await world();
  await writeFile(join(ctx.cwd, "hi.mp3"), Buffer.from("ID3"));
  const asked = [];
  ctx.execFile = async (cmd, args) => { asked.push([cmd, ...args]); const b = Buffer.alloc(48000); return { stdout: b }; };
  const r = await run(ctx, ["lines", "hi.mp3", "--base", svc.url]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(asked[0], ["ffmpeg", "-v", "error", "-i", join(ctx.cwd, "hi.mp3"), "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"]);
  assert.equal(readWav(Buffer.from(seen[0].audio)).sampleRate, 48000);
  await svc.close();
  const spent = await world({ status: 429, error: "today's 200 recorded lines for this key are spent" });
  await writeFile(join(spent.ctx.cwd, "a.wav"), clip(0.3)); await writeFile(join(spent.ctx.cwd, "b.wav"), clip(0.3));
  const no = await run(spent.ctx, ["lines", ".", "--base", spent.svc.url]);
  assert.equal(no.code, 1);
  assert.equal(spent.seen.length, 1, "the second clip is not tried");
  assert.match(no.stderr, /429.*spent/);
  assert.match(no.stdout, /not sent a\.wav: .*429.*\nnot sent b\.wav: the run stopped first/, "the summary still says what happened to each");
  await spent.svc.close();
});

test("readWav mixes stereo to mono and downsample averages", () => {
  const stereo = Buffer.from(clip(0.1));
  assert.equal(readWav(stereo).pcm.length, 2400);
  assert.deepEqual([...downsample(new Float32Array([0, 1, 1, 1]), 4, 2)], [0.5, 1]);
});

test("a refusal of one clip (413) skips it and the run carries on; a tag-only text is transcribed", async () => {
  const seen = [];
  const svc = await fixtureServer({
    "POST /lines": [() => { seen.push(1); return { status: 413, json: { error: "a recording is at most 4 MB" } }; },
      async ({ bytes, headers }) => { const f = await new Response(bytes, { headers: { "content-type": headers["content-type"] } }).formData(); seen.push(f.get("text"));
        return { json: { line: { version: 1 }, words: [], letters: [], transcript: "", alignedTo: "transcript" } }; }],
  });
  const ctx = await makeCtx({ env: { MINIMOJI_KEY: SECRET } });
  await writeFile(join(ctx.cwd, "a.wav"), clip(0.3)); await writeFile(join(ctx.cwd, "b.wav"), clip(0.3));
  await writeFile(join(ctx.cwd, "b.txt"), "[laughs]");
  const r = await run(ctx, ["lines", ".", "--base", svc.url]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /skipped a\.wav: .*413/);
  assert.match(r.stdout, /wrote .*b\.json \(transcribed\)/);
  assert.deepEqual(seen, [1, null], "b was sent without its tag-only text");
  await svc.close();
});
