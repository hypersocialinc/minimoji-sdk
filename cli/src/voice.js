// VOICES AND SPOKEN LINES — `minimoji voice` keeps an ElevenLabs voice on a
// library entry (POST /cli/avatars/voice); `minimoji say` turns a sentence
// into a line the SDK players play: one ElevenLabs text-to-speech call with
// timestamps, the effect run on the samples here, and the engine's buildLine
// over the audio and the words.
//
// Bring your own key: ELEVENLABS_API_KEY or --elevenlabs-key. It goes to
// api.elevenlabs.io and nowhere else: never to our service, never into a
// file, never printed. The stored voice is an id, an effect and settings.
//
// buildLine is not copied into the CLI. The site's public vanilla bundle
// (minimoji.com/sdk/minimoji-heads.js) exports it; `say` downloads that
// file over https, caches it by content hash, and imports it. The URL is a
// constant: no flag or variable points it elsewhere (the tests hand ctx a
// fixture's URL, as they hand it a fixture ElevenLabs).
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError, call, sessionCall } from "./service.js";
import { AVATAR_KEY, listLibrary, resolveTarget, slugify } from "./library.js";
import { table } from "./auth.js";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const HEADS_URL = "https://www.minimoji.com/sdk/minimoji-heads.js";
/** the line format this CLI writes; a bundle that speaks another is a newer site than this CLI */
export const LINE_VERSION = 1;
/** a stray file can't burn credits: the most characters one `say` sends */
export const MAX_TEXT = 1000;
/** buildLine's limit (the engine's MAX_LINE_SECONDS) */
export const MAX_LINE_SECONDS = 60;
/** 24 kHz 16-bit mono PCM: every ElevenLabs tier has it (44.1 kHz needs Pro);
 *  raw samples decode with no codec, and the file written is a WAV of them */
export const SAMPLE_RATE = 24000;
export const OUTPUT_FORMAT = `pcm_${SAMPLE_RATE}`;
/** eleven_v4 reads [tags] as performance and returns character timestamps */
export const DEFAULT_MODEL = "eleven_v4";
export const EFFECTS = ["none", "robot"];
/** convex/lib/ttsVoice.ts VOICE_ID_PATTERN: anything else is a voice's name */
export const VOICE_ID = /^[A-Za-z0-9]{8,40}$/;
const ELEVEN_ID = /^[A-Za-z0-9]{20}$/;
/** convex/lib/ttsVoice.ts SETTING_RANGES, plus use_speaker_boost (true/false) */
export const SETTING_RANGES = { stability: [0, 1], similarity_boost: [0, 1], style: [0, 1], speed: [0.7, 1.2] };

/** the voices the site's own characters speak with (apps/web/lib/character-voice-profiles.mjs),
 *  as suggestions: ElevenLabs' premade voices, by species id */
