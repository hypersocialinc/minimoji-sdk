// SIGNING IN AND KEYS — the device grant (POST /cli/login, then polling
// POST /cli/login/poll while the person approves the code at
// minimoji.com/developers/device), and the session's key routes.
import { CliError, call, credentialsPath, readCredentials, requireSession, sessionCall, writeCredentials } from "./service.js";

export async function login(ctx, base, opts, out) {
  const creds = await readCredentials(ctx);
  const existing = creds.deployments[base];
  if (existing?.token && !opts.force) {
    const who = await call(ctx, base, "GET", "/cli/whoami", { token: existing.token, allow: [401] });
    if (who.status === 200) {
      return out({ signedIn: true, already: true, ...account(who.data), credentials: credentialsPath(ctx) },
        `Already signed in to ${base} as ${describe(who.data)}. minimoji login --force signs in again.`);
    }
  }
  const label = (opts.label ?? `minimoji CLI on ${ctx.hostname}`).slice(0, 60);
  const start = (await call(ctx, base, "POST", "/cli/login", { body: { label } })).data;
  ctx.stderr(`To sign this terminal in, open\n\n  ${start.verificationUriComplete}\n\nand approve the code ${start.userCode}. Waiting…\n`);
  if (!opts["no-browser"]) ctx.open(start.verificationUriComplete);

  let interval = (Number(start.interval) || 5) * 1000;
  const deadline = Date.now() + (Number.isFinite(start.expiresIn) ? start.expiresIn : 600) * 1000;
  let token = null;
  while (!token) {
    if (Date.now() > deadline) throw new CliError("the code expired before it was approved; run minimoji login again");
    await ctx.sleep(interval);
    const poll = await call(ctx, base, "POST", "/cli/login/poll", { body: { deviceCode: start.deviceCode }, allow: [400] });
    if (poll.status === 200) { token = poll.data.token; break; }
    const why = poll.data.error;
    if (why === "slow_down") interval += 5000;
    else if (why === "access_denied") throw new CliError("the sign-in was denied in the browser");
    else if (why === "expired_token") throw new CliError("the code expired before it was approved; run minimoji login again");
    else if (why !== "authorization_pending") throw new CliError(`POST /cli/login/poll failed: ${why ?? "no reason given"}`);
  }

  // a re-login replaces the old session; the CLI's secret key is the
  // account's, not the session's, so it carries over
  const who = (await call(ctx, base, "GET", "/cli/whoami", { token })).data;
  creds.deployments[base] = { token, label, prefix: who.session?.prefix, signedInAt: new Date().toISOString(), ...(existing?.secretKey ? { secretKey: existing.secretKey } : {}) };
  await writeCredentials(ctx, creds);
  return out({ signedIn: true, ...account(who), credentials: credentialsPath(ctx) },
    `Signed in to ${base} as ${describe(who)}. The session is in ${credentialsPath(ctx)}.`);
}

export async function logout(ctx, base, _opts, out) {
  const creds = await readCredentials(ctx);
  const session = creds.deployments[base];
  if (!session?.token) return out({ signedOut: false }, `Not signed in to ${base}.`);
  const notes = [];
  // the CLI's own secret key goes with the session: a signed-out laptop holds nothing
  if (session.secretKey?.prefix) {
    const r = await call(ctx, base, "POST", "/cli/keys/revoke", { token: session.token, body: { prefix: session.secretKey.prefix }, allow: [401, 404, 409] });
    if (r.status === 200) notes.push(`revoked this terminal's secret key ${session.secretKey.prefix}`);
    else notes.push(`could not revoke ${session.secretKey.prefix} (${r.data.error ?? r.status}); revoke it at minimoji.com/developers/keys`);
  }
  await call(ctx, base, "POST", "/cli/logout", { token: session.token, allow: [401] });
  delete creds.deployments[base];
  await writeCredentials(ctx, creds);
  return out({ signedOut: true, notes }, [`Signed out of ${base}.`, ...notes.map((n) => `  ${n}`)].join("\n"));
}

export async function whoami(ctx, base, _opts, out) {
  const who = await sessionCall(ctx, base, "GET", "/cli/whoami");
  return out({ ...account(who), base }, `${describe(who)} on ${base}${who.session?.label ? ` (this terminal: ${who.session.label})` : ""}`);
}

export async function keys(ctx, base, opts, out, [sub, ...rest]) {
  if (sub === "list" || sub === undefined) {
    const { keys } = await sessionCall(ctx, base, "GET", "/cli/keys");
    const rows = keys.map((k) => [k.prefix, k.kind, k.revokedAt ? "revoked" : "live", k.label, day(k.createdAt), k.lastUsedAt ? day(k.lastUsedAt) : "never"]);
    return out({ keys }, keys.length ? table([["PREFIX", "KIND", "STATE", "LABEL", "CREATED", "LAST USED"], ...rows]) : "No keys yet. minimoji keys create --kind publishable mints one.");
  }
  if (sub === "create") {
    if (!["publishable", "secret"].includes(opts.kind)) throw new CliError("keys create needs --kind publishable (lives in an app) or --kind secret (a server's)");
    const made = await sessionCall(ctx, base, "POST", "/cli/keys", { kind: opts.kind, ...(opts.label ? { label: opts.label } : {}) });
    return out({ key: made.key, prefix: made.prefix, kind: made.kind, label: opts.label ?? null },
      `${made.key}\n\nA ${made.kind} key (${made.prefix}). This is the only time it is shown in full: keep it now.${made.kind === "secret" ? " Never put a secret key in an app." : ""}`);
  }
  if (sub === "revoke") {
    const prefix = rest[0];
    if (!prefix) throw new CliError("keys revoke needs the key's prefix as minimoji keys list shows it, e.g. mk_pub_1a2b…9f0e");
    const r = await sessionCall(ctx, base, "POST", "/cli/keys/revoke", { prefix });
    // forget the CLI's own key if that is the one revoked
    const { creds, session } = await requireSession(ctx, base);
    if (session.secretKey?.prefix === r.revoked) { delete session.secretKey; await writeCredentials(ctx, creds); }
    return out({ revoked: r.revoked }, `Revoked ${r.revoked}.`);
  }
  throw new CliError(`unknown keys command "${sub}"; try list, create or revoke`);
}

const account = (who) => ({ email: who.email ?? null, name: who.name ?? null, session: who.session ?? null });
const describe = (who) => who.email ?? who.name ?? "your account";
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** columns padded to their widest cell */
export function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? "").length)));
  return rows.map((r) => r.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}
