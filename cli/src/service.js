// THE SERVICE AND THE SIGNED-IN TERMINAL — which deployment a command talks
// to, how it calls the contract's routes (convex/http.ts), and the
// credentials file that keeps one session (and the CLI's own secret key)
// per deployment.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** the deployments by name: `--base dev` is what a developer of Minimoji uses */
export const BASES = {
  prod: "https://striped-walrus-538.convex.site",
  dev: "https://impressive-salamander-372.convex.site",
};
export const SITE = "https://www.minimoji.com";

export class CliError extends Error {}

/** `--base`, else MINIMOJI_API, else production: a name from BASES or an http(s) origin */
export function resolveBase(opts, env) {
  const raw = (opts.base ?? env.MINIMOJI_API ?? "prod").trim();
  const url = BASES[raw] ?? raw;
  // a token never crosses plain http, except to this machine (a local deployment, the tests)
  if (!/^(https:\/\/[^/\s]+|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)\/?$/.test(url)) throw new CliError(`--base must be ${Object.keys(BASES).join(" or ")} or a deployment's https://….convex.site origin, not "${raw}"`);
  return url.replace(/\/$/, "");
}

/** the website whose /preview page shows an avatar */
export function resolveSite(opts, env) {
  return (opts.site ?? env.MINIMOJI_SITE ?? SITE).replace(/\/$/, "");
}

/** one route of the contract: the parsed JSON body, or a CliError in the
 *  route's own words. `allow` lists statuses handed back instead of thrown.
 *  `body` is sent as JSON, or as it is when it is a FormData */
export async function call(ctx, base, method, path, { token, body, allow = [] } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  // a FormData body is multipart: fetch writes its type and boundary
  const form = typeof FormData === "function" && body instanceof FormData;
  if (body !== undefined && !form) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await ctx.fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  } catch (error) {
    throw new CliError(`could not reach ${base} (${error?.cause?.code ?? error?.message ?? error})`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON: a proxy's page, said below */ }
  if (res.ok || allow.includes(res.status)) {
    if (data === null) throw new CliError(`${method} ${path} answered ${res.status} with something that is not JSON`);
    return { status: res.status, data };
  }
  const why = data && typeof data.error === "string" ? data.error : text.trim().slice(0, 200) || res.statusText;
  const error = new CliError(`${method} ${path} failed (${res.status}): ${why}`);
  error.status = res.status;
  throw error;
}

// the credentials file: {deployments: {<base>: {token, label, prefix, secretKey?}}},
// readable by its owner alone, like ~/.npmrc or gh's hosts.yml. A ctx with
// `credentials: {read, write}` keeps them elsewhere (the hosted connector,
// apps/web/lib/mcp, holds one person's sealed in their account)
export function configDir(ctx) {
  return ctx.env.MINIMOJI_CONFIG_DIR ?? join(ctx.env.XDG_CONFIG_HOME || join(ctx.home, ".config"), "minimoji");
}
export const credentialsPath = (ctx) => join(configDir(ctx), "credentials.json");

export async function readCredentials(ctx) {
  if (ctx.credentials) return ctx.credentials.read();
  let text;
  try { text = await readFile(credentialsPath(ctx), "utf8"); } catch (error) {
    if (error.code === "ENOENT") return { deployments: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    return { ...parsed, deployments: parsed.deployments ?? {} };
  } catch {
    throw new CliError(`${credentialsPath(ctx)} is not JSON; delete it and run minimoji login`);
  }
}

export async function writeCredentials(ctx, creds) {
  if (ctx.credentials) return ctx.credentials.write(creds);
  const dir = configDir(ctx), file = credentialsPath(ctx), tmp = `${file}.${process.pid}.tmp`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600);
}

/** how a base is typed back: its name in BASES, else the origin */
export const baseName = (base) => Object.keys(BASES).find((k) => BASES[k] === base) ?? base;

/** this deployment's session, or a CliError that says how to get one */
export async function requireSession(ctx, base) {
  const creds = await readCredentials(ctx);
  const session = creds.deployments[base];
  if (!session?.token) throw new CliError(`not signed in to ${base}; run minimoji login${base === BASES.prod ? "" : ` --base ${baseName(base)}`}`);
  return { creds, session };
}

/** a /cli/* route with the session; a 401 says to sign in again */
export async function sessionCall(ctx, base, method, path, body) {
  const { session } = await requireSession(ctx, base);
  try {
    return (await call(ctx, base, method, path, { token: session.token, body })).data;
  } catch (error) {
    if (error.status === 401) throw Object.assign(new CliError(`${error.message.replace(/^.*?: /, "")}; run minimoji login again`), { status: 401 });
    throw error;
  }
}

/** the key avatar commands save with: `--key` / MINIMOJI_KEY, else the
 *  CLI's own secret key for this deployment, minted through the session on
 *  first use. Saving (`POST /avatars`) takes a secret key; the laptop is a
 *  server here, never an app. `fresh` drops a stored key the service refused */
export async function avatarKey(ctx, base, opts, { fresh = false } = {}) {
  const given = opts.key ?? ctx.env.MINIMOJI_KEY;
  if (given) return { key: given, stored: false };
  const { creds, session } = await requireSession(ctx, base);
  if (session.secretKey?.key && !fresh) return { key: session.secretKey.key, stored: true };
  const label = `minimoji CLI on ${ctx.hostname}`;
  const made = await sessionCall(ctx, base, "POST", "/cli/keys", { kind: "secret", label });
  session.secretKey = { key: made.key, prefix: made.prefix, label };
  await writeCredentials(ctx, creds);
  ctx.stderr(`Minted a secret key for this terminal (${made.prefix}, "${label}"); it stays in ${credentialsPath(ctx)}.\n`);
  return { key: made.key, stored: true };
}

/** a write route with the avatar key, minting a new CLI key once if the
 *  stored one was revoked on the keys page */
export async function keyedCall(ctx, base, opts, method, path, body) {
  let { key, stored } = await avatarKey(ctx, base, opts);
  try {
    return (await call(ctx, base, method, path, { token: key, body })).data;
  } catch (error) {
    if (!stored || error.status !== 401) throw error;
    ({ key } = await avatarKey(ctx, base, opts, { fresh: true }));
    return (await call(ctx, base, method, path, { token: key, body })).data;
  }
}
