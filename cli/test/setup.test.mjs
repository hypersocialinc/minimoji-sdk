import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fixtureServer, makeCtx, run } from "./helpers.mjs";
import { SKILLS_REPO } from "../src/skills.js";

const SHA = "a".repeat(40);
const FILES = {
  "minimoji-web/SKILL.md": "---\nname: minimoji-web\ndescription: Build talking avatars\n---\nWeb guide\n",
  "minimoji-web/references/example.md": "An example app\n",
  "minimoji-presenter/SKILL.md": "---\nname: minimoji-presenter\n---\nMake presentations\n",
};

async function fixture(t, overrides = {}) {
  const server = await fixtureServer({
    [`GET /repos/${SKILLS_REPO}/commits/main`]: () => ({ body: SHA }),
    [`GET /repos/${SKILLS_REPO}/git/trees/${SHA}`]: () => ({ json: { tree: Object.keys(FILES).map((path) => ({ type: "blob", path: `skills/${path}` })) } }),
    [`GET /${SKILLS_REPO}/${SHA}/skills/*`]: ({ path }) => ({ body: FILES[path.split("/skills/")[1]] }),
    ...overrides,
  });
  const ctx = await makeCtx({ env: { MINIMOJI_SKILLS_API: server.url, MINIMOJI_SKILLS_RAW: server.url } });
  t.after(async () => { await server.close(); await rm(ctx.cwd, { recursive: true, force: true }); await rm(ctx.home, { recursive: true, force: true }); });
  return { ctx, server };
}

function terminal(ctx) {
  ctx.stdin = new PassThrough();
  ctx.stdin.isTTY = true;
  ctx.stderrIsTTY = true;
  return ctx;
}

async function converse(ctx, argv, answers) {
  terminal(ctx);
  // Feed as one paste after the questions have attached their listeners.
  const result = run(ctx, argv);
  const feed = setTimeout(() => ctx.stdin.end(answers), 30);
  try { return await result; } finally { clearTimeout(feed); ctx.stdin.destroy(); }
}

test("wizard installs the full bundle for both agents, without login, and downloads each file once", async (t) => {
  const { ctx, server } = await fixture(t);
  const result = await converse(ctx, ["setup"], "3\ny\n");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /Project:/);
  assert.match(result.stderr, /\.claude\/skills/);
  assert.match(result.stderr, /\.agents\/skills/);
  for (const dir of [".claude/skills", ".agents/skills"]) {
    assert.match(await readFile(join(ctx.cwd, dir, "minimoji-web/SKILL.md"), "utf8"), new RegExp(`minimoji-source: ${SKILLS_REPO}@${SHA}`));
    assert.equal(await readFile(join(ctx.cwd, dir, "minimoji-web/references/example.md"), "utf8"), FILES["minimoji-web/references/example.md"]);
    assert.match(await readFile(join(ctx.cwd, dir, "minimoji-presenter/SKILL.md"), "utf8"), /Make presentations/);
  }
  assert.equal(server.calls.filter((call) => call.path.includes("/skills/")).length, Object.keys(FILES).length);
  assert.ok(server.calls.every((call) => call.method === "GET" && !call.auth));
  assert.deepEqual(await readdir(ctx.home), [], "no auth or global setup state");
  assert.deepEqual(ctx.opened, []);
  assert.match(result.stdout, /Start a new Claude Code or Codex session/);
  assert.match(result.stdout, /skills update/);
});

test("agent markers suggest Codex or both; Enter accepts the suggestion", async (t) => {
  for (const markers of [["AGENTS.md"], ["CLAUDE.md", "AGENTS.md"]]) {
    const { ctx } = await fixture(t);
    for (const marker of markers) await writeFile(join(ctx.cwd, marker), "project instructions");
    const result = await converse(ctx, ["setup"], "\ny\n");
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /skills for Codex/);
    const dirs = await readdir(ctx.cwd);
    assert.equal(dirs.includes(".claude"), markers.length === 2);
  }
});

test("invalid answers retry and explicit --agent skips the agent choice", async (t) => {
  const { ctx } = await fixture(t);
  const result = await converse(ctx, ["setup", "--agent", "codex"], "maybe\nyes\n");
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Which coding agent/);
  assert.match(result.stderr, /Enter y to install/);
  assert.match(result.stdout, /skills for Codex/);
});

test("skip, declined confirmation, EOF and Ctrl-C make no requests or writes", async (t) => {
  for (const answers of ["q\n", "2\nn\n", "", "3\n", "\x03"]) {
    const { ctx, server } = await fixture(t);
    const result = await converse(ctx, ["setup"], answers);
    assert.equal(result.code, answers === "\x03" ? 130 : 0, result.stderr);
    assert.match(result.stdout, /Setup skipped/);
    assert.deepEqual(server.calls, []);
    assert.deepEqual(await readdir(ctx.cwd), []);
  }
  const { ctx, server } = await fixture(t);
  const interrupted = await converse(ctx, ["setup", "--agent", "codex"], "y\n\x03");
  assert.equal(interrupted.code, 130, "an interrupt before confirmation is processed cancels setup");
  assert.deepEqual(server.calls, []);
  assert.deepEqual(await readdir(ctx.cwd), []);
});

