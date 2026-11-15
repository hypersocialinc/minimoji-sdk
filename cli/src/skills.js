// THE AGENT SKILLS — `minimoji skills` copies the public skills
// (hypersocialinc/minimoji-sdk, `skills/<name>/…`) into the project where
// the coding agent reads skills, so the agent that ran the CLI knows how to
// use Minimoji afterwards. They are fetched at a commit, not bundled, so a
// skill changes without a CLI release; each SKILL.md records that commit in
// a `minimoji-source:` frontmatter line, which is how `update` tells a stale
// copy from a current one.
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { CliError } from "./service.js";
import { table } from "./auth.js";

export const SKILLS_REPO = "hypersocialinc/minimoji-sdk";
// the repo was minimoji-skills before it held the CLI too: a copy stamped with
// the old name is still ours (GitHub redirects the old name; the commits are the same)
const OURS = new Set([SKILLS_REPO, "hypersocialinc/minimoji-skills"]);
/** where each agent reads a project's skills */
export const AGENT_DIRS = { claude: ".claude/skills", codex: ".agents/skills" };
const SOURCE_LINE = /^minimoji-source:\s*(\S+)@([0-9a-f]{40})\s*$/m;
const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

const api = (ctx) => (ctx.env.MINIMOJI_SKILLS_API ?? "https://api.github.com").replace(/\/$/, "");
const raw = (ctx) => (ctx.env.MINIMOJI_SKILLS_RAW ?? "https://raw.githubusercontent.com").replace(/\/$/, "");

/** `--agent`, else what the project already has (.claude/ → Claude Code;
 *  AGENTS.md, .agents/ or .codex/ → Codex), else Claude Code */
export async function detectAgent(ctx, opts) {
  if (opts.agent) {
    if (!AGENT_DIRS[opts.agent]) throw new CliError(`--agent is ${Object.keys(AGENT_DIRS).join(" or ")}`);
    return opts.agent;
  }
  // turbopackIgnore: the hosted connector (apps/web) bundles this file, and a
  // path from ctx.cwd would otherwise trace the whole repo into its function
  if (await exists(join(/* turbopackIgnore: true */ ctx.cwd, ".claude"))) return "claude";
  for (const marker of ["AGENTS.md", ".agents", ".codex"]) if (await exists(join(/* turbopackIgnore: true */ ctx.cwd, marker))) return "codex";
  return "claude";
}