export const SUGGESTED = {
  person: { name: "Rachel", voiceId: "21m00Tcm4TlvDq8ikWAM" },
  dash: { name: "Brian", voiceId: "nPczCjzI2devNBz1zQrb", effect: "robot" },
  alien: { name: "Charlie", voiceId: "IKne3meq5aSn9XLyUdCD" },
  cat: { name: "Charlotte", voiceId: "XB0fDUnXU5powFXDhCwa" },
  rabbit: { name: "Lily", voiceId: "pFZP5JQG7iQjIQuC4Bku" },
  monkey: { name: "Liam", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
  dog: { name: "George", voiceId: "JBFqnCBsd6RMkjVDRZzb" },
  penguin: { name: "Jessica", voiceId: "cgSgspJ2msm6clMCkdW9" },
  ghost: { name: "Sarah", voiceId: "EXAVITQu4vr4xnSDxMaL" },
};

/** a species id ("alienGrey", "dash") to the SUGGESTED family it belongs to */
export function suggestionFor(doc) {
  const id = String(doc?.character?.id ?? "").toLowerCase();
  if (!id) return SUGGESTED.person;
  return Object.entries(SUGGESTED).find(([family]) => family !== "person" && id.startsWith(family))?.[1] ?? null;
}

// ─── the key ────────────────────────────────────────────────────────────────

/** the person's ElevenLabs key, or the one line that says how to set it */
export function elevenKey(ctx, opts) {
  const key = (opts["elevenlabs-key"] ?? ctx.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!key) throw new CliError("no ElevenLabs key: export ELEVENLABS_API_KEY=… (or pass --elevenlabs-key); it goes to api.elevenlabs.io only");
  return key;
}

/** a message with the key cut out, whatever echoed it */
const scrub = (text, key) => (key ? String(text).split(key).join("[key]") : String(text));

/** one ElevenLabs call with the person's key: the parsed JSON, or a CliError in ElevenLabs' words (never the key) */
export async function eleven(ctx, key, method, path, body) {
  const api = ctx.elevenlabsAPI ?? ELEVENLABS_API;
  let res;
  try {
    res = await ctx.fetch(`${api}${path}`, {
      method,
      headers: { "xi-api-key": key, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new CliError(scrub(`could not reach ElevenLabs (${error?.cause?.code ?? error?.message ?? error})`, key));
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* said below */ }
  if (!res.ok) {
    const detail = data?.detail;
    const why = (typeof detail === "string" ? detail : detail?.message ?? detail?.status) || text.trim().slice(0, 200) || res.statusText || "no details";
    const hint = res.status === 401 ? "; check ELEVENLABS_API_KEY" : "";
    throw new CliError(scrub(`ElevenLabs ${method} ${path.split("?")[0]} failed (${res.status}): ${why}${hint}`, key).split("\n")[0]);
  }
  if (data === null) throw new CliError(`ElevenLabs answered ${res.status} with something that is not JSON`);
  return data;
}

/** every voice the key's account has: [{voiceId, name, category}] */
export async function listVoices(ctx, key, search) {
  const voices = [];
  let token = null;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ page_size: "100", ...(search ? { search } : {}), ...(token ? { next_page_token: token } : {}) });
    const data = await eleven(ctx, key, "GET", `/v2/voices?${query}`);
    for (const v of data.voices ?? []) voices.push({ voiceId: v.voice_id, name: v.name, category: v.category ?? "" });
    if (!data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  return voices;
}

/** a voice id as is; a name looked up on the account (needs the key) */
export async function resolveVoice(ctx, opts, given) {
  if (ELEVEN_ID.test(given)) return { voiceId: given, name: null };
  // a key pasted where the voice goes is never echoed back, nor sent as a search
  const configured = (opts["elevenlabs-key"] ?? ctx.env.ELEVENLABS_API_KEY ?? "").trim();
  if (/^sk_/.test(given) || (configured && given.includes(configured))) throw new CliError("that looks like an ElevenLabs API key, not a voice; the key goes in ELEVENLABS_API_KEY, and the voice is an id or a name (minimoji voice --list)");
  if (!VOICE_ID.test(given) && !/^[\w .'-]{1,80}$/.test(given)) throw new CliError(`"${given.slice(0, 40)}" is not a voice id or name`);
  let key;
  try { key = elevenKey(ctx, opts); } catch {
    throw new CliError(`looking up the voice "${given}" by name needs ELEVENLABS_API_KEY; or pass its id (minimoji voice --list shows them)`);
  }
  const voices = await listVoices(ctx, key, given);
  const hit = voices.find((v) => v.voiceId === given) ?? voices.find((v) => v.name.toLowerCase() === given.toLowerCase())
    ?? voices.find((v) => v.name.toLowerCase().startsWith(`${given.toLowerCase()} `));
  if (!hit) throw new CliError(`no voice named "${given}" on this ElevenLabs account${voices.length ? `; close: ${voices.slice(0, 5).map((v) => v.name).join(", ")}` : ""}; minimoji voice --list shows them`);
  return { voiceId: hit.voiceId, name: hit.name };
}

/** `--settings stability=0.4,speed=1.1` (repeatable) → ElevenLabs voice_settings */
export function parseSettings(list = []) {
  const settings = {};
  for (const pair of list.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean)) {
    const [key, raw] = pair.split("=");
    if (key === "use_speaker_boost") {
      if (raw !== "true" && raw !== "false") throw new CliError("--settings use_speaker_boost=true|false");
      settings[key] = raw === "true";
      continue;
    }
    const range = Object.hasOwn(SETTING_RANGES, key) ? SETTING_RANGES[key] : null;
    if (!range) throw new CliError(`--settings ${key}: not a setting; use ${[...Object.keys(SETTING_RANGES), "use_speaker_boost"].join(", ")}`);
    const n = Number(raw);
    if (raw == null || raw === "" || !Number.isFinite(n) || n < range[0] || n > range[1]) throw new CliError(`--settings ${key} must be a number from ${range[0]} to ${range[1]}`);
    settings[key] = n;
  }
  return Object.keys(settings).length ? settings : undefined;
}

function checkEffect(effect) {
  if (effect != null && !EFFECTS.includes(effect)) throw new CliError(`--effect must be ${EFFECTS.join(" or ")}`);
  return effect;
}

// ─── audio ──────────────────────────────────────────────────────────────────

/** 16-bit little-endian PCM → mono Float32 samples */
export function pcmFromS16(bytes) {
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = bytes.readInt16LE(i * 2) / 32768;
  return out;
}

/** a 16-bit mono WAV of the samples */
export function wav(pcm, sampleRate) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** D.A.S.H.'s recipe as Bunch shipped it (apps/minimoji-app/scripts/gen-dash-lines.mjs,
 *  ffmpeg `tremolo=f=45:d=0.25,aecho=0.8:0.5:14:0.12`): a 45 Hz tremolo, gain
 *  between 1 − depth and 1, then a faint 14 ms echo. Gain only, sample for
 *  sample: no pitch or tempo change, so ElevenLabs' word times still line up */
export const ROBOT = { rate: 45, depth: 0.25, echoMs: 14, echo: 0.12 };
export function robot(pcm, sampleRate, { rate, depth, echoMs, echo } = ROBOT) {
  const trem = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) trem[i] = pcm[i] * (1 - depth * (0.5 - 0.5 * Math.sin(2 * Math.PI * rate * (i / sampleRate))));
  const delay = Math.round((echoMs / 1000) * sampleRate);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, trem[i] + (i >= delay ? echo * trem[i - delay] : 0)));
  return out;
}

