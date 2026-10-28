// CLIPS IN, LINES OUT — `minimoji lines` takes recordings a developer already
// has (any TTS, a human voice) and writes the playable line beside each: one
// POST /lines per clip with the Minimoji key (no ElevenLabs key anywhere).
// With the clip's text the service force-aligns that script to the audio, so
// the letters follow the words as written; without it the clip is
// transcribed. `minimoji say` is the other way round: new audio from a
// sentence, on the developer's own ElevenLabs key.
//
// The clip is sent as a 16-bit mono WAV at its own rate (48 kHz at most), so
// the line the service builds is shaped from the samples the app will play.
// A .wav is read here; an .mp3 or .m4a goes through ffmpeg, which must be on
// the PATH (the rule apps/minimoji-app/scripts/gen-dash-lines.mjs uses).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { CliError, keyedCall } from "./service.js";
import { wav } from "./voice.js";

/** POST /lines' limits (convex/lib/lines.ts): a clip's length, its WAV's size, the text's characters */
export const LINES_MAX_SECONDS = 30;
export const LINES_MAX_BYTES = 4 * 1024 * 1024;
export const LINES_MAX_TEXT = 2000;
/** the highest rate a clip is sent at: 30 s of 16-bit mono at 48 kHz is under 3 MB */
export const SEND_RATE = 48000;
export const CLIP_TYPES = [".wav", ".mp3", ".m4a"];

const run = promisify(execFile);

/** a WAV's samples, mixed to mono: 8/16/24/32-bit integer PCM or 32-bit float (the service's own decodeWav rules) */
export function readWav(b) {
  const ascii = (at, n) => b.toString("latin1", at, at + n);
  if (b.length < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("not a WAV (RIFF/WAVE)");
  let fmt = null;
  for (let at = 12; at + 8 <= b.length;) {
    const id = ascii(at, 4), size = b.readUInt32LE(at + 4), body = at + 8;
    if (id === "fmt " && size >= 16) {
      let format = b.readUInt16LE(body);
      if (format === 0xfffe && size >= 26) format = b.readUInt16LE(body + 24);
      fmt = { format, channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === "data" && fmt) {
      const { format, channels, sampleRate, bits } = fmt, width = bits / 8;
      if (!(channels >= 1 && sampleRate >= 8000 && ((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32)))) throw new Error("a WAV must be integer PCM (8-32 bit) or 32-bit float");
      const frames = Math.floor(Math.min(size, b.length - body) / (width * channels)), pcm = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          sum += format === 3 ? b.readFloatLE(p) : bits === 8 ? (b[p] - 128) / 128 : bits === 16 ? b.readInt16LE(p) / 32768 : bits === 24 ? b.readIntLE(p, 3) / 8388608 : b.readInt32LE(p) / 2147483648;
        }
        pcm[i] = sum / channels;
      }
      return { pcm, sampleRate };
    }
    at = body + size + (size & 1);
  }
  throw new Error("the WAV has no samples");
}

/** samples at `from` Hz → `to` Hz, each output sample the mean of the input samples it covers */
export function downsample(pcm, from, to) {
  if (from <= to) return pcm;
  const step = from / to, n = Math.floor(pcm.length / step), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
    let sum = 0; for (let j = a; j < b; j++) sum += pcm[j];
    out[i] = sum / (b - a);
  }
  return out;
}

/** a clip's mono samples: a WAV read here, anything else through ffmpeg (one clear line when it is missing) */
export async function clipSamples(ctx, file) {
  if (extname(file).toLowerCase() === ".wav") {
    try { return readWav(await readFile(file)); } catch (error) { throw new CliError(error.message); }
  }
  const ffmpeg = ctx.ffmpeg ?? "ffmpeg";
  let out;
  try {
    ({ stdout: out } = await (ctx.execFile ?? run)(ffmpeg, ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(SEND_RATE), "pipe:1"], { encoding: "buffer", maxBuffer: 256e6 }));
  } catch (error) {
    if (error?.code === "ENOENT") throw new CliError(`reading ${extname(file)} needs ffmpeg on the PATH (brew install ffmpeg), or convert it to .wav`);
    throw new CliError(`ffmpeg could not read it (${String(error?.stderr ?? error?.message ?? error).trim().split("\n")[0]})`);
  }
  const pcm = new Float32Array(Math.floor(out.length / 2));
  for (let i = 0; i < pcm.length; i++) pcm[i] = out.readInt16LE(i * 2) / 32768;
  return { pcm, sampleRate: SEND_RATE };
}