async function get(ctx, url, accept) {
  const headers = { Accept: accept, "User-Agent": "minimoji-cli" };
  // a token lifts GitHub's 60-an-hour anonymous limit; it goes to GitHub only
  if (ctx.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/")) headers.Authorization = `Bearer ${ctx.env.GITHUB_TOKEN}`;
  let res;
  try { res = await ctx.fetch(url, { headers }); } catch (error) { throw new CliError(`could not reach ${new URL(url).origin} (${error?.cause?.code ?? error?.message})`); }
  if (!res.ok) throw new CliError(`fetching ${url} failed (${res.status})${res.status === 403 ? "; GitHub's rate limit? set GITHUB_TOKEN" : ""}`);
  return res;
}

/** `--ref` (a branch, tag or commit), else main, as the commit it names */
export async function resolveRef(ctx, opts) {
  const ref = opts.ref ?? ctx.env.MINIMOJI_SKILLS_REF ?? "main";
  if (SHA.test(ref)) return ref;
  const sha = (await (await get(ctx, `${api(ctx)}/repos/${SKILLS_REPO}/commits/${encodeURIComponent(ref)}`, "application/vnd.github.sha")).text()).trim();
  if (!SHA.test(sha)) throw new CliError(`${SKILLS_REPO} has no ref "${ref}"`);
  return sha;
}

/** the skills at a commit: name → the files under skills/<name>/ */
export async function availableSkills(ctx, sha) {
  const tree = await (await get(ctx, `${api(ctx)}/repos/${SKILLS_REPO}/git/trees/${sha}?recursive=1`, "application/vnd.github+json")).json();
  if (tree.truncated) throw new CliError(`GitHub cut ${SKILLS_REPO}'s file list short; the skills cannot be installed whole`);
  const skills = new Map();
  for (const entry of tree.tree ?? []) {
    const m = entry.type === "blob" && entry.path.match(/^skills\/([^/]+)\/(.+)$/);
    if (!m || !NAME.test(m[1]) || m[2].split("/").some((part) => part === ".." || part === "" || part.includes("\\"))) continue;
    if (!skills.has(m[1])) skills.set(m[1], []);
    skills.get(m[1]).push(m[2]);
  }
  for (const [name, files] of skills) if (!files.includes("SKILL.md")) skills.delete(name);
  return skills;
}

/** one skill's SKILL.md at `--ref` (else main), as text: what `minimoji mcp`
 *  serves as a resource, so an agent reads the guide without installing it */
export async function skillText(ctx, name, opts = {}) {
  if (!NAME.test(name)) throw new CliError(`"${name}" is not a skill name`);
  const sha = await resolveRef(ctx, opts);
  return stampSource(await (await get(ctx, `${raw(ctx)}/${SKILLS_REPO}/${sha}/skills/${name}/SKILL.md`, "text/markdown, */*")).text(), sha);
}

/** a SKILL.md with the commit it came from in its frontmatter */
export function stampSource(text, sha) {
  const line = `minimoji-source: ${SKILLS_REPO}@${sha}`;
  if (SOURCE_LINE.test(text)) return text.replace(SOURCE_LINE, line);
  // last in the frontmatter, so name and description stay first
  const fm = text.match(/^---\r?\n[\s\S]*?\n(?=---\r?\n)/);
  return fm ? `${fm[0]}${line}\n${text.slice(fm[0].length)}` : `---\n${line}\n---\n\n${text}`;
}

// what minimoji wrote into a skill folder, file by file: an update replaces the folder only when every
// file is still as minimoji wrote it, so a creator's own edits are never overwritten silently
const MANIFEST = ".minimoji-skill.json";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// what an OS or an editor drops into any folder: never a creator's edit
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.[^/]*\.sw[a-p]|[^/]*~|\.#[^/]*)$/;

async function filesUnder(root, at = root) {
  const out = [];
  for (const e of await readdir(at, { withFileTypes: true }).catch(() => [])) {
    const p = join(at, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(root, p));
    else out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

/** what minimoji wrote for a pre-manifest copy: the files at its stamped commit (SKILL.md stamped) */
async function legacyManifest(ctx, target, name) {
  const text = await readFile(join(target, "SKILL.md"), "utf8").catch(() => null);
  const m = text?.match(SOURCE_LINE);
  if (!m || !OURS.has(m[1])) return null;
  // ours, but what was written cannot be rebuilt (the commit or a file is gone, or the fetch fails):
  // unverifiable, so it is treated as changed — refused unless --force, never replaced silently
  const unverifiable = { unverifiable: true };
  try {
    const files = (await availableSkills(ctx, m[2])).get(name);
    if (!files) return unverifiable;
    const written = {};
    for (const file of files) {
      const res = await get(ctx, `${raw(ctx)}/${SKILLS_REPO}/${m[2]}/skills/${name}/${file}`, "*/*");
      const bytes = Buffer.from(await res.arrayBuffer());
      written[file] = hash(file === "SKILL.md" ? Buffer.from(stampSource(bytes.toString("utf8"), m[2])) : bytes);
    }
    return { files: written, legacyRef: m[2] };
  } catch { return unverifiable; }
}

/** the files in an installed skill that differ from what minimoji wrote (edited, added or removed);
 *  a copy from before the manifest existed answers [] (nothing to compare against) */
export async function modifiedFiles(target, { ctx = null, name = null } = {}) {
  let manifest = JSON.parse(await readFile(join(target, MANIFEST), "utf8").catch(() => "null"));
  // a copy from before the manifest existed: rebuild what minimoji wrote from the commit it is stamped with
  if (!manifest?.files && ctx && name) manifest = await legacyManifest(ctx, target, name);
  if (manifest?.unverifiable) return ["(an older copy minimoji cannot check against the commit it came from)"];
  if (!manifest?.files) return [];
  const changed = [];
  const now = (await filesUnder(target)).filter((f) => f !== MANIFEST && !JUNK.test(f));
  for (const f of now) {
    const want = manifest.files[f];
    if (!want) { changed.push(`${f} (added)`); continue; }
    let bytes = await readFile(join(target, f));
    // a legacy copy's stamp line may name the repo's old name: compare the content, not the provenance line
    if (manifest.legacyRef && f === "SKILL.md") bytes = Buffer.from(stampSource(bytes.toString("utf8"), manifest.legacyRef));
    if (hash(bytes) !== want) changed.push(f);
  }
  for (const f of Object.keys(manifest.files)) if (!now.includes(f)) changed.push(`${f} (removed)`);
  return changed;
}

/** every file is fetched before the old copy is touched, and the stamped
 *  SKILL.md is written last: a failed download leaves the old skill whole,
 *  and a half-written one is never stamped current */
async function install(ctx, dir, name, files, sha, { force = false } = {}) {
  const target = join(dir, name);
  const changed = await modifiedFiles(target, { ctx, name });
  if (changed.length && !force) throw new CliError(`${target} has changes you made (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}); nothing was replaced. Move them aside, or pass --force to replace them`);
  const fetched = [];
  for (const file of files) {
    const res = await get(ctx, `${raw(ctx)}/${SKILLS_REPO}/${sha}/skills/${name}/${file}`, "*/*");
    fetched.push([file, Buffer.from(await res.arrayBuffer())]);
  }
  const skillMD = fetched.find(([f]) => f === "SKILL.md");
  await rm(target, { recursive: true, force: true });
  const written = {};
  for (const [file, bytes] of [...fetched.filter((e) => e !== skillMD), skillMD]) {
    const path = join(target, file);
    await mkdir(dirname(path), { recursive: true });
    const out = file === "SKILL.md" ? Buffer.from(stampSource(bytes.toString("utf8"), sha)) : bytes;
    await writeFile(path, out);
    written[file] = hash(out);
  }
  await writeFile(join(target, MANIFEST), `${JSON.stringify({ source: `${SKILLS_REPO}@${sha}`, files: written }, null, 2)}\n`);
  return { name, dir: target, ref: sha };
}

/** a folder of that name that this CLI did not install is someone's own skill */
async function refuseForeign(target) {
  const text = await readFile(join(target, "SKILL.md"), "utf8").catch(() => null);
  const ours = OURS.has(text?.match(SOURCE_LINE)?.[1]);
  if (!ours && (await exists(target))) throw new CliError(`${target} exists and was not installed by minimoji; move it away first`);
}

/** the Minimoji skills installed in a project, across every agent's folder */
export async function installedSkills(ctx) {
  const found = [];
  for (const [agent, rel] of Object.entries(AGENT_DIRS)) {
    const dir = join(ctx.cwd, rel);
    for (const name of await readdir(dir).catch(() => [])) {
      const text = await readFile(join(dir, name, "SKILL.md"), "utf8").catch(() => null);
      const m = text?.match(SOURCE_LINE);
      if (m && OURS.has(m[1])) found.push({ name, agent, dir: join(dir, name), ref: m[2] });
    }
  }
  return found;
}

export async function addSkills(ctx, opts, names) {
  const agent = await detectAgent(ctx, opts);
  const sha = await resolveRef(ctx, opts);
  const available = await availableSkills(ctx, sha);
  const wanted = names.length ? names : [...available.keys()];
  const missing = wanted.filter((n) => !available.has(n));
  if (missing.length) throw new CliError(`no skill ${missing.map((n) => `"${n}"`).join(", ")} in ${SKILLS_REPO}; it has ${[...available.keys()].join(", ") || "none"}`);
  const dir = join(/* turbopackIgnore: true */ ctx.cwd, AGENT_DIRS[agent]);
  const installed = [];
  for (const name of wanted) await refuseForeign(join(/* turbopackIgnore: true */ dir, name));
  for (const name of wanted) installed.push(await install(ctx, dir, name, available.get(name), sha, { force: !!opts.force }));
  return { agent, ref: sha, installed };
}

export async function skills(ctx, _base, opts, out, [sub, ...names]) {
  if (sub === "list" || sub === undefined) {
    const sha = await resolveRef(ctx, opts);
    const available = await availableSkills(ctx, sha);
    const installed = await installedSkills(ctx);
    const rows = [...available.keys()].map((name) => {
      const here = installed.filter((s) => s.name === name);
      return { name, installed: here.map((s) => ({ agent: s.agent, ref: s.ref, current: s.ref === sha })) };
    });
    const state = (r) => r.installed.length ? r.installed.map((i) => `${i.agent} ${i.current ? "current" : `stale (${i.ref.slice(0, 7)})`}`).join(", ") : "not installed";
    return out({ ref: sha, skills: rows }, `${SKILLS_REPO}@${sha.slice(0, 7)}\n\n${table([["SKILL", "HERE"], ...rows.map((r) => [r.name, state(r)])])}`);
  }
  if (sub === "add") {
    const r = await addSkills(ctx, opts, names);
    return out(r, r.installed.map((s) => `Installed ${s.name} (${SKILLS_REPO}@${sha7(s.ref)}) in ${s.dir}`).join("\n"));
  }
  if (sub === "update") {
    const sha = await resolveRef(ctx, opts);
    let installed = await installedSkills(ctx);
    if (names.length) installed = installed.filter((s) => names.includes(s.name));
    if (!installed.length) return out({ ref: sha, updated: [], current: [] }, "No Minimoji skills installed here; minimoji skills add installs them.");
    const available = await availableSkills(ctx, sha);
    const updated = [], current = [], gone = [];
    const todo = installed.filter((s) => s.ref !== sha && available.has(s.name));
    // every skill is checked BEFORE any is replaced: an edited one stops the update with nothing changed
    if (!opts.force) {
      const edited = [];
      for (const s of todo) { const changed = await modifiedFiles(s.dir, { ctx, name: s.name }); if (changed.length) edited.push(`${s.name} for ${s.agent} (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", …" : ""})`); }
      if (edited.length) throw new CliError(`nothing was updated: you changed ${edited.join("; ")}. Move your changes aside, or pass --force to replace them`);
    }
    for (const s of installed) {
      if (s.ref === sha) current.push(s);
      else if (!available.has(s.name)) gone.push(s);
      else updated.push({ ...(await install(ctx, dirname(s.dir), s.name, available.get(s.name), sha, { force: true })), agent: s.agent, from: s.ref });
    }
    const lines = [
      ...updated.map((s) => `Updated ${s.name} for ${s.agent}: ${sha7(s.from)} → ${sha7(s.ref)}`),
      ...current.map((s) => `${s.name} for ${s.agent} is current (${sha7(s.ref)})`),
      ...gone.map((s) => `${s.name} is no longer in ${SKILLS_REPO}; left as it is`),
    ];
    return out({ ref: sha, updated, current, gone }, lines.join("\n"));
  }
  throw new CliError(`unknown skills command "${sub}"; try list, add or update`);
}

const sha7 = (sha) => sha.slice(0, 7);
async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}