export const applyEffect = (effect, pcm, sampleRate) => (effect === "robot" ? robot(pcm, sampleRate) : pcm);

/** ElevenLabs' character timestamps → `[{text, start, end}]`, split on
 *  whitespace. A `[tag]` stays in its word, so buildLine drops it from the
 *  captions and sets its mood (the engine's wordsFromAlignment drops tags) */
export function wordsFromCharacters(alignment) {
  const { characters = [], character_start_times_seconds: starts = [], character_end_times_seconds: ends = [] } = alignment ?? {};
  const words = [];
  let cur = null, inTag = false;
  characters.forEach((c, i) => {
    if (c === "[") inTag = true;
    else if (c === "]") inTag = false;
    if (/\s/.test(c) && !inTag) { if (cur) words.push(cur); cur = null; return; }
    if (!cur) cur = { text: "", start: starts[i], end: ends[i] };
    cur.text += c; cur.end = ends[i];
  });
  if (cur) words.push(cur);
  return words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
}

// ─── the line builder, from the site ────────────────────────────────────────

const cacheDir = (ctx) => join(ctx.env.XDG_CACHE_HOME || join(ctx.home, ".cache"), "minimoji");
const UPDATE = "update the CLI (npx minimoji@latest, or npm i -g minimoji@latest)";

/** the site's heads bundle, downloaded once and revalidated by ETag, then
 *  imported: `{buildLine, validateLine}`. Offline with a cached copy works;
 *  offline without one, or a bundle that fails to load or lacks buildLine,
 *  is one CliError, raised before any paid call */
