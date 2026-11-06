// THE NUMBERS FROM A TERMINAL — what minimoji.com/admin/numbers shows, for a
// terminal an admin signed in (GET /cli/admin/*, convex/http.ts). Read-only.
// Not in `minimoji --help` or the README: not a secret (the server refuses
// anyone who is not a Minimoji admin), just not for developers.
import { CliError, sessionCall } from "./service.js";
import { table } from "./auth.js";

const USAGE = "minimoji admin numbers | overview | people | recent [--days n] [--today YYYY-MM-DD] [--json]";
const NOT_ADMIN = "this account is not a Minimoji admin, or this terminal's admin week ran out (minimoji login --force signs it in again)";

/** the headline rows: [label, where the count lives] */
export const HEADLINE = [
  ["People: first Mini avatar", ["people", "madeAvatar"]],
  ["People: first app connect", ["people", "connected"]],
  ["Accounts", ["series", "account"]],
  ["Mini avatars kept", ["series", "avatar"]],
  ["Keys minted", ["series", "key"]],
  ["Saves", ["series", "save"]],
  ["Bakes", ["series", "bake"]],
  ["Generations", ["series", "generate"]],
  ["Lines", ["series", "lines"]],
  ["Says", ["series", "say"]],
  ["Picks", ["series", "pick"]],
  ["Connects started", ["series", "connectStart"]],
];
/** the route metrics whose errors are a failing route (convex/lib/numbers.ts ROUTE_METRICS; a test pins them equal) */
export const ROUTES = ["save", "bake", "pack", "generate", "lines", "say", "pick", "connectStart", "connectGrant"];

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** one admin route, a 403 said as the plain line it means */
async function read(ctx, base, path, query) {
  const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null)).toString();
  try {
    return await sessionCall(ctx, base, "GET", `/cli/admin/${path}${search ? `?${search}` : ""}`);
  } catch (error) {
    if (error.status === 403) throw Object.assign(new CliError(NOT_ADMIN), { status: 403 });
    throw error;
  }
}

/** `--today` and `--days` as the routes take them; today is the UTC day */
function window(ctx, opts, fallbackDays) {
  const today = opts.today ?? utcDay(ctx.now?.() ?? Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new CliError(`--today must be a UTC day, YYYY-MM-DD; usage: ${USAGE}`);
  const days = opts.days ?? fallbackDays;
  if (days != null && !/^\d+$/.test(String(days))) throw new CliError(`--days must be a whole number; usage: ${USAGE}`);
  return { today, days: days == null ? undefined : String(days) };
}

/** the summary `minimoji admin numbers` prints: today, yesterday and the
 *  window per headline, the top apps and the routes that failed, from the
 *  overview and people answers as the routes give them */
export function summarize(overview, people) {
  const n = overview.days.length;
  const counts = (which) => {
    const [from, key] = which;
    const daily = from === "people" ? people[key] : (overview.series[key] ?? []).map((p) => p.n);
    return { today: daily[n - 1] ?? 0, yesterday: daily[n - 2] ?? 0, window: daily.reduce((a, b) => a + b, 0) };
  };
  const headline = Object.fromEntries(HEADLINE.map(([label, which]) => [which[1], { label, ...counts(which) }]));
  const apps = overview.apps.slice(0, 10).map((a) => {
    const sum = (f) => a.daily.reduce((s, d) => s + d[f], 0);
    return { label: a.label, prefix: a.prefix, ownerKind: a.ownerKind, revoked: a.revoked, today: a.daily[n - 1]?.n ?? 0, window: a.n, calls: sum("calls"), errors: sum("errors") };
  });
  const failing = ROUTES.map((metric) => {
    const points = overview.series[metric] ?? [];
    const calls = points.reduce((s, p) => s + p.n, 0), errors = points.reduce((s, p) => s + p.errors, 0);
    return { metric, calls, errors, today: points[n - 1]?.errors ?? 0 };
  }).filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors);
  return { today: overview.days[n - 1], days: n, headline, apps, failing, capped: people.capped, truncated: overview.truncated };
}

export function summaryText(s) {
  const lines = [`Minimoji numbers for ${s.today} (UTC), against the last ${s.days} days`, ""];
  lines.push(table([["", "today", "yesterday", `${s.days} days`], ...Object.values(s.headline).map((h) => [h.label, h.today, h.yesterday, h.window])]));
  lines.push("", `Top apps (${s.days} days)`);
  lines.push(s.apps.length
    ? table([["app", "key", "today", `${s.days} days`, "errors"], ...s.apps.map((a) => [`${a.label}${a.revoked ? " (revoked)" : ""}${a.ownerKind === "ops" ? " [ops]" : ""}`, a.prefix, a.today, a.window, a.errors])])
    : "  none yet");
  lines.push("", `Failing routes (${s.days} days)`);
  lines.push(s.failing.length
    ? table(s.failing.map((f) => [f.metric, `${f.errors} of ${f.calls} failed`, `${f.today} today`]))
    : "  none");
  if (s.capped) lines.push("", "People counts are at least these: a scan hit its bound.");
  if (s.truncated.length) lines.push("", `Days with more rows than read: ${s.truncated.join(", ")}`);
  return lines.join("\n");
}

export async function admin(ctx, base, opts, out, [sub, ...extra]) {
  if (extra.length) throw new CliError(`one subcommand at a time; usage: ${USAGE}`);
  switch (sub) {
    case "numbers": {
      const w = window(ctx, opts, 7);
      const [overview, people] = await Promise.all([read(ctx, base, "overview", w), read(ctx, base, "people", w)]);
      const summary = summarize(overview, people);
      return out(summary, summaryText(summary));
    }
    case "overview":
    case "people": {
      const data = await read(ctx, base, sub, window(ctx, opts));
      return out(data, JSON.stringify(data, null, 2));
    }
    case "recent": {
      if (opts.days != null) throw new CliError("recent takes no --days: it is the latest 50 events and 30 days of timings");
      const data = await read(ctx, base, "recent", { today: window(ctx, opts).today });
      return out(data, JSON.stringify(data, null, 2));
    }
    default:
      throw new CliError(`${sub ? `unknown admin subcommand "${sub}"` : "admin wants a subcommand"}; usage: ${USAGE}`);
  }
}

export const ADMIN_USAGE = USAGE;
