// First-run onboarding uses the same public skill installer as `skills add`.
// No account, credentials, npm lifecycle hook or global project state needed.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { CliError } from "./service.js";
import { AGENT_DIRS, addSkillsForAgents, installedSkills } from "./skills.js";

const LABELS = { claude: "Claude Code", codex: "Codex", both: "Claude Code and Codex" };

export function interactiveSetup(ctx) {
  return !!(ctx.stdin?.isTTY && ctx.stderrIsTTY && !ctx.env.CI);
}

export async function needsSetup(ctx) {
  return interactiveSetup(ctx) && (await installedSkills(ctx)).length === 0;
}

async function suggestedAgent(ctx) {
  const exists = async (name) => !!await stat(join(/* turbopackIgnore: true */ ctx.cwd, name)).catch(() => null);
  const claude = await exists(".claude") || await exists("CLAUDE.md");
  const codex = await exists(".agents") || await exists(".codex") || await exists("AGENTS.md");
  return claude && codex ? "both" : codex ? "codex" : "claude";
}

// Keep one interface for the entire conversation so pasted lines aren't lost
// between questions. Closing stdin or Ctrl-C resolves the current question.
function questions(ctx) {
  const output = new Writable({ write(chunk, _encoding, done) { ctx.stderr(chunk.toString()); done(); } });
  const rl = createInterface({ input: ctx.stdin, output, terminal: true });
  const queued = [];
  let closed = false, interrupted = false, waiting;
  rl.on("line", (line) => {
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(line.trim()); }
    else queued.push(line.trim());
  });
  rl.on("close", () => { closed = true; waiting?.(null); waiting = undefined; });
  rl.on("SIGINT", () => { interrupted = true; queued.length = 0; rl.close(); });
  return {
    async ask(text) {
      if (closed || queued.length) {
        ctx.stderr(text);
        return queued.length ? queued.shift() : null;
      }
      rl.setPrompt(text);
      rl.prompt();
      return new Promise((resolve) => { waiting = resolve; });
    },
    get interrupted() { return interrupted; },
    close() { rl.close(); output.end(); },
  };
}

export async function setup(ctx, _base, opts, out, positionals = []) {
  if (positionals.length) throw new CliError("setup takes no arguments; run minimoji setup --help");
  if (opts.agent && !Object.keys(LABELS).includes(opts.agent)) throw new CliError("--agent is claude, codex or both");
  if (opts.yes && !opts.agent) throw new CliError("choose an agent with --yes: minimoji setup --yes --agent claude|codex|both");
  if (!opts.yes && (opts.json || !interactiveSetup(ctx))) throw new CliError("setup needs an interactive terminal; for automation use minimoji setup --yes --agent claude|codex|both");

  let agent = opts.agent;
  if (!opts.yes) {
    ctx.stderr(`\nWelcome to Minimoji\n\nSkills are guides and examples that teach your coding agent to create avatars,\nmake them talk, and build with Minimoji. No sign-in needed.\n\nProject: ${ctx.cwd}\n\n`);
    const suggested = await suggestedAgent(ctx);
    const prompt = questions(ctx);
    try {
      if (!agent) {
        const choices = ["claude", "codex", "both"];
        ctx.stderr(`Which coding agent do you use?\n${choices.map((key, i) => `  ${i + 1}. ${LABELS[key]}${key === suggested ? " (default)" : ""}`).join("\n")}\n  q. Skip for now\n\n`);
        while (!agent) {
          const answer = await prompt.ask(`Choose [${choices.indexOf(suggested) + 1}]: `);
          if (answer === null || /^(q|quit|skip)$/i.test(answer)) break;
          agent = answer === "" ? suggested : choices[Number(answer) - 1] ?? (Object.keys(LABELS).includes(answer.toLowerCase()) ? answer.toLowerCase() : undefined);
          if (!agent) ctx.stderr("Enter 1, 2, 3, or q to skip.\n");
        }
      }
      let confirmed = false;
      if (agent) {
        const agents = agent === "both" ? ["claude", "codex"] : [agent];
        ctx.stderr(`\nInstall the full skill bundle for ${LABELS[agent]} in this project:\n${agents.map((key) => `  ${join(ctx.cwd, AGENT_DIRS[key])}`).join("\n")}\n\n`);
        while (true) {
          const answer = await prompt.ask("Install skills here? [Y/n]: ");
          if (answer === null || /^(n|no|q|quit)$/i.test(answer)) break;
          if (/^(y|yes)?$/i.test(answer)) { confirmed = true; break; }
          ctx.stderr("Enter y to install, or n to skip.\n");
        }
      }
      if (!confirmed || prompt.interrupted) {
        out({ cancelled: true, installed: [] }, "Setup skipped. No skills were changed. Run minimoji setup when you're ready.");
        return prompt.interrupted ? 130 : 0;
      }
    } finally { prompt.close(); }
  }

  if (!opts.json) ctx.stderr("\nDownloading the Minimoji skill bundle…\n");
  const result = await addSkillsForAgents(ctx, opts, agent === "both" ? ["claude", "codex"] : [agent]);
  const next = `Start a new ${agent === "both" ? "Claude Code or Codex" : LABELS[agent]} session in this project and ask: "Add a talking Minimoji avatar to my app."`;
  return out({ ...result, project: ctx.cwd, next }, [
    ...result.agents.map((key) => `Installed ${result.installed.filter((s) => s.agent === key).length} skills for ${LABELS[key]} in ${AGENT_DIRS[key]}.`),
    "", next, "",
    "Your agent can help you sign in with minimoji login when you need account features.",
    "Update your skills later with minimoji skills update.",
  ].join("\n"));
}
