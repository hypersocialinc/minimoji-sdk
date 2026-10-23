// MAKING AVATARS — over routes that already exist (convex/http.ts): a
// document from words or a photo (POST /avatars/generate) saved with POST
// /avatars, a species saved the same way, the still from GET
// /avatars/<key>.png, and the website's /preview page to look at one. When
// the terminal is signed in, what generate makes is kept in the library
// (library.js), and render and preview take a library name for a key.
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { BASES, CliError, call, keyedCall, resolveSite } from "./service.js";
import { table } from "./auth.js";
import { checkName, keep, keyFor, signedIn, slugify } from "./library.js";

/** a run's ceiling: each generation is cents of model time from the key's day quota */
export const MAX_COUNT = 10;
export const MAX_PROMPT_CHARS = 500;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const RENDER_SIZES = [64, 128, 256, 512];
const AVATAR_KEY = /^[0-9a-f]{64}$/;
/** the preview page refuses a fragment longer than this (apps/web/lib/preview.ts MAX_DOC_PARAM) */
const MAX_DOC_PARAM = 8 * 1024;

export async function generate(ctx, base, opts, out, words) {
  const prompt = words.join(" ").trim();
  const count = opts.count == null ? 1 : Number(opts.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new CliError(`--count must be a whole number from 1 to ${MAX_COUNT}; each one spends a generation from the key's day`);
  if (!prompt && !opts.photo) throw new CliError('generate needs a description ("red curls, round glasses"), --photo me.jpg, or both');
  if (prompt.length > MAX_PROMPT_CHARS) throw new CliError(`the description is at most ${MAX_PROMPT_CHARS} characters`);
  const seed = optionalInt(opts.seed, "--seed");
  const name = opts.name == null ? null : checkName(opts.name);
  const keeping = await signedIn(ctx, base);
  if (name && !keeping) throw new CliError("--name keeps the avatar in your library, which needs a signed-in terminal: run minimoji login first");
  let image;
  if (opts.photo) {
    const bytes = await readFile(resolve(ctx.cwd, opts.photo)).catch((e) => { throw new CliError(`cannot read ${opts.photo} (${e.code})`); });
    if (bytes.length > MAX_PHOTO_BYTES) throw new CliError(`${opts.photo} is over ${MAX_PHOTO_BYTES / 1024 / 1024} MB; downscale it to a 1024 px long edge first`);
    if (!isJPEG(bytes) && !isPNG(bytes)) throw new CliError(`${opts.photo} must be a JPEG or a PNG`);
    image = bytes.toString("base64");
  }

  // each one is written as it is made: a failure later in a run (the day's
  // quota, the network) must not lose the avatars already paid for
  const avatars = [];
  let failure = null;
  const unkept = [];
  for (let i = 0; i < count; i++) {
    if (count > 1) ctx.stderr(`generating ${i + 1} of ${count}…\n`);
    try {
      const made = await keyedCall(ctx, base, opts, "POST", "/avatars/generate", { ...(prompt ? { prompt } : {}), ...(image ? { image } : {}), ...(seed != null ? { seed: seed + i } : {}) });
      const saved = await keyedCall(ctx, base, opts, "POST", "/avatars", { doc: made.doc });
      if (opts.out) await writeFile(numbered(resolve(ctx.cwd, opts.out), i, count), `${JSON.stringify(made.doc, null, 2)}\n`);
      let kept = null;
      // the avatar is saved and paid for: a library that refuses it (full,
      // the network) is said, not a reason to stop the run or lose the key
      if (keeping) {
        try {
          kept = (await keep(ctx, base, { avatarKey: saved.avatarKey, ...(name ? { name, suffix: true } : { defaultName: slugify(prompt) ?? "avatar" }) })).avatar.name;
        } catch (error) { const why = `saved ${saved.avatarKey} but could not add it to your library: ${error.message}`; unkept.push(why); ctx.stderr(`minimoji: ${why}\n`); }
      }
      avatars.push({ ...described(ctx, base, opts, saved, made.doc), name: kept, notes: made.notes ?? null, doc: made.doc });
    } catch (error) {
      if (!avatars.length) throw error;
      failure = `made ${avatars.length} of ${count}, then: ${error.message}`;
      break;
    }
  }
  if (opts.open) for (const a of avatars) ctx.open(a.preview);
  out({ avatars, ...(failure ? { error: failure } : {}), ...(unkept.length ? { libraryErrors: unkept } : {}), ...(unkept.length && !failure ? { error: unkept.join("; ") } : {}) },
    avatars.map((a) => [a.avatarKey, ...(a.name ? [`  name     ${a.name}`] : []), `  picture  ${a.picture}`, `  preview  ${a.preview}`, ...(a.notes ? [`  notes    ${oneLine(a.notes)}`] : [])].join("\n")).join("\n\n"));
  if (failure) { ctx.stderr(`minimoji: ${failure}\n`); return 1; }
  return unkept.length ? 1 : 0;
}

export async function species(ctx, base, opts, out, [sub, ...rest]) {
  const caps = (await call(ctx, base, "GET", "/capabilities")).data;
  const characters = caps.characters ?? [];
  const kits = caps.characterKits ?? {};
  if (sub === "list" || sub === undefined) {
    const rows = characters.map((c) => [c.id, c.name, c.family, c.kit ?? "-"]);
    const kitLines = Object.entries(kits).map(([name, axes]) => [`kit ${name}:`, ...Object.entries(axes).map(([axis, options]) => `  ${axis}: ${options.join(", ")}`)].join("\n"));
    return out({ characters, characterKits: kits },
      characters.length ? [table([["ID", "NAME", "FAMILY", "KIT"], ...rows]), ...kitLines].join("\n\n") : `${base} offers no species.`);
  }
  if (sub === "make") {
    const id = rest[0];
    if (!id) throw new CliError("species make needs an id from minimoji species list, e.g. minimoji species make alienGrey");
    const character = characters.find((c) => c.id === id);
    if (!character) throw new CliError(`no species "${id}"; minimoji species list shows the ids`);
    const pick = parsePicks(opts.pick ?? [], character.kit ? kits[character.kit] : null, id);
    const seed = optionalInt(opts.seed, "--seed");
    const selection = { id, ...(seed != null ? { seed } : {}), ...(pick ? { pick } : {}) };
    const saved = await keyedCall(ctx, base, opts, "POST", "/avatars", { character: selection });
    const avatar = { ...described(ctx, base, opts, saved, { character: selection }), character: selection };
    if (opts.open) ctx.open(avatar.preview);
    return out({ avatar }, [avatar.avatarKey, `  picture  ${avatar.picture}`, `  preview  ${avatar.preview}`].join("\n"));
  }
  throw new CliError(`unknown species command "${sub}"; try list or make`);
}

/** `--pick axis=option` against the species' kit: the service keeps only
 *  what its allowlist knows and drops the rest without a word, so a typo is
 *  caught here rather than coming back as the default look */
export function parsePicks(raw, kit, id) {
  if (!raw.length) return null;
  if (!kit) throw new CliError(`${id} has no kit to pick from; only species with a kit in minimoji species list take --pick`);
  const pick = {};
  for (const item of raw) {
    const [axis, option, extra] = item.split("=");
    if (!axis || !option || extra !== undefined) throw new CliError(`--pick takes axis=option, not "${item}"`);
    if (!kit[axis]) throw new CliError(`${id}'s kit has no axis "${axis}"; it has ${Object.keys(kit).join(", ")}`);
    if (!kit[axis].includes(option)) throw new CliError(`${axis} is one of ${kit[axis].join(", ")}, not "${option}"`);
    pick[axis] = option;
  }
  return pick;
}

export async function render(ctx, base, opts, out, [target]) {
  if (!target) throw new CliError("render needs an avatar: a name from minimoji avatars, or the 64-hex key generate or species make printed");
  const size = opts.size == null ? 256 : Number(opts.size);
  if (!RENDER_SIZES.includes(size)) throw new CliError(`--size is one of ${RENDER_SIZES.join(", ")}`);
  const key = await keyFor(ctx, base, target);
  const url = `${base}/avatars/${key}.png?size=${size}${opts.face ? `&face=${encodeURIComponent(opts.face)}` : ""}`;
  let res;
  try { res = await ctx.fetch(url, { redirect: "follow" }); } catch (error) { throw new CliError(`could not reach ${base} (${error?.cause?.code ?? error?.message})`); }
  if (!res.ok) {
    const text = await res.text();
    let why = text.trim().slice(0, 200);
    try { why = JSON.parse(text).error ?? why; } catch { /* the text is the reason */ }
    throw new CliError(`the picture failed (${res.status}): ${why}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!isPNG(bytes)) throw new CliError("the picture route answered with something that is not a PNG");
  const file = resolve(ctx.cwd, opts.out ?? `${AVATAR_KEY.test(target) ? key.slice(0, 12) : target}-${size}.png`);
  await writeFile(file, bytes);
  return out({ file, bytes: bytes.length, url }, `Wrote ${file} (${bytes.length} bytes).`);
}

export async function preview(ctx, base, opts, out, [target]) {
  if (!target) throw new CliError("preview needs an avatar (a name or a key) or a document's .json file");
  let source;
  // a name has no dot or slash; a file nearly always has one
  if (AVATAR_KEY.test(target)) source = { avatarKey: target };
  else if (!/[./\\]/.test(target)) source = { avatarKey: await keyFor(ctx, base, target) };
  else {
    let text;
    try { text = await readFile(resolve(ctx.cwd, target), "utf8"); } catch (e) { throw new CliError(`${target} is neither an avatar key nor a readable file (${e.code})`); }
    try { source = { doc: JSON.parse(text) }; } catch { throw new CliError(`${target} is not JSON`); }
  }
  const url = await previewFor(ctx, base, opts, source);
  if (!opts["no-browser"]) ctx.open(url);
  return out({ url }, url);
}

/** the site reads saved avatars from production, so a key on any other
 *  deployment is shown by its document in the fragment instead, which the
 *  browser never uploads */
const keyPreviewable = (ctx, base, opts) => base === BASES.prod || Boolean(opts.site || ctx.env.MINIMOJI_SITE);

/** the preview page for a saved avatar or a document, fetching a key's
 *  document when the site could not read it itself */
export async function previewFor(ctx, base, opts, source) {
  if (source.avatarKey && !keyPreviewable(ctx, base, opts)) source = { doc: (await call(ctx, base, "GET", `/avatars/${source.avatarKey}.json`)).data };
  return previewURL(ctx, opts, source);
}

/** apps/web/lib/preview.ts previewURL: the key in the path, a document in the fragment */
export function previewURL(ctx, opts, source) {
  const site = resolveSite(opts, ctx.env);
  const q = new URLSearchParams();
  if (opts.face && opts.face !== "neutral") q.set("face", opts.face);
  if (opts.body) q.set("body", "1");
  const query = q.size ? `?${q}` : "";
  if (source.avatarKey) return `${site}/preview/${source.avatarKey}${query}`;
  const param = encodeDoc(source.doc);
  if (param.length > MAX_DOC_PARAM) throw new CliError(`this document is too big for a preview link (${Math.ceil(param.length / 1024)} KB of ${MAX_DOC_PARAM / 1024} KB)`);
  return `${site}/preview${query}#doc=${param}`;
}

/** base64url of the JSON, as apps/web/lib/preview.ts encodePreviewDoc writes it */
export function encodeDoc(doc) {
  return Buffer.from(JSON.stringify(doc), "utf8").toString("base64url");
}

/** a just-saved avatar's URLs; its preview needs no second request, the document is in hand */
function described(ctx, base, opts, saved, doc) {
  const source = keyPreviewable(ctx, base, opts) ? { avatarKey: saved.avatarKey } : { doc };
  return { avatarKey: saved.avatarKey, picture: `${saved.png}?size=256`, json: saved.json, glb: saved.glb, preview: previewURL(ctx, opts, source) };
}

function optionalInt(raw, flag) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 31 - 1) throw new CliError(`${flag} must be a whole number from 0 to ${2 ** 31 - 1}`);
  return n;
}

/** kai.json, then kai-2.json, kai-3.json… when a run makes several */
function numbered(file, i, count) {
  if (count === 1 || i === 0) return file;
  const ext = extname(file);
  return `${file.slice(0, file.length - ext.length)}-${i + 1}${ext}`;
}

const isPNG = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJPEG = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const oneLine = (notes) => (Array.isArray(notes) ? notes.join("; ") : typeof notes === "string" ? notes : JSON.stringify(notes));
