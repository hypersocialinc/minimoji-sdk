import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SKILLS_REPO, stampSource } from "../src/skills.js";
import { fixtureServer, makeCtx, run, tempDir } from "./helpers.mjs";

const OLD = "1".repeat(40), NEW = "2".repeat(40);
const SKILL = (v) => `---\nname: minimoji-swift\ndescription: Add Minimoji heads (${v}).\n---\n\n# MinimojiKit\n\nbody ${v}\n`;

/** GitHub's commits/trees API and raw.githubusercontent.com, for one repo whose main is `head` */
async function github(head) {
  const files = { [OLD]: SKILL("old"), [NEW]: SKILL("new") };
  return fixtureServer({
    [`GET /repos/${SKILLS_REPO}/commits/main`]: () => ({ body: head, headers: { "Content-Type": "text/plain" } }),
    [`GET /repos/${SKILLS_REPO}/git/trees/*`]: () => ({ json: { tree: [
      { path: "README.md", type: "blob" }, { path: "skills", type: "tree" }, { path: "skills/minimoji-swift", type: "tree" },
      { path: "skills/minimoji-swift/SKILL.md", type: "blob" }, { path: "skills/no-skill-md/notes.txt", type: "blob" },
    ] } }),
    [`GET /${SKILLS_REPO}/*`]: (c) => {
      const sha = c.path.split("/")[3];
      return files[sha] ? { body: files[sha] } : { status: 404, body: "404" };
    },
  });
}

async function ctxFor(svc, markers = []) {
  const cwd = await tempDir("minimoji-repo-");
  for (const m of markers) m.endsWith("/") ? await mkdir(join(cwd, m), { recursive: true }) : await writeFile(join(cwd, m), "");
  return makeCtx({ cwd, env: { MINIMOJI_SKILLS_API: svc.url, MINIMOJI_SKILLS_RAW: svc.url } });
}

