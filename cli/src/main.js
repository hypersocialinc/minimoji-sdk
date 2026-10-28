// THE COMMAND LINE — argv to a command, a command's answer to stdout (text,
// or one JSON object with --json), and any failure to one line on stderr
// and a non-zero exit. `ctx` is everything outside the process's own code
// (environment, folders, fetch, the browser, the clock), so the tests can
// run every command against a fixture server.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { keys, login, logout, whoami } from "./auth.js";
import { edit, generate, preview, render, species } from "./avatars.js";
import { init } from "./init.js";
import { avatars, status } from "./library.js";
import { CliError, resolveBase } from "./service.js";
import { skills } from "./skills.js";
import { lines } from "./lines.js";
import { serve } from "./mcp.js";
import { say, voice } from "./voice.js";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const GLOBAL = {
  json: { type: "boolean" },
  base: { type: "string" },
  help: { type: "boolean", short: "h" },
};
const KEY = { key: { type: "string" } };
const SITE = { site: { type: "string" } };

const COMMANDS = {
  login: { run: login, options: { label: { type: "string" }, force: { type: "boolean" }, "no-browser": { type: "boolean" } },
    usage: "minimoji login [--label <name>] [--force] [--no-browser]",
    about: "Sign this terminal in: approve the code in the browser; the session is saved to ~/.config/minimoji/credentials.json (0600)." },
  logout: { run: logout, options: {}, usage: "minimoji logout", about: "Sign out, revoking this terminal's session and its secret key." },
  whoami: { run: whoami, options: {}, usage: "minimoji whoami", about: "The account this terminal is signed in as." },
  keys: { run: keys, options: { kind: { type: "string" }, label: { type: "string" } },
    usage: "minimoji keys list | create --kind publishable|secret [--label <name>] | revoke <prefix>",
    about: "List, mint and revoke your API keys. A new key is shown in full once." },
  init: { run: init, options: { platform: { type: "string" }, plist: { type: "string" }, force: { type: "boolean" }, "with-skill": { type: "boolean" }, agent: { type: "string" }, ref: { type: "string" } },
    usage: "minimoji init [--platform swift|web] [--plist <path>] [--force] [--with-skill]",
    about: "Mint a publishable key for the app in this folder and write it where the app reads config (.env.local, Info.plist). Never a secret key." },
  skills: { run: skills, options: { agent: { type: "string" }, ref: { type: "string" } },
    usage: "minimoji skills list | add [name…] | update [name…] [--agent claude|codex] [--ref <git ref>]",
    about: "Install the Minimoji agent skills into this project (.claude/skills or .agents/skills), so a coding agent knows the SDK." },
  generate: { run: generate, options: { ...KEY, ...SITE, name: { type: "string" }, photo: { type: "string" }, count: { type: "string" }, seed: { type: "string" }, out: { type: "string" }, open: { type: "boolean" } },
    usage: 'minimoji generate "red curls, round glasses" [--name kai] [--photo me.jpg] [--count n] [--seed n] [--out kai.json] [--open]',
    about: `Make an avatar from words, a photo or both, save it, and keep it in your library (named --name, or after the words). Each one spends a generation from the key's day; --count is at most 10.` },
  edit: { run: edit, options: { ...KEY, ...SITE, as: { type: "string" }, photo: { type: "string" }, open: { type: "boolean" } },
    usage: 'minimoji edit <name|key> ["make the hair blue"] [--photo me.jpg] [--as new-name] [--open]',
    about: "Change an avatar with words, a photo or both. The name follows the edit (kai is now the new one); --as keeps it as a new entry instead. Spends a generation from the key's day." },
  avatars: { run: avatars, options: { name: { type: "string" }, out: { type: "string" } },
    usage: "minimoji avatars [list] | save <key> [--name kai] | get <name|key> [--out kai.json] (with its status) | rename <name|key> <new> | remove <name|key>",
    about: "Your library: the avatars you made or kept, on any terminal you sign in to. A name works wherever a key does." },
  species: { run: species, options: { ...KEY, ...SITE, seed: { type: "string" }, pick: { type: "string", multiple: true }, open: { type: "boolean" } },
    usage: "minimoji species list | make <id> [--seed n] [--pick axis=option …] [--open]",
    about: "The species the service offers, and saving one (an alien, D.A.S.H., an animal) with picks from its kit." },
  voice: { run: voice, options: { effect: { type: "string" }, settings: { type: "string", multiple: true }, clear: { type: "boolean" }, list: { type: "boolean" }, "elevenlabs-key": { type: "string" } },
    usage: "minimoji voice <name|key> [<voice id|name>] [--effect robot|none] [--settings stability=0.4,speed=1.1] | <name|key> --clear | --list",
    about: "Give an avatar an ElevenLabs voice, kept on its library entry (the id and settings, never your key); with no voice, print it. --list shows your ElevenLabs voices (ELEVENLABS_API_KEY)." },
  status: { run: status, options: { clear: { type: "boolean" } },
    usage: 'minimoji status <name|key> ["back at 3"] | <name|key> --clear',
    about: "Set the line beside an avatar: every app wearing it (Bunch, savethis, …) shows it, with the mood it reads as. With no text, print it." },
  say: { run: say, options: { ...KEY, voice: { type: "string" }, mood: { type: "string" }, out: { type: "string" }, name: { type: "string" }, effect: { type: "string" }, settings: { type: "string", multiple: true }, model: { type: "string" }, "dry-run": { type: "boolean" }, "elevenlabs-key": { type: "string" }, server: { type: "boolean" } },
    usage: 'minimoji say <name|key> "Hi, I\'m Billie" [--voice id] [--mood happy] [--out minimoji-lines] [--name hello] [--effect robot|none] [--model eleven_v4] [--server] [--dry-run]',
    about: `Turn a sentence into a line the avatar speaks: one ElevenLabs call on your key (ELEVENLABS_API_KEY), then <name>.wav and <name>.json (lip-sync, captions, moods) that every SDK line player plays. --server speaks it on Minimoji's voice instead (your Minimoji key, 5,000 characters a day, no ElevenLabs key). At most 1000 characters.` },
  lines: { run: lines, options: { ...KEY, text: { type: "string" }, texts: { type: "string" }, out: { type: "string" }, timings: { type: "boolean" }, "dry-run": { type: "boolean" } },
    usage: 'minimoji lines <clip|folder>… [--text "Hi!" | --texts lines.json] [--out <dir>] [--timings] [--dry-run]',
    about: "Clips you already have (any voice) → <name>.json lines beside them, on your Minimoji key. With a clip's text (--text, --texts or <name>.txt) the lips follow the script (forced alignment); without, it is transcribed. --timings also writes <name>.timings.json (words + letters). At most 30 s a clip." },
  render: { run: render, options: { size: { type: "string" }, face: { type: "string" }, out: { type: "string" } },
    usage: "minimoji render <avatarKey | name> [--size 64|128|256|512] [--face happy] [--out file.png]",
    about: "Download a saved avatar's still picture." },
  mcp: { run: (ctx, base, opts) => serve(ctx, base, opts, VERSION), options: { ...SITE, out: { type: "string" } },
    usage: "minimoji mcp [--out <dir>] [--base prod|dev]",
    about: "Serve the commands as MCP tools over stdio, as this signed-in terminal, for an agent in Claude, Cursor or any MCP client: claude mcp add minimoji -- npx -y minimoji mcp. No key in any tool; files go to --out (default: here)." },
  preview: { run: preview, options: { ...SITE, face: { type: "string" }, body: { type: "boolean" }, "no-browser": { type: "boolean" } },
    usage: "minimoji preview <avatarKey | name | doc.json> [--face happy] [--body] [--no-browser]",
    about: "Open the avatar on minimoji.com/preview. A local document rides in the link's fragment and is never uploaded." },
};

