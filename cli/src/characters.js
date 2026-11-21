// minimoji characters — make your own character from source, locally, with no account:
//   create <dir> --template human|creature|robot   scaffold an original starter (never overwrites)
//   dev [--project <dir>]                           the workbench: live head, moods, speech, angles
//   validate [--project <dir>] [--target web|swift|hyperdecks]
//   pack [--project <dir>] --out <dir>              runtime/ + source/ + review/, swapped in atomically
// The compiler lives in @minimoji/authoring, resolved from the character project (its own
// pinned dependency), so this CLI stays dependency-free. Exit codes: 0 done, 1 the project or
// pack failed validation, 2 a bad invocation or a tool failure. --json: one object on stdout.
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CliError, requireSession, sessionCall } from "./service.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { hyperdecksNeeds, hyperdecksVersion, importArgs, receipt, runHyperdecks, supportedHyperdecks, verifyImport } from "./hyperdecks.js";
import { readFileSync } from "node:fs";

/** the head file's own meta (bake version and face nodes), from its JSON chunk; the file was already validated */
const glbMeta = (bytes) => {
  const view = new DataView(bytes.buffer ?? bytes, bytes.byteOffset ?? 0), len = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.buffer ?? bytes, (bytes.byteOffset ?? 0) + 20, len)));
  return json.nodes.find((n) => n.name === "minimoji").extras.minimoji;
};
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;   // the CLI that runs create

const usageError = (message) => Object.assign(new CliError(message), { exitCode: 2 });
const SUB = ["create", "dev", "validate", "pack", "unpack", "mesh", "contribute"];
// the private library on the signed-in account (convex/lib/customCharacters.ts)
const ACCOUNT = ["save", "list", "revisions", "pull", "restore", "archive", "delete", "grant", "grants", "revoke", "export"];

/** @minimoji/authoring's tooling: MINIMOJI_AUTHORING, then the project's install, then a Minimoji checkout.
 *  `avoid` is a pack being validated: a pack is data from anyone, so no toolkit file whose REAL path lies
 *  inside it is ever imported, whichever (symlinked) folder or node_modules link led there */