export async function lineBuilder(ctx) {
  const url = ctx.headsURL ?? HEADS_URL;
  // code is only ever run from our own https origin (a test fixture on this machine aside)
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1[:/]/.test(url)) throw new CliError(`refusing to load the line builder from ${url}`);
  const dir = cacheDir(ctx), metaPath = join(dir, "heads.json");
  let meta = null;
  try { meta = JSON.parse(await readFile(metaPath, "utf8")); } catch { /* none yet */ }
  let cached = meta?.url === url && /^[0-9a-f]{64}$/.test(meta.sha256 ?? "") ? join(dir, `heads-${meta.sha256}.mjs`) : null;
  if (cached) await access(cached).catch(() => { cached = null; });
  let file = null;
  try {
    const res = await ctx.fetch(url, { headers: cached && meta.etag ? { "If-None-Match": meta.etag } : {} });
    if (res.status === 304 && cached) file = cached;
    else if (!res.ok) throw new Error(`HTTP ${res.status}`);
    else {
      const bytes = Buffer.from(await res.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      file = join(dir, `heads-${sha256}.mjs`);
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${file}.tmp`, bytes);
        await rename(`${file}.tmp`, file);
        await writeFile(metaPath, `${JSON.stringify({ url, etag: res.headers.get("etag"), sha256 })}\n`);
      } catch (error) {
        throw new CliError(`downloaded the line builder but could not cache it in ${dir} (${error?.code ?? error?.message ?? error}); make that folder writable, or set XDG_CACHE_HOME`);
      }
      if (cached && cached !== file) await rm(cached, { force: true });
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (!cached) throw new CliError(`could not download the line builder from ${url} (${error?.cause?.code ?? error?.message ?? error}); say needs it once, then works offline`);
    file = cached; // offline: the copy from last time
  }
  let mod;
  try { mod = await import(pathToFileURL(file).href); } catch (error) {
    await rm(metaPath, { force: true });
    throw new CliError(`the line builder from ${url} did not load (${String(error?.message ?? error).split("\n")[0]}); try again, or ${UPDATE}`);
  }
  if (typeof mod.buildLine !== "function" || typeof mod.validateLine !== "function" || (mod.LINE_VERSION ?? LINE_VERSION) !== LINE_VERSION)
    throw new CliError(`the line builder at ${url} is not the one this CLI knows (no buildLine for line v${LINE_VERSION}); ${UPDATE}`);
  return mod;
}

// ─── the commands ───────────────────────────────────────────────────────────

const describe = (v) => v ? `${v.voiceId}${v.effect && v.effect !== "none" ? ` + ${v.effect}` : ""}${v.settings ? ` (${Object.entries(v.settings).map(([k, x]) => `${k}=${x}`).join(", ")})` : ""}` : "none";

export async function voice(ctx, base, opts, out, [target, given, ...extra]) {
  if (extra.length) throw new CliError("voice takes the avatar and one voice; quote a voice name with spaces");
  if (opts.list) {
    const voices = await listVoices(ctx, elevenKey(ctx, opts));
    return out({ voices }, voices.length ? table([["NAME", "ID", "CATEGORY"], ...voices.map((v) => [v.name, v.voiceId, v.category])]) : "This ElevenLabs account has no voices.");
  }
  if (!target) throw new CliError("voice needs an avatar (a name or a key): minimoji voice kai Rachel, minimoji voice kai, or minimoji voice --list");
  checkEffect(opts.effect);
  const settings = parseSettings(opts.settings);
  const entry = resolveTarget(target, await listLibrary(ctx, base), { anyKey: true });
  const which = entry.name ? { name: entry.name } : { avatarKey: entry.avatarKey };
  if (opts.clear) {
    if (given) throw new CliError("--clear takes no voice");
    const { avatar } = await sessionCall(ctx, base, "POST", "/cli/avatars/voice", { ...which, ttsVoice: null });
    return out({ avatar: avatar.name, ttsVoice: null }, `Cleared ${avatar.name}'s voice.`);
  }
  if (!given) {
    if (opts.effect || settings) throw new CliError("--effect and --settings go with a voice: minimoji voice kai <voice> --effect robot");
    const appVoice = entry.voice ?? null;
    const lines = [`${entry.name ?? entry.avatarKey.slice(0, 12)}: ${describe(entry.ttsVoice)}`];
    if (appVoice) lines.push(`app voice: ${appVoice} (the Minimoji app's persona; say speaks with the voice above)`);
    let suggestion = null;
    if (!entry.ttsVoice) {
      // a suggestion is a nicety: a missing document or a failed fetch skips it, never the readout
      const doc = await call(ctx, base, "GET", `/avatars/${entry.avatarKey}.json`, { allow: [404] }).then((r) => (r.status === 404 ? null : r.data), () => null);
      suggestion = doc ? suggestionFor(doc) : null;
      if (suggestion) lines.push(`Try: minimoji voice ${entry.name ?? entry.avatarKey} ${suggestion.voiceId}${suggestion.effect ? ` --effect ${suggestion.effect}` : ""}  (${suggestion.name})`);
      else lines.push(`Set one: minimoji voice ${entry.name ?? entry.avatarKey} <voice id or name>`);
    }
    return out({ avatar: entry.name, avatarKey: entry.avatarKey, ttsVoice: entry.ttsVoice ?? null, appVoice, ...(suggestion ? { suggestion } : {}) }, lines.join("\n"));
  }
  const found = await resolveVoice(ctx, opts, given);
  const ttsVoice = { provider: "elevenlabs", voiceId: found.voiceId, effect: opts.effect ?? "none", ...(settings ? { settings } : {}) };
  const { avatar, added } = await sessionCall(ctx, base, "POST", "/cli/avatars/voice", { ...which, ttsVoice });
  return out({ avatar: avatar.name, avatarKey: avatar.avatarKey, ttsVoice, added },
    `${added ? `Kept ${avatar.avatarKey.slice(0, 12)} as ${avatar.name} and gave it` : `${avatar.name} now speaks with`} ${found.name ? `${found.name} (${describe(ttsVoice)})` : describe(ttsVoice)}.`);
}

/** the text a `say` speaks, without its [tags], as a file name */
export const lineName = (text) => slugify(text.replace(/\[[^\]]*\]/g, " ")) ?? "line";