function help() {
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
  return [
    `minimoji ${VERSION}: Mini avatars from the terminal`,
    "",
    "Usage: minimoji <command> [options]",
    "",
    ...Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.about}`),
    "",
    "Every command takes:",
    "  --json        one JSON object on stdout (errors too: {\"error\"})",
    `  --base <url>  the deployment: prod (default), dev, or an https://….convex.site origin; or MINIMOJI_API`,
    "  --help        the command's usage",
    "",
    "Avatar commands save with the CLI's own secret key, minted on first use; --key or MINIMOJI_KEY uses another.",
    "Start with: minimoji login, then minimoji init in your app's folder.",
  ].join("\n");
}

export async function main(argv, ctx) {
  const wantsJSON = argv.includes("--json");
  try {
    const [name, ...rest] = argv;
    if (!name || name === "--help" || name === "-h" || name === "help") { ctx.stdout(`${help()}\n`); return 0; }
    if (name === "--version" || name === "-v" || name === "version") { ctx.stdout(`${VERSION}\n`); return 0; }
    const command = COMMANDS[name];
    if (!command) throw new CliError(`unknown command "${name}"; minimoji --help lists them`);
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: { ...GLOBAL, ...command.options }, allowPositionals: true, strict: true });
    } catch (error) {
      throw new CliError(`${error.message.replace(/\. To specify a positional argument.*$/s, "")}; usage: ${command.usage}`);
    }
    const opts = parsed.values;
    const out = (data, human) => {
      ctx.stdout(opts.json ? `${JSON.stringify(data, null, 2)}\n` : `${human}\n`);
      return 0;
    };
    if (opts.help) return out({ command: name, usage: command.usage, about: command.about }, `${command.usage}\n\n${command.about}`);
    const base = resolveBase(opts, ctx.env);
    return await command.run(ctx, base, opts, out, parsed.positionals);
  } catch (error) {
    const message = (error instanceof CliError ? error.message : `unexpected error: ${error?.message ?? error}`).split("\n")[0];
    if (wantsJSON) ctx.stdout(`${JSON.stringify({ error: message })}\n`);
    ctx.stderr(`minimoji: ${message}\n`);
    return 1;
  }
}

