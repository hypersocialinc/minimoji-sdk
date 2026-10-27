// a fixture service on a local port and a ctx around it: every command runs
// as it would for a person, over HTTP, without the network
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.js";

/** routes: {"POST /cli/login": (req) => ({status, json} | {status, body, headers})}.
 *  A route may be an array of answers, one per call (the last repeats) */
export async function fixtureServer(routes) {
  const calls = [];
  const counts = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, "http://fixture");
    const call = { method: req.method, path: url.pathname, search: url.search, auth: req.headers.authorization ?? null, headers: req.headers, raw: text, bytes: Buffer.concat(chunks), body: text ? safeJSON(text) : null };
    calls.push(call);
    const key = `${req.method} ${url.pathname}`;
    let route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    if (Array.isArray(route)) {
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      route = route[Math.min(n, route.length - 1)];
    }
    const answer = route ? await route(call) : { status: 404, json: { error: `no fixture for ${key}` } };
    if (answer.json !== undefined) {
      res.writeHead(answer.status ?? 200, { "Content-Type": "application/json", ...answer.headers });
      res.end(JSON.stringify(answer.json));
    } else {
      res.writeHead(answer.status ?? 200, answer.headers ?? {});
      res.end(answer.body ?? "");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((r) => server.close(r)) };
}

const safeJSON = (t) => { try { return JSON.parse(t); } catch { return t; } };

export async function tempDir(prefix = "minimoji-cli-") {
  return mkdtemp(join(tmpdir(), prefix));
}

/** a ctx whose config lives in its own temp folder */
export async function makeCtx({ cwd, env = {} } = {}) {
  const config = await tempDir("minimoji-config-");
  const ctx = {
    env: { MINIMOJI_CONFIG_DIR: config, ...env },
    cwd: cwd ?? (await tempDir()),
    home: config,
    hostname: "test-host",
    opened: [],
    fetch: globalThis.fetch,
    open: (url) => { ctx.opened.push(url); return true; },
    sleep: async () => {},
  };
  return ctx;
}

/** run one command line; stdout parsed when --json */
export async function run(ctx, argv) {
  let stdout = "", stderr = "";
  const code = await main(argv, { ...ctx, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
  return { code, stdout, stderr, json: argv.includes("--json") ? JSON.parse(stdout) : null };
}

export const SESSION = { owner: "o1", email: "dev@example.com", name: "Dev", session: { label: "minimoji CLI on test-host", prefix: "mk_cli_1234…abcd", createdAt: 1 } };
export const pub = (n = "a") => `mk_pub_${n.repeat(40).slice(0, 40)}`;
export const sec = (n = "b") => `mk_sec_${n.repeat(40).slice(0, 40)}`;
export const prefixOf = (key) => `${key.slice(0, 11)}…${key.slice(-4)}`;

/** sign a ctx in against a fixture by writing the credentials file directly */
export async function signIn(ctx, base, extra = {}) {
  const { writeCredentials } = await import("../src/service.js");
  await writeCredentials(ctx, { deployments: { [base]: { token: "mk_cli_" + "c".repeat(40), label: "t", ...extra } } });
}