test("automation requires --yes and an explicit agent; JSON stays machine readable", async (t) => {
  const { ctx, server } = await fixture(t);
  for (const argv of [["setup"], ["setup", "--yes"], ["setup", "--agent", "codex"], ["setup", "--yes", "--agent", "unknown"], ["setup", "extra"]]) {
    const result = await run(ctx, [...argv, "--json"]);
    assert.equal(result.code, 1);
    assert.ok(result.json.error);
    assert.deepEqual(server.calls, []);
  }
  const result = await run(ctx, ["setup", "--yes", "--agent", "codex", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.json.agents, ["codex"]);
  assert.equal(result.json.installed.length, 2);
  assert.equal(result.json.project, ctx.cwd);
  assert.ok(result.json.next);
  const again = await run(ctx, ["setup", "--yes", "--agent", "codex", "--json"]);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(again.json, result.json);
});

test("bare minimoji starts setup only in an interactive, unconfigured project; help never prompts", async (t) => {
  const { ctx, server } = await fixture(t);
  const first = await converse(ctx, [], "q\n");
  assert.match(first.stderr, /Welcome to Minimoji/);
  for (const options of [{}, { stdin: { isTTY: false }, stderrIsTTY: true }, { stdin: { isTTY: true }, stderrIsTTY: false }, { stdin: { isTTY: true }, stderrIsTTY: true, env: { ...ctx.env, CI: "true" } }]) {
    const result = await run({ ...ctx, stdin: undefined, stderrIsTTY: false, ...options }, []);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage: minimoji/);
    assert.equal(result.stderr, "");
  }
  assert.match((await run(terminal(ctx), ["--help"])).stdout, /Usage: minimoji/);
  assert.equal((await run(terminal(ctx), ["setup", "--json"])).code, 1, "JSON never prompts even in a TTY");
  assert.deepEqual(server.calls, []);
  assert.equal((await run(ctx, ["setup", "--yes", "--agent", "claude"])).code, 0);
  const configured = await run(terminal(ctx), []);
  assert.equal(configured.code, 0);
  assert.match(configured.stdout, /Usage: minimoji/);
  assert.equal(configured.stderr, "");
});

test("a foreign skill in the second agent's folder prevents all writes", async (t) => {
  const { ctx } = await fixture(t);
  const target = join(ctx.cwd, ".agents/skills/minimoji-presenter");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "My custom guide");
  const result = await run(ctx, ["setup", "--yes", "--agent", "both", "--json"]);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /not installed by minimoji/);
  assert.deepEqual(await readdir(ctx.cwd), [".agents"]);
  assert.deepEqual(await readdir(join(ctx.cwd, ".agents/skills")), ["minimoji-presenter"]);
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "My custom guide");
});

test("an edited skill is preserved and blocks writes to the other agent", async (t) => {
  const { ctx } = await fixture(t);
  assert.equal((await run(ctx, ["setup", "--yes", "--agent", "codex"])).code, 0);
  const target = join(ctx.cwd, ".agents/skills/minimoji-web/references/example.md");
  await writeFile(target, "My own instructions");
  const result = await run(ctx, ["setup", "--yes", "--agent", "both", "--json"]);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /changes you made/);
  assert.deepEqual(await readdir(ctx.cwd), [".agents"]);
  assert.equal(await readFile(target, "utf8"), "My own instructions");
});

test("a failed bundle download or empty catalog leaves the project untouched", async (t) => {
  for (const overrides of [
    { [`GET /${SKILLS_REPO}/${SHA}/skills/minimoji-presenter/SKILL.md`]: () => ({ status: 503 }) },
    { [`GET /repos/${SKILLS_REPO}/git/trees/${SHA}`]: () => ({ json: { tree: [] } }) },
  ]) {
    const { ctx } = await fixture(t, overrides);
    const result = await run(ctx, ["setup", "--yes", "--agent", "both", "--json"]);
    assert.equal(result.code, 1);
    assert.ok(result.json.error);
    assert.deepEqual(await readdir(ctx.cwd), []);
  }
});

test("edits or foreign skills created during download prevent every destination write", async (t) => {
  for (const foreign of [false, true]) {
    let directory, shouldEdit = false;
    const { ctx } = await fixture(t, {
      [`GET /${SKILLS_REPO}/${SHA}/skills/minimoji-presenter/SKILL.md`]: async () => {
        if (shouldEdit) {
          const target = join(directory, '.agents/skills/minimoji-presenter');
          await mkdir(target, { recursive: true });
          await writeFile(join(target, foreign ? 'SKILL.md' : 'note.md'), 'Saved while downloading');
        }
        return { body: FILES['minimoji-presenter/SKILL.md'] };
      },
    });
    directory = ctx.cwd;
    if (!foreign) assert.equal((await run(ctx, ['setup', '--yes', '--agent', 'codex'])).code, 0);
    shouldEdit = true;
    const result = await run(ctx, ['setup', '--yes', '--agent', 'both', '--json']);
    assert.equal(result.code, 1);
    assert.match(result.json.error, foreign ? /not installed by minimoji/ : /changes you made/);
    assert.deepEqual(await readdir(ctx.cwd), ['.agents'], 'the first agent must remain untouched too');
    assert.equal(await readFile(join(ctx.cwd, '.agents/skills/minimoji-presenter', foreign ? 'SKILL.md' : 'note.md'), 'utf8'), 'Saved while downloading');
  }
});
