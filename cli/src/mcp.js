// THE MCP SERVER — `minimoji mcp` speaks the Model Context Protocol over
// stdio (JSON-RPC 2.0, one message a line), so an agent in Claude, Cursor or
// any MCP client can do what the commands do: make and edit avatars, read
// the library, set a status, say a line, get a still. Each tool runs the
// command function itself with --json, through the same `ctx`/`out` seam
// main.js uses; the commands stay the one implementation.
//
// It runs as the signed-in terminal (`minimoji login`): no tool takes a key,
// and signing in and minting keys stay in the terminal. Stdout is the
// transport, so a command's own stdout and anything said along the way go to
// stderr. Tools and resources only: no prompts, no sampling, no streaming.
import { access, constants, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { whoami } from "./auth.js";
import { edit, generate, preview, render, species, MAX_PHOTO_BYTES, RENDER_SIZES } from "./avatars.js";
import { AVATAR_KEY, avatars, checkName, keep, signedIn, slugify, status, STATUS_MAX } from "./library.js";
import { lines, LINES_MAX_TEXT } from "./lines.js";
import { BASES, CliError, baseName, call } from "./service.js";
import { skillText } from "./skills.js";
import { lineName, MAX_TEXT, say } from "./voice.js";

/** the newest protocol this server speaks first; an older one a client asks for is spoken as asked */
export const PROTOCOL_VERSION = "2025-06-18";
const PROTOCOL_VERSIONS = [PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];
/** what make_avatar may spend in one call: the CLI's --count goes to 10, an agent's to 3 */
export const MAX_MCP_COUNT = 3;

const RPC = { parse: -32700, invalidRequest: -32600, noMethod: -32601, invalidParams: -32602, internal: -32603, noResource: -32002 };

// ─── the tools ──────────────────────────────────────────────────────────────

const AVATAR = { type: "string", description: "The avatar: a name from list_avatars (kai), or its 64-hex id" };
const FACE = { type: "string", description: "A face to show: neutral, happy, sad, surprised, thinking…" };
const PHOTO = { type: "string", description: "A JPEG or PNG of a face: a local file path, or an https URL (at most 4 MB)" };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

/** name, description (what it spends, so the agent can tell the person),
 *  inputSchema, and plan(args) → the command, its options and positionals */
export const TOOLS = [
  {
    name: "whoami",
    description: "The Minimoji account this terminal is signed in as. Spends nothing.",
    inputSchema: schema({}),
    plan: () => ({ run: whoami }),
  },
  {
    name: "list_avatars",
    description: "The avatars in your library (made with make_avatar, kept from apps), by name. Spends nothing.",
    inputSchema: schema({}),
    plan: () => ({ run: avatars, args: ["list"] }),
  },
  {
    name: "make_avatar",
    description: "Make a Mini avatar from a sentence (\"red curls, round glasses\"), a photo, or both, and keep it in your library. Spends one generation per avatar from today's allowance (500 a day by default); count makes up to 3. Answers each avatar's name, id, picture and preview links.",
    inputSchema: schema({
      description: { type: "string", description: "What the avatar looks like, at most 500 characters" },
      photo: PHOTO,
      name: { type: "string", description: "A library name: lowercase letters, digits and dashes (taken names get -2, -3…)" },
      count: { type: "integer", minimum: 1, maximum: MAX_MCP_COUNT, description: "How many to make, 1 to 3 (default 1)" },
      seed: { type: "integer", minimum: 0, description: "A seed, for a repeatable look" },
    }),
    plan: async (a, photo) => ({
      run: generate, args: a.description ? [a.description] : [],
      opts: { photo, name: a.name, count: a.count == null ? undefined : String(a.count), seed: a.seed == null ? undefined : String(a.seed) },
    }),
    photo: true,
    shape: (data) => ({ ...data, avatars: data.avatars?.map(({ doc, ...a }) => a) }),
  },
  {
    name: "edit_avatar",
    description: "Change an avatar with words (\"make the hair blue\"), a photo, or both. The library name follows the edit unless save_as names a new entry. Spends one generation from today's allowance.",
    inputSchema: schema({
      avatar: AVATAR,
      change: { type: "string", description: "What to change, at most 500 characters" },
      photo: PHOTO,
      save_as: { type: "string", description: "Keep the edit as a new library entry with this name, leaving the original alone" },
    }, ["avatar"]),
    plan: async (a, photo) => ({ run: edit, args: [a.avatar, ...(a.change ? [a.change] : [])], opts: { photo, as: a.save_as } }),
    photo: true,
  },
  {
    name: "list_species",
    description: "The non-human species the service offers (D.A.S.H., aliens, animals, the penguin, the ghost) and the kit of picks each takes. Spends nothing.",
    inputSchema: schema({}),
    plan: () => ({ run: species, args: ["list"] }),
  },
  {
    name: "make_species_avatar",
    description: "Save a species avatar (an id from list_species) with picks from its kit, and keep it in your library. Spends no generation: a species is dealt, not drawn.",
    inputSchema: schema({
      species: { type: "string", description: "A species id from list_species, e.g. alienGrey or dash" },
      picks: { type: "object", additionalProperties: { type: "string" }, description: "Kit picks as axis → option, from list_species (e.g. {\"eyes\": \"big\"})" },
      seed: { type: "integer", minimum: 0, description: "A seed for the options not picked" },
      name: { type: "string", description: "A library name (default: the species id)" },
    }, ["species"]),
    plan: async (a) => {
      if (a.name) checkName(a.name);   // before the save, not after it
      return {
        run: species, args: ["make", a.species],
        opts: { pick: Object.entries(a.picks ?? {}).map(([axis, option]) => `${axis}=${option}`), seed: a.seed == null ? undefined : String(a.seed) },
      };
    },
    after: async (ctx, base, a, data) => {
      // the CLI's species make saves without keeping; an agent wants a name to use next.
      // The avatar is saved either way: a library that refuses it is said, with the id
      try {
        const kept = await keep(ctx, base, { avatarKey: data.avatar.avatarKey, ...(a.name ? { name: a.name, suffix: true } : { defaultName: slugify(a.species) ?? "species" }) });
        return { avatar: { ...data.avatar, name: kept.avatar.name } };
      } catch (error) {
        return { avatar: { ...data.avatar, name: null }, error: `saved ${data.avatar.avatarKey} but could not add it to your library: ${error.message}` };
      }
    },
  },
  {
    name: "get_status",
    description: "An avatar's status: the line every app wearing it shows beside it, with the mood it reads as. Spends nothing.",
    inputSchema: schema({ avatar: AVATAR }, ["avatar"]),
    plan: async (a) => ({ run: status, args: [a.avatar] }),
  },
  {
    name: "set_status",
    description: `Set (or clear) an avatar's status: every app wearing it (Bunch, savethis, …) shows the line, read once for a mood. At most ${STATUS_MAX} characters. Spends one of the day's status changes (300 by default).`,
    inputSchema: schema({
      avatar: AVATAR,
      text: { type: "string", description: `The status, at most ${STATUS_MAX} characters ("back at 3")` },
      clear: { type: "boolean", description: "Clear the status instead" },
    }, ["avatar"]),
    plan: async (a) => {
      if (!a.clear && !a.text?.trim()) throw new CliError("set_status needs text, or clear: true (get_status reads it)");
      return { run: status, args: [a.avatar, ...(a.text ? [a.text] : [])], opts: { clear: a.clear } };
    },
  },
  {
    name: "list_voices",
    description: "The voices say speaks with on Minimoji's voice (dash, person, alien, …), with a hint for each. Spends nothing.",
    inputSchema: schema({}),
    plan: () => ({ run: listVoices }),
  },
  {
    name: "say",
    description: `Turn a sentence into a line the avatar speaks: the audio (a public URL and a .wav written here) and the line with its words and letter timings, which every Minimoji SDK player lip-syncs. Spends the text's characters (at most ${MAX_TEXT} a call) of today's 5,000 on Minimoji's voice; saying the same line again is cached and free. voice_source "elevenlabs" speaks on the person's own ElevenLabs account instead, from ELEVENLABS_API_KEY in this server's environment (never a tool argument).`,
    inputSchema: schema({
      avatar: AVATAR,
      text: { type: "string", description: `The words, at most ${MAX_TEXT} characters; [tags] like [excited] steer the delivery` },
      voice: { type: "string", description: "A voice from list_voices (person, dash, alien…) or an ElevenLabs voice id; default: the avatar's own voice" },
      mood: { type: "string", description: "The line's mood: happy, sad, thinking, surprised…" },
      name: { type: "string", description: "The files' name (default: from the words)" },
      voice_source: { type: "string", enum: ["minimoji", "elevenlabs"], description: "minimoji (default): Minimoji's voice; elevenlabs: the person's own ElevenLabs account, set up in this server's environment" },
    }, ["avatar", "text"]),
    plan: async (a, _photo, outDir) => ({
      run: say, args: [a.avatar, a.text],
      // by default the files are named for the avatar and the words, so two avatars saying "Hi" keep both
      opts: { voice: a.voice, mood: a.mood, name: a.name ?? `${fileStem(a.avatar)}-${lineName(a.text)}`.slice(0, 80), out: outDir, server: a.voice_source !== "elevenlabs" },
    }),
    shape: async (data) => {
      // the line itself rides along, so a web agent needs no file
      // the line was paid for: a file that cannot be read back still answers the URL and the timings
      const line = await readFile(data.line, "utf8").then(JSON.parse, () => null);
      const { line: lineFile, audio: audioFile, audioUrl, words, letters, ...rest } = data;
      return { audio: audioUrl ?? null, audioFile, lineFile, words: words ?? line?.words ?? null, letters: letters ?? line?.letters ?? null, ...rest, line };
    },
  },
  {
    name: "lines",
    description: `A clip you already have (a .wav, .mp3 or .m4a, at most 30 s, any voice) and its text → a line the SDK players lip-sync, with words and letter timings, written here. Without text the clip is transcribed. Spends one of the day's line builds (200 by default).`,
    inputSchema: schema({
      clip: { type: "string", description: "The clip's local file path" },
      text: { type: "string", description: `What the clip says, at most ${LINES_MAX_TEXT} characters (the lips then follow the script)` },
    }, ["clip"]),
    plan: async (a, _photo, outDir, cwd) => {
      // one clip a call: the command reads a folder whole, which would spend a build per clip
      const info = await stat(resolvePath(cwd, a.clip)).catch((e) => { throw new CliError(`cannot read ${a.clip} (${e.code})`); });
      if (!info.isFile()) throw new CliError(`${a.clip} is not a file; lines takes one clip a call`);
      return { run: lines, args: [a.clip], opts: { text: a.text, out: outDir, timings: true } };
    },
    shape: (data) => (data.skipped ? { ...data, error: data.clips?.find((c) => c.status === "skipped" || c.status === "not sent")?.reason ?? "the clip was not written" } : data),
  },
  {
    name: "render_still",
    description: "Download an avatar's still picture as a PNG written here; answers its path and URL. Spends nothing.",
    inputSchema: schema({
      avatar: AVATAR,
      size: { type: "integer", enum: RENDER_SIZES, description: "Pixels square: 64, 128, 256 (default) or 512" },
      face: FACE,
    }, ["avatar"]),
    plan: async (a, _photo, outDir) => ({
      run: render, args: [a.avatar],
      opts: { size: a.size == null ? undefined : String(a.size), face: a.face, out: join(outDir, `${fileStem(a.avatar)}-${a.size ?? 256}${a.face ? `-${slugify(a.face) ?? "face"}` : ""}.png`) },
    }),
  },
  {
    name: "preview_link",
    description: "A minimoji.com link that shows the avatar in 3D, to hand the person. Spends nothing.",
    inputSchema: schema({ avatar: AVATAR, face: FACE, body: { type: "boolean", description: "Show it with a body" } }, ["avatar"]),
    plan: async (a) => {
      // the command also reads a local document; an agent's argument is a name or an id, never a file
      if (/[./\\]/.test(a.avatar)) throw new CliError("preview_link takes an avatar's name or id");
      return { run: preview, args: [a.avatar], opts: { face: a.face, body: a.body, "no-browser": true } };
    },
  },
];

/** an avatar argument as a file name: a name as it is, an id by its first 12 */
const fileStem = (avatar) => (AVATAR_KEY.test(avatar) ? avatar.slice(0, 12) : slugify(avatar) ?? "avatar");

/** GET /lines/voices: the catalogue say names (public, no key) */
async function listVoices(ctx, base, _opts, out) {
  const { voices } = (await call(ctx, base, "GET", "/lines/voices")).data;
  return out({ voices: voices ?? [] });
}

// ─── the resources ──────────────────────────────────────────────────────────

/** the SDK guides `minimoji skills` installs, readable without a file install */
export const RESOURCES = [
  { uri: "minimoji://skill/web", skill: "minimoji-web", name: "minimoji-web", title: "Minimoji web SDK guide", description: "How to add Minimoji heads to a React or Next.js app (@minimoji/react): the SKILL.md `minimoji skills add` installs.", mimeType: "text/markdown" },
  { uri: "minimoji://skill/swift", skill: "minimoji-swift", name: "minimoji-swift", title: "MinimojiKit (Swift) guide", description: "How to add Minimoji heads to an iOS app with MinimojiKit: the SKILL.md `minimoji skills add` installs.", mimeType: "text/markdown" },
];

// ─── arguments ──────────────────────────────────────────────────────────────

/** the arguments against the tool's schema: the types, ranges and names it
 *  lists and nothing else, so a stray `key` argument is refused, not ignored */
export function checkArgs(tool, args) {
  if (args == null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) throw new CliError(`${tool.name} takes an object of arguments`);
  const { properties, required } = tool.inputSchema;
  for (const name of required) if (args[name] == null) throw new CliError(`${tool.name} needs ${name}`);
  for (const [name, value] of Object.entries(args)) {
    const prop = properties[name];
    if (!prop) throw new CliError(`${tool.name} takes no argument "${name}"; it takes ${Object.keys(properties).join(", ") || "none"}`);
    if (value == null) continue;
    const ok = prop.type === "integer" ? Number.isInteger(value)
      : prop.type === "object" ? typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string")
      : typeof value === prop.type;
    if (!ok) throw new CliError(`${tool.name}: ${name} must be ${prop.type === "object" ? "an object of strings" : `a${prop.type === "integer" ? "n" : ""} ${prop.type}`}`);
    if (prop.enum && !prop.enum.includes(value)) throw new CliError(`${tool.name}: ${name} is one of ${prop.enum.join(", ")}`);
    if (prop.minimum != null && value < prop.minimum) throw new CliError(`${tool.name}: ${name} is at least ${prop.minimum}`);
    if (prop.maximum != null && value > prop.maximum) throw new CliError(`${tool.name}: ${name} is at most ${prop.maximum}`);
  }
  return args;
}

/** a photo argument as a file generate and edit can read: a path as it is,
 *  an https URL downloaded to a temp folder (removed by `done`), read no
 *  further than the size generate takes */
async function photoFile(ctx, given) {
  if (!given) return { file: undefined, done: async () => {} };
  if (!/^[a-z]+:\/\//i.test(given)) return { file: given, done: async () => {} };
  if (!webURL(ctx, given)) throw new CliError("photo is a local path or an https URL");
  let res;
  try { res = await ctx.fetch(given, { redirect: "follow" }); } catch (error) { throw new CliError(`could not download the photo (${error?.cause?.code ?? error?.message ?? error})`); }
  // a redirect may not lead off the web (to this machine, another scheme)
  if (res.url && !webURL(ctx, res.url)) throw new CliError("the photo URL redirected somewhere that is not an https URL");
  if (!res.ok) throw new CliError(`could not download the photo (HTTP ${res.status})`);
  const tooBig = () => new CliError(`the photo is over ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
  if (Number(res.headers.get("content-length")) > MAX_PHOTO_BYTES) throw tooBig();
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > MAX_PHOTO_BYTES) { await res.body.cancel?.().catch(() => {}); throw tooBig(); }
    chunks.push(chunk);
  }
  const dir = await mkdtemp(join(tmpdir(), "minimoji-photo-"));
  const done = () => rm(dir, { recursive: true, force: true }).catch((error) => ctx.stderr(`minimoji mcp: could not remove the downloaded photo in ${dir} (${error.code ?? error.message})\n`));
  try {
    const file = join(dir, "photo");
    await writeFile(file, Buffer.concat(chunks));
    return { file, done };
  } catch (error) {
    await done();
    throw new CliError(`could not keep the downloaded photo (${error.code ?? error.message})`);
  }
}

/** https only; plain http to this machine only when MINIMOJI_MCP_LOCAL_URLS is set (the tests) */
function webURL(ctx, url) {
  return /^https:\/\//i.test(url) || (Boolean(ctx.env.MINIMOJI_MCP_LOCAL_URLS) && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url));
}

// ─── running a tool ─────────────────────────────────────────────────────────

const text = (data) => [{ type: "text", text: JSON.stringify(data, null, 2) }];
const failed = (message) => ({ content: [{ type: "text", text: message }], isError: true });

/** one tools/call: the result MCP answers, an error in it when the command
 *  failed (`isError`, the command's one line, never a stack) */
export async function callTool(ctx, base, server, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  // the command's stdout is the transport: it goes to stderr; and no browser opens for an agent
  // paths the agent gives (a photo, a clip) are the client's, read from where the server runs; files written go to outDir
  const toolCtx = { ...ctx, stdout: (s) => ctx.stderr(s), open: () => false };
  let photo = { done: async () => {} };
  try {
    checkArgs(tool, args);
    args ??= {};
    if (!(await signedIn(ctx, base))) throw new CliError(`this terminal is not signed in to Minimoji; run minimoji login${base === BASES.prod ? "" : ` --base ${baseName(base)}`} in a terminal, then call ${name} again`);
    if (tool.photo) photo = await photoFile(ctx, args.photo);
    const plan = await tool.plan(args, photo.file, server.outDir, ctx.cwd);
    let data = null;
    const out = (d) => { data = d; return 0; };
    const code = await plan.run(toolCtx, base, { json: true, ...(server.site ? { site: server.site } : {}), ...plan.opts }, out, plan.args ?? []);
    if (data === null) throw new CliError(`${name} answered nothing`);
    if (tool.after && code === 0) data = await tool.after(toolCtx, base, args, data);
    if (tool.shape) data = await tool.shape(data);
    // a run that failed part way (a generation made, then the quota) answers what it made, as an error
    const isError = code !== 0 || typeof data.error === "string";
    return { content: text(data), structuredContent: data, ...(isError ? { isError: true } : {}) };
  } catch (error) {
    // a bug's stack goes to stderr (the client's log), never into the answer
    if (!(error instanceof CliError)) ctx.stderr(`minimoji mcp: ${name}: ${error?.stack ?? error}\n`);
    return failed((error instanceof CliError ? error.message : `unexpected error: ${error?.message ?? error}`).split("\n")[0]);
  } finally {
    await photo.done();
  }
}

// ─── the protocol ───────────────────────────────────────────────────────────

const INSTRUCTIONS = [
  "Minimoji makes Mini avatars: small 3D heads that talk with lip-sync, show moods and carry a status into every app that wears them.",
  "This server runs as the terminal signed in with `minimoji login`. If a tool says the terminal is not signed in, ask the person to run `minimoji login` in a terminal; signing in and API keys never go through here.",
  "Each tool's description says what it spends (a generation, characters of speech); tell the person before spending much.",
  "Typical flow: make_avatar → set_status or say → preview_link to show it. The resources minimoji://skill/web and minimoji://skill/swift are the SDK guides for putting a head in an app.",
].join(" ");

/** the answer to one request, or null for a notification */
export async function handle(ctx, base, server, message) {
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: Array.isArray(message) ? "batches are not supported; send one message a line" : "a message is a JSON-RPC 2.0 object" } };
  }
  const { id, method, params } = message;
  const isRequest = id !== undefined;
  const hasId = typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
  if (message.jsonrpc !== "2.0" || typeof method !== "string" || (isRequest && !hasId)) {
    // a client's answer to a request of ours (we send none) is not a request
    if (method === undefined && ("result" in message || "error" in message)) return null;
    return { jsonrpc: "2.0", id: hasId ? id : null, error: { code: RPC.invalidRequest, message: "a request is {jsonrpc: \"2.0\", id, method, params?}" } };
  }
  if (!isRequest) return null;   // notifications/initialized, notifications/cancelled, …
  const result = (r) => ({ jsonrpc: "2.0", id, result: r });
  const error = (code, msg) => ({ jsonrpc: "2.0", id, error: { code, message: msg } });
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return result({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "minimoji", title: "Minimoji", version: server.version },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return result({});
    case "tools/list": return result({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      if (typeof params?.name !== "string") return error(RPC.invalidParams, "tools/call needs params.name");
      const answer = await callTool(ctx, base, server, params.name, params.arguments);
      return answer ? result(answer) : error(RPC.invalidParams, `no tool "${params.name}"; tools/list names them`);
    }
    case "resources/list": return result({ resources: RESOURCES.map(({ skill, ...r }) => r) });
    case "resources/templates/list": return result({ resourceTemplates: [] });
    case "resources/read": {
      const resource = RESOURCES.find((r) => r.uri === params?.uri);
      if (!resource) return error(RPC.noResource, `no resource ${params?.uri}; resources/list names them`);
      try {
        return result({ contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: await skillText(ctx, resource.skill) }] });
      } catch (e) {
        return error(RPC.internal, (e instanceof CliError ? e.message : `unexpected error: ${e?.message ?? e}`).split("\n")[0]);
      }
    }
    default: return error(RPC.noMethod, `no method ${method}`);
  }
}

/** where files go: --out, else the folder the server runs in, unless that
 *  is / or cannot be written (Claude Desktop starts servers at /): ~/Minimoji */
async function outFolder(ctx, opts) {
  if (opts.out != null) {
    const dir = resolvePath(ctx.cwd, opts.out);
    await mkdir(dir, { recursive: true }).catch((error) => { throw new CliError(`cannot use --out ${dir} (${error.code ?? error.message})`); });
    return dir;
  }
  const here = resolvePath(ctx.cwd);
  if (here !== resolvePath("/") && await access(here, constants.W_OK).then(() => true, () => false)) return here;
  const home = join(ctx.home, "Minimoji");
  await mkdir(home, { recursive: true });
  return home;
}

/** `minimoji mcp`: serve stdin until it closes. Each answer is one line on
 *  stdout. Tool calls run one at a time (two at once could each mint the
 *  terminal's key, or write the same file); everything else answers at once,
 *  so a ping is never held up by a say */
export async function serve(ctx, base, opts, version) {
  const server = { version, outDir: await outFolder(ctx, opts), site: opts.site };
  const send = (message) => {
    if (!message) return;
    try { ctx.stdout(`${JSON.stringify(message)}\n`); } catch (error) { ctx.stderr(`minimoji mcp: could not answer ${message.id} (${error?.message ?? error})\n`); }
  };
  ctx.stderr(`minimoji mcp ${version}: serving ${base} over stdio; files go to ${server.outDir}\n`);
  const pending = new Set();
  let tools = Promise.resolve();
  const answer = (message) => {
    const run = () => handle(ctx, base, server, message)
      .catch((error) => {
        ctx.stderr(`minimoji mcp: ${error?.stack ?? error}\n`);
        return { jsonrpc: "2.0", id: message?.id ?? null, error: { code: RPC.internal, message: String(error?.message ?? error).split("\n")[0] } };
      });
    let job;
    if (message?.method === "tools/call") { job = tools.then(run); tools = job; } else job = run();
    job = job.then(send);
    pending.add(job);
    job.then(() => pending.delete(job));
  };
  const input = createInterface({ input: ctx.stdin, crlfDelay: Infinity });
  try {
    for await (const raw of input) {
      const line = raw.trim();
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "not JSON: each message is one JSON-RPC object on one line" } });
        continue;
      }
      answer(message);
    }
  } finally {
    // stdin closed (or failed): what is running still answers
    await Promise.allSettled([...pending]);
  }
  return 0;
}