export async function say(ctx, base, opts, out, [target, text, ...extra]) {
  if (!target || text == null) throw new CliError('say needs an avatar and the words: minimoji say kai "Hi, I\'m Billie"');
  if (extra.length) throw new CliError("say takes one text; put it in quotes");
  if (!text.trim()) throw new CliError("say needs some words");
  if (text.length > MAX_TEXT) throw new CliError(`that text is ${text.length} characters; say takes at most ${MAX_TEXT} per line, so a stray file can't spend your ElevenLabs credits`);
  checkEffect(opts.effect);
  const name = opts.name ?? lineName(text);
  if (!/^[A-Za-z0-9][\w.-]{0,79}$/.test(name)) throw new CliError(`--name "${name}" is not a file name: letters, digits, dots, dashes and underscores`);
  const outDir = resolvePath(ctx.cwd, opts.out ?? "minimoji-lines");

  // the voice: --voice, else the library entry's
  let chosen;
  if (opts.voice) {
    const settings = parseSettings(opts.settings);
    chosen = { voiceId: opts.voice, effect: opts.effect ?? "none", ...(settings ? { settings } : {}) };
  } else {
    const entry = resolveTarget(target, await listLibrary(ctx, base), { anyKey: AVATAR_KEY.test(target) });
    if (!entry.ttsVoice) throw new CliError(`${entry.name ?? target} has no voice yet; minimoji voice ${entry.name ?? target} <voice> sets one, or pass --voice`);
    const settings = parseSettings(opts.settings);
    chosen = { voiceId: entry.ttsVoice.voiceId, effect: opts.effect ?? entry.ttsVoice.effect ?? "none", ...((settings ?? entry.ttsVoice.settings) ? { settings: settings ?? entry.ttsVoice.settings } : {}) };
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const request = { voice: chosen.voiceId, effect: chosen.effect, model, text, characters: text.length, ...(chosen.settings ? { settings: chosen.settings } : {}) };
  if (opts["dry-run"]) {
    return out({ dryRun: true, ...request, out: join(outDir, `${name}.json`) },
      [`Would send ${text.length} characters to ElevenLabs (${model}, voice ${chosen.voiceId}${chosen.effect !== "none" ? `, then ${chosen.effect}` : ""}):`, `  ${text}`, `and write ${join(outDir, `${name}.json`)} + .wav. Nothing was sent.`].join("\n"));
  }
  const key = elevenKey(ctx, opts);
  const voiceId = opts.voice ? (await resolveVoice(ctx, opts, opts.voice)).voiceId : chosen.voiceId;
  // before the paid call: a missing or broken builder, a mood it doesn't know
  // or a folder that can't be written costs nothing
  const { buildLine, validateLine } = await lineBuilder(ctx);
  if (opts.mood) {
    try { validateLine(buildLine({ pcm: new Float32Array(SAMPLE_RATE / 10), sampleRate: SAMPLE_RATE, mood: opts.mood })); } catch {
      throw new CliError(`"${opts.mood.slice(0, 40)}" is not a mood the line format knows (happy, joy, sad, thinking, surprised…)`);
    }
  }
  try { await mkdir(outDir, { recursive: true }); } catch (error) {
    throw new CliError(`can't write lines into ${outDir} (${error?.code ?? error?.message ?? error})`);
  }

  const tts = await eleven(ctx, key, "POST", `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    { text, model_id: model, ...(chosen.settings ? { voice_settings: chosen.settings } : {}) });
  if (typeof tts.audio_base64 !== "string" || !tts.audio_base64) throw new CliError("ElevenLabs returned no audio");
  const alignment = tts.alignment ?? tts.normalized_alignment;
  if (!alignment?.characters?.length) throw new CliError(`ElevenLabs returned no timestamps for ${model}; pick a model with timestamps (--model)`);
  const pcm = applyEffect(chosen.effect, pcmFromS16(Buffer.from(tts.audio_base64, "base64")), SAMPLE_RATE);
  if (!pcm.length) throw new CliError("ElevenLabs returned empty audio");
  const seconds = pcm.length / SAMPLE_RATE;
  if (seconds > MAX_LINE_SECONDS) {
    // paid for already: keep the audio (under its own name, so an earlier
    // <name>.wav + .json pair is never split), and say why there is no line
    const audioPath = join(outDir, `${name}.too-long.wav`);
    await writeFile(audioPath, wav(pcm, SAMPLE_RATE));
    throw new CliError(`that came to ${seconds.toFixed(1)} s and a line is at most ${MAX_LINE_SECONDS} s; the audio is kept at ${audioPath}, so split the text and say each part`);
  }
  let line;
  try {
    line = validateLine(buildLine({ pcm, sampleRate: SAMPLE_RATE, words: wordsFromCharacters(alignment), ...(opts.mood ? { mood: opts.mood } : {}) }));
  } catch (error) {
    throw new CliError(`could not build the line (${String(error?.message ?? error).split("\n")[0]})`);
  }
  // both files or neither: each is written aside, then both are renamed in
  const linePath = join(outDir, `${name}.json`), audioPath = join(outDir, `${name}.wav`);
  const pending = [[audioPath, wav(pcm, SAMPLE_RATE)], [linePath, `${JSON.stringify(line)}\n`]].map(([path, bytes]) => [path, `${path}.${process.pid}.tmp`, bytes]);
  try {
    for (const [, tmp, bytes] of pending) await writeFile(tmp, bytes);
    for (const [path, tmp] of pending) await rename(tmp, path);
  } catch (error) {
    await Promise.all(pending.map(([, tmp]) => rm(tmp, { force: true })));
    throw new CliError(`could not write the line into ${outDir} (${error?.code ?? error?.message ?? error}); ElevenLabs was already paid for it, so run say again`);
  }
  const duration = line.duration;
  return out({ line: linePath, audio: audioPath, duration }, `Wrote ${linePath}\n  and ${audioPath} (${duration.toFixed(2)} s).`);
}