test("skills add in a repo with .claude/ writes .claude/skills/<name>/SKILL.md: the public file at the ref, plus its source line", async () => {
  const svc = await github(NEW);
  try {
    const ctx = await ctxFor(svc, [".claude/"]);
    const r = await run(ctx, ["skills", "add", "minimoji-swift", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.agent, "claude");
    assert.equal(r.json.ref, NEW);
    const text = await readFile(join(ctx.cwd, ".claude/skills/minimoji-swift/SKILL.md"), "utf8");
    assert.equal(text, stampSource(SKILL("new"), NEW));
    assert.equal(text.replace(`minimoji-source: ${SKILLS_REPO}@${NEW}\n`, ""), SKILL("new"), "the rest is the public file byte for byte");
    assert.ok(svc.calls.some((c) => c.path === `/${SKILLS_REPO}/${NEW}/skills/minimoji-swift/SKILL.md`));
  } finally { await svc.close(); }
});

test("skills add --agent codex writes .agents/skills; AGENTS.md alone picks Codex too", async () => {
  const svc = await github(NEW);
  try {
    let ctx = await ctxFor(svc, [".claude/"]);
    let r = await run(ctx, ["skills", "add", "--agent", "codex"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(await readFile(join(ctx.cwd, ".agents/skills/minimoji-swift/SKILL.md"), "utf8"), /minimoji-source/);
    ctx = await ctxFor(svc, ["AGENTS.md"]);
    r = await run(ctx, ["skills", "add", "--json"]);
    assert.equal(r.json.agent, "codex");
    assert.deepEqual(r.json.installed.map((s) => s.name), ["minimoji-swift"], "no name adds every skill that has a SKILL.md");
    ctx = await ctxFor(svc, []);
    r = await run(ctx, ["skills", "add", "--json"]);
    assert.equal(r.json.agent, "claude", "nothing to go on is Claude Code");
  } finally { await svc.close(); }
});

test("skills update replaces a stale copy and leaves a current one alone", async () => {
  const old = await github(OLD);
  const ctx = await ctxFor(old, [".claude/"]);
  await run(ctx, ["skills", "add", "--agent", "claude"]);
  await run(ctx, ["skills", "add", "--agent", "codex"]);
  await old.close();
  const svc = await github(NEW);
  try {
    ctx.env.MINIMOJI_SKILLS_API = ctx.env.MINIMOJI_SKILLS_RAW = svc.url;
    // the Codex copy is brought current by hand first; a local edit to it must survive the update
    const codex = join(ctx.cwd, ".agents/skills/minimoji-swift/SKILL.md");
    await writeFile(codex, `${stampSource(SKILL("new"), NEW)}local note\n`);
    const r = await run(ctx, ["skills", "update", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.updated.map((s) => [s.agent, s.from, s.ref]), [["claude", OLD, NEW]]);
    assert.deepEqual(r.json.current.map((s) => s.agent), ["codex"]);
    assert.equal(await readFile(join(ctx.cwd, ".claude/skills/minimoji-swift/SKILL.md"), "utf8"), stampSource(SKILL("new"), NEW));
    assert.match(await readFile(codex, "utf8"), /local note/);
    const list = await run(ctx, ["skills", "list", "--json"]);
    assert.deepEqual(list.json.skills[0].installed.map((i) => i.current), [true, true]);
  } finally { await svc.close(); }
});

test("a copy stamped with the repo's old name, minimoji-skills, is still ours: update replaces it, add is not refused", async () => {
  const svc = await github(NEW);
  try {
    const ctx = await ctxFor(svc, [".claude/"]);
    const path = join(ctx.cwd, ".claude/skills/minimoji-swift/SKILL.md");
    await mkdir(join(ctx.cwd, ".claude/skills/minimoji-swift"), { recursive: true });
    await writeFile(path, SKILL("old").replace("---\n\n", `minimoji-source: hypersocialinc/minimoji-skills@${OLD}\n---\n\n`));
    const r = await run(ctx, ["skills", "update", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.updated.map((s) => [s.from, s.ref]), [[OLD, NEW]]);
    assert.equal(await readFile(path, "utf8"), stampSource(SKILL("new"), NEW));
    assert.match(await readFile(path, "utf8"), /minimoji-source: hypersocialinc\/minimoji-sdk@/);
    await writeFile(path, SKILL("old").replace("---\n\n", `minimoji-source: hypersocialinc/minimoji-skills@${OLD}\n---\n\n`));
    assert.equal((await run(ctx, ["skills", "add"])).code, 0, "not taken for someone's own skill");
    // only Minimoji's own repos count: a fork of the same name is someone else's
    await writeFile(path, SKILL("old").replace("---\n\n", `minimoji-source: someone/minimoji-skills@${OLD}\n---\n\n`));
    assert.equal((await run(ctx, ["skills", "add"])).code, 1);
    assert.deepEqual((await run(ctx, ["skills", "update", "--json"])).json.updated, []);
  } finally { await svc.close(); }
});

test("skills add of an unknown name fails with the names there are", async () => {
  const svc = await github(NEW);
  try {
    const r = await run(await ctxFor(svc), ["skills", "add", "minimoji-web"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no skill "minimoji-web" .* it has minimoji-swift/);
  } finally { await svc.close(); }
});

test("a pinned commit is used as given, without asking GitHub what main is", async () => {
  const svc = await github(NEW);
  try {
    const r = await run(await ctxFor(svc), ["skills", "add", "--ref", OLD, "--json"]);
    assert.equal(r.json.ref, OLD);
    assert.ok(!svc.calls.some((c) => c.path.includes("/commits/")));
  } finally { await svc.close(); }
});

test("GITHUB_TOKEN goes to api.github.com only, never to another host", async () => {
  const svc = await github(NEW);
  try {
    const ctx = await ctxFor(svc, [".claude/"]);
    ctx.env.GITHUB_TOKEN = "ghp_secret";
    assert.equal((await run(ctx, ["skills", "add"])).code, 0);
    assert.ok(svc.calls.every((c) => c.auth === null));
  } finally { await svc.close(); }
});

test("a failed download leaves the installed skill whole; a folder minimoji did not install is never replaced", async () => {
  const old = await github(OLD);
  const ctx = await ctxFor(old, [".claude/"]);
  await run(ctx, ["skills", "add"]);
  await old.close();
  const path = join(ctx.cwd, ".claude/skills/minimoji-swift/SKILL.md");
  const before = await readFile(path, "utf8");
  const broken = await fixtureServer({
    [`GET /repos/${SKILLS_REPO}/commits/main`]: () => ({ body: NEW }),
    [`GET /repos/${SKILLS_REPO}/git/trees/*`]: () => ({ json: { tree: [{ path: "skills/minimoji-swift/SKILL.md", type: "blob" }, { path: "skills/minimoji-swift/refs/api.md", type: "blob" }] } }),
    [`GET /${SKILLS_REPO}/*`]: (c) => (c.path.endsWith("api.md") ? { status: 403, body: "rate limited" } : { body: SKILL("new") }),
  });
  try {
    ctx.env.MINIMOJI_SKILLS_API = ctx.env.MINIMOJI_SKILLS_RAW = broken.url;
    const r = await run(ctx, ["skills", "update"]);
    assert.equal(r.code, 1);
    assert.equal(await readFile(path, "utf8"), before);
    await mkdir(join(ctx.cwd, ".claude/skills/mine"), { recursive: true });
    await writeFile(join(ctx.cwd, ".claude/skills/mine/SKILL.md"), "my own");
    await rm(join(ctx.cwd, ".claude/skills/minimoji-swift"), { recursive: true });
    await writeFile(join(ctx.cwd, ".claude/skills/minimoji-swift.txt"), "");
    await mkdir(join(ctx.cwd, ".claude/skills/minimoji-swift"));
    await writeFile(join(ctx.cwd, ".claude/skills/minimoji-swift/SKILL.md"), "hand written");
    const r2 = await run(ctx, ["skills", "add", "minimoji-swift"]);
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /was not installed by minimoji/);
    assert.equal(await readFile(join(ctx.cwd, ".claude/skills/minimoji-swift/SKILL.md"), "utf8"), "hand written");
  } finally { await broken.close(); }
});
