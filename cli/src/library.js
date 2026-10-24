// YOUR AVATAR LIBRARY — the avatars this account made or kept, by the names
// it gave them, over the session routes /cli/avatars* (convex/http.ts). A
// name works wherever a key does: `render kai`, `preview kai`, `avatars get kai`.
import { writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { CliError, call, readCredentials, sessionCall } from "./service.js";
import { table } from "./auth.js";

export const AVATAR_KEY = /^[0-9a-f]{64}$/;
/** convex/lib/library.ts NAME_PATTERN: the server checks it too */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MIN_PREFIX = 8;

export function checkName(name, flag = "--name") {
  if (!NAME_PATTERN.test(name)) throw new CliError(`${flag} "${name}" is not a name: use 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit`);
  return name;
}

/** convex/lib/library.ts slugify: a prompt's words as a name, cut at a dash */
export function slugify(text, max = 24) {
  let slug = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > max) {
    const cut = slug.slice(0, max + 1).lastIndexOf("-");
    slug = (cut > 0 ? slug.slice(0, cut) : slug.slice(0, max)).replace(/-+$/, "");
  }
  return slug || null;
}

/** whether this terminal holds a session for the deployment (generate keeps
 *  what it makes only then) */
export async function signedIn(ctx, base) {
  return Boolean((await readCredentials(ctx)).deployments[base]?.token);
}

export async function listLibrary(ctx, base) {
  return (await sessionCall(ctx, base, "GET", "/cli/avatars")).avatars;
}

/** keep a saved avatar: `{avatarKey, name?, suffix?, defaultName?}` as POST /cli/avatars takes it */
export async function keep(ctx, base, body) {
  return sessionCall(ctx, base, "POST", "/cli/avatars", body);
}

/** point the entry `{name}` or `{avatarKey}` at the saved avatar `to`, keeping its name */
export async function repoint(ctx, base, body) {
  return sessionCall(ctx, base, "POST", "/cli/avatars/repoint", body);
}

/** a name, a full key or a unique key prefix (8+) to the entry it means, in
 *  that order. A full key not in the library comes back as `{avatarKey}`
 *  alone when `anyKey`; anything else unresolved is an error naming close names */
export function resolveTarget(target, entries, { anyKey = false } = {}) {
  const named = entries.find((e) => e.name === target);
  if (named) return named;
  if (AVATAR_KEY.test(target)) {
    const kept = entries.find((e) => e.avatarKey === target);
    if (kept || anyKey) return kept ?? { avatarKey: target, name: null };
    throw new CliError(`${target.slice(0, 12)}… is not in your library; minimoji avatars save ${target} keeps it`);
  }
  if (/^[0-9a-f]+$/.test(target) && target.length >= MIN_PREFIX) {
    const hits = entries.filter((e) => e.avatarKey.startsWith(target));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new CliError(`${target} starts ${hits.length} of your avatars' keys (${hits.map((e) => e.name).join(", ")}); type more of it, or a name`);
  }
  const close = closeNames(target, entries.map((e) => e.name));
  throw new CliError(`no avatar named ${target} in your library${close.length ? `; did you mean ${close.join(", ")}?` : entries.length ? "; minimoji avatars lists them" : "; it is empty (minimoji generate or minimoji avatars save adds one)"}`);
}

/** names that contain `target` (or it them), or within an edit or two of it
 *  (one for a short name; a swap of two letters is one edit), closest first */
export function closeNames(target, names, max = 5) {
  const reach = target.length <= 4 ? 1 : 2;
  return names.map((name) => ({ name, d: name.includes(target) || target.includes(name) ? 0.5 : distance(target, name) }))
    .filter((x) => x.d <= reach).sort((a, b) => a.d - b.d || a.name.localeCompare(b.name)).slice(0, max).map((x) => x.name);
}

/** optimal string alignment distance: Levenshtein plus adjacent swaps */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** the key a command was given: a full key as is, anything else through the library */
export async function keyFor(ctx, base, target) {
  if (AVATAR_KEY.test(target)) return target;
  return resolveTarget(target, await listLibrary(ctx, base)).avatarKey;
}

const shortKey = (key) => key.slice(0, 12);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const json = ({ name, avatarKey, kind, createdAt, updatedAt }) => ({ name, avatarKey, kind, createdAt, updatedAt });

export async function avatars(ctx, base, opts, out, [sub = "list", ...rest]) {
  if (sub === "list") {
    const entries = await listLibrary(ctx, base);
    return out({ avatars: entries.map(json) }, entries.length
      ? table([["NAME", "KEY", "KIND", "SAVED"], ...entries.map((e) => [e.name, shortKey(e.avatarKey), e.kind, day(e.createdAt)])])
      : "Your library is empty. minimoji generate adds what it makes; minimoji avatars save <key> keeps any avatar.");
  }
  if (sub === "save") {
    const [key] = rest;
    if (!key || !AVATAR_KEY.test(key)) throw new CliError("avatars save needs an avatar's 64-hex key, e.g. one generate or species make printed");
    const name = opts.name == null ? undefined : checkName(opts.name);
    const { avatar, outcome } = await keep(ctx, base, { avatarKey: key, ...(name ? { name } : {}) });
    return out({ avatar: json(avatar), outcome }, outcome === "kept"
      ? `${avatar.name} is already in your library (${shortKey(avatar.avatarKey)}).`
      : `${outcome === "added" ? "Saved" : "Renamed to"} ${avatar.name} (${shortKey(avatar.avatarKey)}, ${avatar.kind}).`);
  }
  if (sub === "get") {
    const [target] = rest;
    if (!target) throw new CliError("avatars get needs a name or a key");
    const entry = resolveTarget(target, await listLibrary(ctx, base), { anyKey: true });
    const doc = (await call(ctx, base, "GET", `/avatars/${entry.avatarKey}.json`)).data;
    let file = null;
    if (opts.out) {
      file = resolvePath(ctx.cwd, opts.out);
      await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
    }
    return out({ name: entry.name, avatarKey: entry.avatarKey, kind: entry.kind ?? (doc && doc.character ? "species" : "person"), doc, ...(file ? { file } : {}) },
      [entry.avatarKey, file ? `Wrote ${file}.` : JSON.stringify(doc, null, 2)].join("\n"));
  }
  if (sub === "rename") {
    const [target, to] = rest;
    if (!target || !to) throw new CliError("avatars rename needs the avatar (a name or a key) and its new name: minimoji avatars rename kai kai-old");
    checkName(to, "the new name");
    const entry = resolveTarget(target, await listLibrary(ctx, base));
    const { avatar, from } = await sessionCall(ctx, base, "POST", "/cli/avatars/rename", { avatarKey: entry.avatarKey, to });
    return out({ avatar: json(avatar), from }, from === avatar.name ? `${avatar.name} already has that name.` : `Renamed ${from} to ${avatar.name}.`);
  }
  if (sub === "remove") {
    const [target] = rest;
    if (!target) throw new CliError("avatars remove needs a name or a key");
    const entry = resolveTarget(target, await listLibrary(ctx, base));
    const { removed } = await sessionCall(ctx, base, "POST", "/cli/avatars/remove", { avatarKey: entry.avatarKey });
    return out({ removed: json(removed) }, `Removed ${removed.name} from your library. The avatar itself stays saved: ${removed.avatarKey}`);
  }
  throw new CliError(`unknown avatars command "${sub}"; try list, save, get, rename or remove`);
}