/** the clips the arguments name: files as given, a folder's .wav/.mp3/.m4a (not its subfolders), in name order */
export async function findClips(ctx, given) {
  const clips = [];
  for (const arg of given) {
    const path = resolvePath(ctx.cwd, arg);
    let info;
    try { info = await stat(path); } catch { throw new CliError(`no such file or folder: ${arg}`); }
    if (info.isDirectory()) {
      const names = (await readdir(path)).filter((n) => CLIP_TYPES.includes(extname(n).toLowerCase()) && !n.startsWith(".")).sort();
      clips.push(...names.map((n) => join(path, n)));
    } else if (CLIP_TYPES.includes(extname(path).toLowerCase())) clips.push(path);
    else throw new CliError(`${arg} is not a clip (${CLIP_TYPES.join(", ")})`);
  }
  return [...new Set(clips)];
}

/** `--texts` (`{ "<name>": "text" }`, or the app's lines.json `{ "<name>": { text, … } }`) → name → text */
export async function readTexts(ctx, file) {
  let data;
  try { data = JSON.parse(await readFile(resolvePath(ctx.cwd, file), "utf8")); } catch (error) {
    throw new CliError(`--texts ${file}: ${error.code === "ENOENT" ? "no such file" : "not JSON"}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CliError(`--texts ${file} must be { "<clip name>": "what it says" }`);
  const texts = new Map();
  for (const [name, value] of Object.entries(data)) {
    const text = typeof value === "string" ? value : typeof value?.text === "string" ? value.text : null;
    if (text != null) texts.set(name, text);
  }
  return texts;
}

/** each file written aside, then renamed in, the line last: a line on disk always has the timings of its own run
 *  beside it (a failed rename leaves the old line, never a new one beside old timings) */
async function writeAll(files) {
  const pending = files.map(([path, text]) => [path, `${path}.${process.pid}.${randomUUID()}.tmp`, text]).reverse();
  try {
    for (const [, tmp, text] of pending) await writeFile(tmp, text);
    for (const [path, tmp] of pending) await rename(tmp, path);
  } catch (error) {
    await Promise.allSettled(pending.map(([, tmp]) => rm(tmp, { force: true })));
    throw error;
  }
}

export async function lines(ctx, base, opts, out, given) {
  if (!given.length) throw new CliError("lines needs clips: minimoji lines ./clips --texts lines.json, or minimoji lines hello.wav --text \"Hi!\"");
  if (opts.text != null && opts.texts != null) throw new CliError("--text is one clip's words and --texts a file of them: pass one");
  const clips = await findClips(ctx, given);
  if (!clips.length) throw new CliError(`no clips (${CLIP_TYPES.join(", ")}) in ${given.join(", ")}`);
  if (opts.text != null && clips.length !== 1) throw new CliError(`--text is one clip's words, and there are ${clips.length} clips; use --texts lines.json`);
  const texts = opts.texts != null ? await readTexts(ctx, opts.texts) : new Map();
  const outDir = opts.out != null ? resolvePath(ctx.cwd, opts.out) : null;
  if (outDir && !opts["dry-run"]) {
    try { await mkdir(outDir, { recursive: true }); } catch (error) { throw new CliError(`can't write lines into ${outDir} (${error?.code ?? error?.message ?? error})`); }
  }

  const results = [];
  let stopped = null;
  for (const clip of clips) {
    if (stopped) { results.push({ clip, name: basename(clip, extname(clip)), status: "not sent", reason: "the run stopped first" }); continue; }
    const name = basename(clip, extname(clip)), dir = outDir ?? dirname(clip);
    const result = { clip, name, line: join(dir, `${name}.json`), ...(opts.timings ? { timings: join(dir, `${name}.timings.json`) } : {}) };
    results.push(result);
    try {
      let text = opts.text ?? texts.get(name) ?? null;
      if (text == null) {
        const txt = join(dirname(clip), `${name}.txt`);
        text = await readFile(txt, "utf8").then((t) => t.trim(), (error) => {
          if (error.code === "ENOENT") return null;   // no text: transcribed
          throw new CliError(`can't read ${basename(txt)} (${error.code ?? error.message})`);
        });
      }
      // nothing to align outside its [tags]: transcribed, as a clip with no text
      if (text != null && !text.replace(/\[[^\]]*\]/g, " ").trim()) text = null;
      if (text != null && text.length > LINES_MAX_TEXT) throw new CliError(`its text is ${text.length} characters; a clip's text is at most ${LINES_MAX_TEXT}`);
      result.text = text;
      const { pcm, sampleRate } = await clipSamples(ctx, clip);
      result.seconds = Math.round((pcm.length / sampleRate) * 100) / 100;
      if (!pcm.length) throw new CliError("it has no samples");
      if (pcm.length / sampleRate > LINES_MAX_SECONDS) throw new CliError(`it is ${result.seconds.toFixed(1)} s; a clip is at most ${LINES_MAX_SECONDS} s (split it)`);
      const rate = Math.min(sampleRate, SEND_RATE), audio = wav(downsample(pcm, sampleRate, rate), rate);
      if (audio.length > LINES_MAX_BYTES) throw new CliError(`it is ${(audio.length / 1024 / 1024).toFixed(1)} MB as a WAV; a clip is at most 4 MB`);
      if (opts["dry-run"]) { result.status = "would send"; continue; }
      const form = new FormData();
      form.append("audio", new Blob([audio], { type: "audio/wav" }), `${name}.wav`);
      if (text != null) form.append("text", text);
      const answer = await keyedCall(ctx, base, opts, "POST", "/lines", form);
      if (!answer?.line || !Array.isArray(answer.words)) throw new CliError("POST /lines answered without a line");
      const files = [[result.line, `${JSON.stringify(answer.line)}\n`]];
      const timings = { transcript: answer.transcript ?? "", words: answer.words, letters: answer.letters ?? [], alignedTo: answer.alignedTo ?? "transcript", ...(Number.isFinite(answer.loss) ? { loss: answer.loss } : {}) };
      if (opts.timings) files.push([result.timings, `${JSON.stringify(timings, null, 2)}\n`]);
      try { await writeAll(files); } catch (error) {
        throw new CliError(`could not write into ${dir} (${error?.code ?? error?.message ?? error})`);
      }
      Object.assign(result, { status: "written", alignedTo: timings.alignedTo, ...(timings.loss != null ? { loss: timings.loss } : {}) });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      // a refusal of the key or the day stops the run: every clip after it would be refused the same way; the
      // summary still says what was written
      if ([401, 403, 429, 503].includes(error.status)) { stopped = error; Object.assign(result, { status: "not sent", reason: error.message }); continue; }
      Object.assign(result, { status: "skipped", reason: error.message });
    }
  }

  const failed = results.filter((r) => r.status === "skipped" || r.status === "not sent").length;
  const human = results.map((r) => r.status === "skipped" || r.status === "not sent" ? `${r.status} ${basename(r.clip)}: ${r.reason}`
    : r.status === "would send" ? `would send ${basename(r.clip)} (${r.seconds.toFixed(1)} s, ${r.text != null ? `aligned to its text: "${r.text.slice(0, 60)}${r.text.length > 60 ? "…" : ""}"` : "transcribed: no text"}) → ${r.line}`
      : `wrote ${r.line}${r.timings ? ` + ${basename(r.timings)}` : ""} (${r.alignedTo === "text" ? `aligned to its text${r.loss != null ? `, loss ${r.loss}` : ""}` : "transcribed"})`);
  if (opts["dry-run"]) human.push("Nothing was sent.");
  if (failed) human.push(`${failed} of ${results.length} clip(s) not written.`);
  if (stopped) { human.push(`Stopped: ${stopped.message}`); ctx.stderr(`minimoji: ${stopped.message}\n`); }
  out({ clips: results.map(({ text, ...r }) => ({ ...r, hasText: text != null })), ...(opts["dry-run"] ? { dryRun: true } : {}), skipped: failed, ...(stopped ? { stopped: stopped.message } : {}) }, human.join("\n"));
  return failed ? 1 : 0;
}