export async function loadAuthoring(ctx, project, { avoid = null } = {}) {
  // .native: the folder's real case too (a case-insensitive disk would let ../PACK escape the check)
  const real = (path) => { try { return realpathSync.native(path); } catch { return resolve(path); } };
  const forbidden = avoid ? real(avoid) : null;
  const inside = (path) => forbidden && (real(path) === forbidden || real(path).startsWith(forbidden + sep));
  const safe = (file) => {
    if (inside(file)) throw usageError(`refusing to load the authoring toolkit from inside the pack being validated (${file}); run from outside it`);
    return file;
  };
  if (ctx.env.MINIMOJI_AUTHORING) {
    const file = join(resolve(ctx.cwd, ctx.env.MINIMOJI_AUTHORING), "src", "tooling.js");
    if (!existsSync(file)) throw usageError(`MINIMOJI_AUTHORING points at ${ctx.env.MINIMOJI_AUTHORING}, which has no src/tooling.js`);
    return import(pathToFileURL(safe(file)).href);
  }
  const candidates = [];
  for (const from of [project, ctx.cwd].filter((dir) => dir && !inside(dir))) {
    try { candidates.push(createRequire(join(from, "package.json")).resolve("@minimoji/authoring/tooling")); }
    catch (error) {
      if (error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") throw usageError(`the @minimoji/authoring installed in ${from} is too old for this CLI (no ./tooling); update it`);
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  const checkout = fileURLToPath(new URL("../../authoring/src/tooling.js", import.meta.url));
  if (existsSync(checkout)) candidates.push(checkout);
  // a candidate resolving (through any link) back into the pack is skipped, never imported
  for (const file of candidates) if (existsSync(file) && !inside(file)) return import(pathToFileURL(real(file)).href);
  throw usageError("@minimoji/authoring is not installed in this project; run npm install in the character folder (or set MINIMOJI_AUTHORING)");
}

// what a variant costs to build (full detail), beside what it costs to draw; ms is this machine's, information only
const buildLine = (b) => b ? `    build: ${b.rays} rays, ${b.plates} plates, ${(b.plateBytes / 1e6).toFixed(1)} MB extruded (${b.plateVertices} vertices)${b.subdivide ? `, skull subdivide ${b.subdivide}` : ""}, ${b.ms} ms on this machine` : null;
const line = (d) => `  ${d.severity === "warning" ? "warn" : "error"} ${d.code}${d.variant ? ` [${d.variant}]` : ""}${d.path ? ` at ${d.path}` : ""}: ${d.message}${d.hint ? `\n        → ${d.hint}` : ""}`;

export async function characters(ctx, _base, opts, out, positionals) {
  const [sub, ...rest] = positionals;
  if (ACCOUNT.includes(sub)) return account(ctx, _base, opts, out, sub, rest);
  if (!SUB.includes(sub)) throw usageError(`characters needs one of: ${[...SUB, ...ACCOUNT].join(", ")}`);
  const project = resolve(ctx.cwd, opts.project ?? rest[0] ?? (sub === "create" ? "" : "."));
  const target = opts.target ?? "web";
  const json = (data) => { ctx.stdout(`${JSON.stringify(data, null, 2)}\n`); };
  const fail = (code, data, human) => { if (opts.json) json(data); else ctx.stderr(`${human}\n`); return code; };
  // two modes: `validate <dir>` checks an ARTIFACT (a pack: data only, from anyone); source (character.config.js,
  // trusted local code) compiles only with --project or the current folder
  if (sub === "unpack" && (!rest[0] || !(rest[1] ?? opts.out))) throw usageError("characters unpack needs a pack and a new folder: minimoji characters unpack my-character/dist/character restored");
  const artifact = (sub === "validate" && rest[0] != null && opts.project == null) || sub === "unpack";
  const isPack = artifact || (sub === "validate" && existsSync(join(project, "runtime", "manifest.json")));
  if (artifact && !existsSync(join(project, "runtime", "manifest.json")))
    return fail(1, { ok: false, kind: "pack", diagnostics: [{ code: "manifest-missing", severity: "error", message: `${rest[0]} is not a character pack (no runtime/manifest.json)`,
      hint: "positional validate checks packs only and never runs code; to compile a source project use --project <dir>" }] },
      `  error manifest-missing: ${rest[0]} is not a character pack (no runtime/manifest.json)\n        → to compile a source project use --project <dir>`);
  let A;
  try { A = await loadAuthoring(ctx, sub === "create" || sub === "mesh" || isPack ? null : project, { avoid: isPack ? project : null }); }
  catch (error) { if (error.exitCode) throw error; throw usageError(error.message); }
  const asDiag = (error) => (A.toDiagnostic ? A.toDiagnostic(error, "tool-failed", { projectDir: project }) : { code: "tool-failed", severity: "error", message: String(error?.message ?? error) });
  try {
    if (sub === "create") {
      if (!rest[0] && !opts.project) throw usageError("characters create needs a folder name: minimoji characters create my-character --template human");
      const created = await A.createProject(project, { template: opts.template ?? "human", cliVersion: VERSION, ...(opts.id ? { id: opts.id } : {}) });
      const next = [`cd ${rest[0] ?? opts.project}`, "npm install", "npx minimoji characters dev"];
      return out({ ok: true, ...created, installed: false, next },
        `Created ${created.template} character ${created.id} in ${project}\nNothing was installed. Next:\n${next.map((c) => `  ${c}`).join("\n")}`);
    }
    if (sub === "contribute") {
      // A LOCAL BUNDLE for a maintainer's review: nothing is uploaded, no pull request is opened
      if (!opts.out) throw usageError("characters contribute needs --out <folder>: minimoji characters contribute --kind character --author \"Name\" --license CC-BY-4.0 --evidence review --out dist/contribution");
      const result = await A.prepareContribution(project, resolve(ctx.cwd, opts.out), { kind: opts.kind, part: opts.part ?? null, author: opts.author, license: opts.license,
        references: opts.references ?? null, evidence: opts.evidence ? resolve(ctx.cwd, opts.evidence) : null, cliVersion: VERSION });
      if (!result.ok) return fail(1, { ok: false, diagnostics: result.diagnostics }, result.diagnostics.map(line).join("\n"));
      const c = result.contribution;
      const data = { ok: true, out: result.out, digest: c.digest, kind: c.kind, part: c.part ?? null, pack: c.pack, checks: c.checks, evidence: c.evidence.length, uploaded: false };
      return out(data, [`prepared a ${c.kind} contribution → ${opts.out} (digest ${c.digest})`, `  pack ${c.pack.digest}`, ...c.checks.targets.map((t) => `  ${t.target}: ${t.ok ? "valid" : "INVALID"}`),
        `  ${c.evidence.length} evidence image(s), each bound to this build`, "Nothing was uploaded and no pull request was opened. Read README.md in the bundle for the next steps."].join("\n"));
    }
    if (sub === "mesh") {
      // MESH PREPARATION: a generated or sculpted OBJ/GLB → a data-only prepared mesh for parts/,
      // cleaned up and normalised deterministically, with its provenance; nothing in the file runs
      const input = rest[0], dest = opts.out;
      if (!input || !dest) throw usageError("characters mesh needs a file and --out: minimoji characters mesh horn.obj --out parts/horn.mesh.json [--up z]");
      const to = resolve(ctx.cwd, dest);
      if (existsSync(to) && !opts.force) throw usageError(`${dest} exists; pass --force to replace it`);
      let bytes;
      try { bytes = await readFile(resolve(ctx.cwd, input)); } catch (error) { throw usageError(`cannot read ${input}: ${error.code ?? error.message}`); }
      let prepared;
      try { prepared = A.prepareMesh(bytes, { up: opts.up ?? "y", name: input.split(/[\\/]/).pop(), ...(opts["max-verts"] != null ? { maxVerts: /^[0-9]+$/.test(opts["max-verts"]) ? Number(opts["max-verts"]) : NaN } : {}) }); }
      catch (error) { const d = asDiag(error); return fail(1, { ok: false, diagnostics: [d] }, line(d)); }
      await writeFile(to, `${JSON.stringify(prepared)}\n`);
      const data = { ok: true, out: to, verts: prepared.verts.length, faces: prepared.faces.length, provenance: prepared.provenance };
      return out(data, [`prepared ${input} → ${dest}: ${data.verts} vertices, ${data.faces} triangles`, ...prepared.provenance.operations.map((o) => `  ${o}`),
        ...prepared.provenance.stripped.map((x) => `  not carried: ${x}`), `  place it: placeMesh({ id, mesh, at: ctx.surface(...), size: ctx.u * … })`].join("\n"));
    }
    if (sub === "unpack") {
      // LOCAL RESTORE: a pack's source back into a new, empty folder. The pack is checked as an
      // artifact first (data only: nothing in it runs), then every source file is written
      // byte-verified against the pack's source manifest
      const dest = rest[1] ?? opts.out;
      if (!rest[0] || !dest) throw usageError("characters unpack needs a pack and a new folder: minimoji characters unpack my-character/dist/character restored");
      const checked = await A.validatePack(project, { target });
      if (!checked.ok) return fail(1, { ok: false, kind: "pack", diagnostics: checked.diagnostics }, checked.diagnostics.map(line).join("\n"));
      const to = resolve(ctx.cwd, dest);
      const restored = await A.restoreArchive(await A.sourceArchive(project), to);
      const next = [`cd ${dest}`, "npm install", "npx minimoji characters pack --out dist/character"];
      return out({ ok: true, from: project, to, id: restored.id, files: restored.files, sourceDigest: checked.manifest?.sourceDigest ?? null, next },
        `Unpacked ${restored.id}'s source (${restored.files} files) into ${to}\nNothing was installed or run. Next:\n${next.map((c) => `  ${c}`).join("\n")}`);
    }
    if (sub === "validate") {
      if (!A.profileFor(target)) throw usageError(`unknown --target ${target}; one of ${A.TARGETS.join(", ")}`);
      const pack = isPack;
      let result;
      if (pack) result = await A.validatePack(project, { target });
      else {
        const character = await A.loadCharacter(project);
        await A.listSources(project, character);
        const built = await A.buildVariants(character, { target });
        result = { ok: built.ok, diagnostics: built.diagnostics, profile: A.profileFor(target),
          variants: built.variants.map((v) => ({ id: v.variant, sha256: v.sha256, bytes: v.stats.bytes, vertices: v.stats.vertices, meshes: v.stats.meshes, build: v.stats.build, capabilities: v.capabilities })) };
      }
      const data = { ok: result.ok, kind: pack ? "pack" : "project", target, profile: result.profile, variants: result.variants ?? result.manifest?.variants ?? [], diagnostics: result.diagnostics };
      const human = [`${result.ok ? "valid" : "invalid"} ${pack ? "pack" : "project"} for ${target} (≤ ${result.profile.maxGlbBytes} bytes per GLB, ≤ ${result.profile.maxVariants} variants)`,
        ...data.variants.flatMap((v) => [`  ${v.id}  ${v.sha256}  ${v.bytes} bytes${v.vertices != null ? `, ${v.vertices} vertices in ${v.meshes} meshes` : ""}`, buildLine(v.build)].filter(Boolean)), ...result.diagnostics.map(line)].join("\n");
      if (!result.ok) return fail(1, data, human);
      return out(data, human);
    }
    if (sub === "pack") {
      if (!opts.out) throw usageError("characters pack needs --out <folder>");
      if (!A.profileFor(target)) throw usageError(`unknown --target ${target}; one of ${A.TARGETS.join(", ")}`);
      const dest = resolve(ctx.cwd, opts.out);
      const result = await A.packProject(project, dest, { target });
      const data = { ok: result.ok, out: dest, target, digest: result.manifest?.digest ?? null, sourceDigest: result.manifest?.sourceDigest ?? null,
        variants: result.manifest?.variants ?? [], capabilities: result.manifest?.capabilities ?? null, diagnostics: result.diagnostics };
      if (!result.ok) return fail(1, data, [`pack failed; ${dest} was not changed`, ...result.diagnostics.map(line)].join("\n"));
      return out(data, [`packed ${result.manifest.id} → ${dest}`, `  digest ${result.manifest.digest}`,
        ...result.manifest.variants.flatMap((v) => [`  runtime/${v.file}  ${v.bytes} bytes`, buildLine(result.build?.[v.id])].filter(Boolean)), "  source/ (your editable project), review/report.json", ...result.diagnostics.map(line)].join("\n"));
    }
    // dev: runs until interrupted (ctx.signal in tests)
    const port = opts.port == null ? 0 : Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw usageError("--port must be a port number");
    const host = opts.host ?? "127.0.0.1";
    if (!["127.0.0.1", "localhost", "::1"].includes(host) && !opts["allow-remote"]) throw usageError("the workbench binds to this machine only; pass --allow-remote to serve it on another address");
    // the server only answers requests addressed to the exact host it was given (no DNS rebinding), so a
    // wildcard would refuse every visitor; and off-loopback http is not a secure context (no SHA-256 in the page)
    if (["0.0.0.0", "::", "[::]"].includes(host)) throw usageError("--host must be the exact address visitors type (such as your LAN IP), not a wildcard; pages there need https for the head check, so prefer a tunnel to localhost");
    const dev = await A.startDev({ dir: project, port, host, target, runtime: opts.runtime ?? null,
      onEvent: (event) => { if (opts.json) ctx.stdout(`${JSON.stringify(event)}\n`); else if (event.event === "listening") ctx.stdout(`workbench: ${event.url}\n`);
        else if (event.event === "failed") ctx.stderr(`generation ${event.generation} failed${event.keeping ? ` (still showing ${event.keeping})` : ""}:\n${event.diagnostics.map(line).join("\n")}\n`);
        else if (event.event === "built") ctx.stderr(`generation ${event.generation} built\n`);
        else if (event.event === "warning") ctx.stderr(`warning: ${event.message}\n`); } });
    if (!opts["no-browser"]) ctx.open?.(dev.url);
    await new Promise((done) => {
      // an abort that came while the workbench was still starting counts too
      if (ctx.signal?.aborted) return done();
      if (ctx.signal) ctx.signal.addEventListener("abort", done, { once: true });
      else { process.once("SIGINT", done); process.once("SIGTERM", done); }
    });
    await dev.close();
    return 0;
  } catch (error) {
    if (error instanceof CliError) throw error;
    const d = asDiag(error);
    // the project or the pack is at fault (1), not the invocation or the tool (2)
    const code = /^(project-config|source-|define-|part-|build-failed|variant-|color-|glb-|meta-|manifest-|digest-|pack-|path-|editor-|budget-|profile-|capability-|face-|feature-|skull-|mesh-|contribute-(?:evidence|stale-evidence|part|not-rebuildable))/.test(d.code) ? 1 : 2;
    return fail(code, { ok: false, diagnostics: [d] }, line(d));
  }
}

// THE PRIVATE LIBRARY (the signed-in account)
const CHARACTER_ID = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,62}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();

/** a /cli route that sends or returns bytes, with the session (JSON errors read like sessionCall's) */
async function sessionBytes(ctx, base, method, path, { body, headers = {} } = {}) {
  const { session } = await requireSession(ctx, base);
  let res;
  try { res = await ctx.fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${session.token}`, ...headers }, body }); }
  catch (error) { throw new CliError(`could not reach ${base} (${error?.cause?.code ?? error?.message ?? error})`); }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (res.ok) return { res, bytes };
  let why = bytes.toString("utf8").slice(0, 200);
  try { why = JSON.parse(why).error ?? why; } catch { /* not JSON */ }
  throw Object.assign(new CliError(`${method} ${path} failed (${res.status}): ${why}${res.status === 401 ? "; run minimoji login again" : ""}`), { status: res.status });
}

const characterArg = (rest, verb) => {
  const id = rest[0];
  if (!id || !CHARACTER_ID.test(id)) throw usageError(`characters ${verb} needs a character id, like you/name`);
  return id;
};

async function account(ctx, base, opts, out, sub, rest) {
  if (sub === "save") {
    if (!rest[0]) throw usageError("characters save needs the pack folder: minimoji characters save ./dist/character");
    if ((opts.visibility ?? "private") !== "private") throw usageError("a saved character is private; there is no other visibility");
    const pack = resolve(ctx.cwd, rest[0]);
    if (!existsSync(join(pack, "runtime", "manifest.json"))) throw usageError(`${rest[0]} is not a character pack (no runtime/manifest.json); run minimoji characters pack first`);
    // the pack is data: validated by this CLI's own toolkit, never by code inside it
    const A = await loadAuthoring(ctx, null, { avoid: pack });
    const checked = await A.validatePack(pack, { target: "web" });
    if (!checked.ok) {
      const data = { ok: false, diagnostics: checked.diagnostics };
      if (opts.json) ctx.stdout(`${JSON.stringify(data, null, 2)}\n`); else ctx.stderr(`pack is not valid; nothing was uploaded\n${checked.diagnostics.map(line).join("\n")}\n`);
      return 1;
    }
    const manifest = checked.manifest;
    const who = await sessionCall(ctx, base, "GET", "/cli/whoami");
    if (!opts.json) ctx.stderr(`saving ${manifest.id} privately to ${who.email} on ${base}\n`);
    const archive = await A.sourceArchive(pack);
    const upload = async (kind, bytes) => {
      const { bytes: answer } = await sessionBytes(ctx, base, "POST", `/cli/characters/upload?kind=${kind}`, { body: bytes, headers: { "Content-Type": "application/octet-stream", "X-Minimoji-Sha256": sha256(bytes) } });
      return JSON.parse(answer.toString("utf8")).upload;
    };
    const variants = {};
    for (const v of manifest.variants) variants[v.id] = await upload("glb", await readFile(join(pack, "runtime", v.file)));
    const source = await upload("source", archive);
    const saved = await sessionCall(ctx, base, "POST", "/cli/characters/save", { manifest, uploads: { variants, source } });
    const data = { ok: true, outcome: saved.outcome, destination: { account: who.email, base, visibility: "private" }, character: saved.character, revision: saved.revision };
    return out(data, `${saved.outcome === "kept" ? "already saved" : "saved"} ${saved.character.id} revision ${saved.revision.number} (private) to ${who.email}\n  digest ${saved.revision.digest}`);
  }
  if (sub === "list") {
    const { characters } = await sessionCall(ctx, base, "GET", "/cli/characters");
    return out({ characters }, characters.length ? characters.map((c) => `${c.id.padEnd(28)} ${c.status.padEnd(8)} r${c.current?.number ?? "-"} of ${c.revisions}  ${c.current?.capabilities.speech ?? ""}  ${c.name}`).join("\n") : "no characters saved yet (minimoji characters save <pack>)");
  }
  if (sub === "revisions") {
    const id = characterArg(rest, "revisions");
    const r = await sessionCall(ctx, base, "GET", `/cli/characters/revisions?${q({ character: id })}`);
    return out(r, r.revisions.map((x) => `${x.number === r.current ? "*" : " "} r${x.number}  ${x.digest.slice(0, 12)}  v${x.version}  ${new Date(x.createdAt).toISOString()}`).join("\n"));
  }
  if (sub === "pull") {
    const id = characterArg(rest, "pull");
    if (!opts.out) throw usageError("characters pull needs --out <empty folder> for the editable source");
    const { res, bytes } = await sessionBytes(ctx, base, "GET", `/cli/characters/file?${q({ character: id, revision: opts.revision, part: "source" })}`);
    const want = res.headers.get("X-Minimoji-Sha256");
    if (!want || sha256(bytes) !== want) throw new CliError("the downloaded source does not match its sha256; nothing was written");
    const A = await loadAuthoring(ctx, null);
    const dest = resolve(ctx.cwd, opts.out);
    const restored = await A.restoreArchive(bytes, dest);
    return out({ ok: true, character: id, revision: Number(res.headers.get("X-Minimoji-Revision")), out: dest, files: restored.files, sha256: want, installed: false, ran: false },
      `restored ${id} revision ${res.headers.get("X-Minimoji-Revision")} into ${dest} (${restored.files} files, byte-verified). Nothing was installed or run.`);
  }
  if (sub === "restore") {
    const id = characterArg(rest, "restore");
    const revision = Number(opts.revision);
    if (!Number.isInteger(revision) || revision < 1) throw usageError("characters restore needs --revision <number>");
    const r = await sessionCall(ctx, base, "POST", "/cli/characters/restore", { character: id, revision });
    return out(r, `${id} now shows revision ${r.current}`);
  }
  if (sub === "archive") {
    const id = characterArg(rest, "archive");
    const r = await sessionCall(ctx, base, "POST", "/cli/characters/archive", { character: id, archived: !opts.undo });
    return out(r, `${id} is ${r.character.status}${opts.undo ? "" : ": apps lose access, no new revisions until --undo"}`);
  }
  if (sub === "delete") {
    const id = characterArg(rest, "delete");
    if (opts.confirm !== id) throw usageError(`deleting is for good: pass --confirm ${id}`);
    const r = await sessionCall(ctx, base, "POST", "/cli/characters/delete", { character: id, confirm: id });
    return out(r, `deleted ${r.deleted} and every revision of it. Copies already exported elsewhere are managed there.`);
  }
  if (sub === "grant") {
    const id = characterArg(rest, "grant");
    if (!opts.label) throw usageError("characters grant needs --label <the app it is for>");
    if (!opts["token-out"]) throw usageError("characters grant needs --token-out <file>: the token is written there (mode 600), never printed");
    const days = opts.days == null ? undefined : Number(opts.days);
    const revision = opts.revision == null || opts.revision === "current" ? "current" : Number(opts.revision);
    // the token is shown once: never make a grant whose token could not be written (it would sit live and lost)
    if (existsSync(resolve(ctx.cwd, opts["token-out"]))) throw usageError(`${opts["token-out"]} already exists; choose a new --token-out file`);
    const made = await sessionCall(ctx, base, "POST", "/cli/characters/grants", { character: id, label: opts.label, revision, ...(days != null ? { days } : {}) });
    const file = resolve(ctx.cwd, opts["token-out"]);
    await writeFile(file, `${made.token}\n`, { mode: 0o600, flag: "wx" });
    await chmod(file, 0o600);
    return out({ ok: true, grant: made.grant, tokenFile: file }, `granted ${made.grant.label} render access to ${id} (${made.grant.revision === "current" ? "current revision" : `revision ${made.grant.revision}`}) ${made.grant.expiresAt == null ? "until you revoke it" : `until ${new Date(made.grant.expiresAt).toISOString()}`}\n  token written to ${file} (keep it secret; revoke with minimoji characters revoke ${made.grant.id})`);
  }
  if (sub === "grants") {
    const id = characterArg(rest, "grants");
    const r = await sessionCall(ctx, base, "GET", `/cli/characters/grants?${q({ character: id })}`);
    return out(r, r.grants.map((g) => `${g.id}  ${g.state.padEnd(7)} ${g.prefix}  ${g.label}  r:${g.revision}  ${g.expiresAt == null ? "until revoked" : `until ${new Date(g.expiresAt).toISOString().slice(0, 10)}`}`).join("\n") || "no grants");
  }
  if (sub === "export") return exportCharacter(ctx, base, opts, out, characterArg(rest, "export"));
  // revoke
  if (!rest[0]) throw usageError("characters revoke needs the grant id (minimoji characters grants <id> lists them)");
  const r = await sessionCall(ctx, base, "POST", "/cli/characters/grants/revoke", { grant: rest[0] });
  return out(r, `revoked ${r.revoked}: the app can no longer load the character (copies it already downloaded are not erased)`);
}

/** a saved revision → Hyperdecks, through its own installed CLI (src/hyperdecks.js) */
async function exportCharacter(ctx, base, opts, out, id) {
  if (opts.to !== "hyperdecks") throw usageError("characters export needs --to hyperdecks (the only destination so far)");
  if (!opts["expect-account"]) throw usageError("characters export needs --expect-account <your Hyperdecks account id> (hyperdecks whoami --json shows it)");
  if (!opts.pack || !/^[a-z0-9]{16,64}$/.test(opts.pack)) throw usageError("characters export needs --pack <an owner-only Hyperdecks pack id: 16-64 lowercase letters and digits> (hyperdecks avatar pack create --json makes one)");
  const env = opts.env ?? "prod";
  if (!["prod", "dev"].includes(env)) throw usageError("--env must be prod or dev");
  if (opts["stock-voice"] != null && !/^stock:[a-z0-9-]{1,40}$/.test(opts["stock-voice"])) throw usageError("--stock-voice must look like stock:warm-guide");
  const revs = await sessionCall(ctx, base, "GET", `/cli/characters/revisions?${q({ character: id })}`);
  const number = opts.revision == null || opts.revision === "current" ? revs.current : Number(opts.revision);
  const rev = revs.revisions.find((r) => r.number === number);
  if (!rev) throw new CliError(`no revision ${opts.revision ?? "current"} of ${id}`);
  const variant = opts.variant ?? rev.defaultVariant;
  const v = rev.variants.find((x) => x.id === variant);
  if (!v) throw usageError(`no variant ${variant}; the revision has ${rev.variants.map((x) => x.id).join(", ")}`);
  const { bytes } = await sessionBytes(ctx, base, "GET", `/cli/characters/file?${q({ character: id, revision: number, variant })}`);
  if (sha256(bytes) !== v.sha256) throw new CliError("the downloaded head does not match its revision's sha256; nothing was exported");
  // checked against Hyperdecks' contract here, before anything leaves this machine
  const A = await loadAuthoring(ctx, null);
  const problems = A.validateHeadBytes(bytes, { target: "hyperdecks" }).filter((d) => d.severity === "error");
  if (problems.length) {
    // judged from the downloaded file's own bindings, before Hyperdecks' CLI is run: nothing is uploaded
    const data = { ok: false, code: problems.some((d) => d.code === "profile-speech-runtime") ? "target-runtime-update-required" : "target-contract", uploaded: false, diagnostics: problems };
    if (opts.json) ctx.stdout(`${JSON.stringify(data, null, 2)}\n`); else ctx.stderr(`this revision does not meet what Hyperdecks can show today; nothing was exported\n${problems.map(line).join("\n")}\n`);
    return 2;
  }
  // the Hyperdecks CLI must fail closed on requirePrivate; an older or unknown one is refused before any import
  const hd = { bin: ctx.env.HYPERDECKS_BIN ?? "hyperdecks", ...(ctx.execFile ? { run: ctx.execFile } : {}), env: ctx.env };
  const { version: cliVersion, missing } = await hyperdecksVersion(hd);
  // what this head needs from the destination, read from the file itself: indicator speech or bake 19 need a newer CLI
  const glb = glbMeta(bytes), needs = hyperdecksNeeds({ bakeVersion: glb.v, speech: A.deriveCapabilities(glb.faces).speech });
  const unsupported = missing ? `the hyperdecks CLI is not installed (${hd.bin})` : supportedHyperdecks(cliVersion, needs);
  if (unsupported) {
    const data = { ok: false, code: missing ? "hyperdecks-missing" : "hyperdecks-unsupported", error: unsupported, hyperdecksCli: cliVersion, needs: needs.min, uploaded: false };
    if (opts.json) ctx.stdout(`${JSON.stringify(data, null, 2)}\n`); else ctx.stderr(`${unsupported}; nothing was exported\n`);
    return 2;
  }
  const dir = await mkdtemp(join(tmpdir(), "minimoji-export-"));
  try {
    const glb = join(dir, `${variant}.glb`), metadata = join(dir, "metadata.json");
    await writeFile(glb, bytes);
    await writeFile(metadata, JSON.stringify({
      name: revs.character.name.slice(0, 80), sha256: v.sha256,
      provenance: `Minimoji character ${id} revision ${number} (${rev.digest.slice(0, 16)}), made with @minimoji/authoring`.slice(0, 300),
      limitations: (rev.limitations ?? []).slice(0, 20), ...(opts["stock-voice"] ? { stockVoice: opts["stock-voice"] } : {}), packId: opts.pack,
    }));
    const want = { env, pack: opts.pack, expectAccount: opts["expect-account"], sha256: v.sha256, bakeVersion: rev.bakeVersion, character: id, revision: number, variant, name: revs.character.name, cliVersion };
    const ran = await runHyperdecks(importArgs({ glb, metadata, pack: opts.pack, expectAccount: opts["expect-account"], env }), hd);
    if (!ran.ok) {
      // never a claimed success: an uncertain upload says so, with the id to check, and that a retry is safe
      const data = { ok: false, error: ran.error, code: ran.code, uploaded: ran.uploaded ?? null, ...(ran.avatarId ? { avatarId: ran.avatarId } : {}),
        ...(ran.uploaded === "maybe" ? { next: "run the same export again: Hyperdecks deduplicates it, and only a verified answer counts as exported" } : {}) };
      if (opts.json) ctx.stdout(`${JSON.stringify(data, null, 2)}\n`);
      else ctx.stderr(`hyperdecks import ${ran.uploaded === "maybe" ? "did not finish verifiably" : "failed"} (${ran.code}): ${ran.error}${ran.avatarId ? `\n  a head may be stored as ${ran.avatarId}; run the same export again (it is deduplicated) to verify it` : ""}\n`);
      return ran.code === "hyperdecks-missing" ? 2 : 1;
    }
    const wrong = verifyImport(ran.answer, want, { cliVersion });
    if (wrong.length) {
      // something may be stored all the same: name it, never call it exported
      const data = { ok: false, code: "export-mismatch", problems: wrong, avatarId: ran.answer.avatarId ?? null, uploaded: ran.answer.avatarId ? "maybe" : null };
      if (opts.json) ctx.stdout(`${JSON.stringify(data, null, 2)}\n`); else ctx.stderr(`hyperdecks stored something other than what was asked:\n  ${wrong.join("\n  ")}\n`);
      return 1;
    }
    const r = receipt(ran.answer, want);
    return out({ ok: true, receipt: r }, [`exported ${id} revision ${number} to Hyperdecks (${r.account.email ?? r.account.id}) as ${r.avatarId}${r.reused ? " (already there)" : ""}`,
      `  speaker: ${r.speaker}`, `  cameo:   ${r.cameo}`, `  voice:   ${r.stockVoice ?? "none chosen"}`, `  ${r.managedAt}`].join("\n"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
