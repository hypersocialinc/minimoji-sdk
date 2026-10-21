// SETTING AN APP UP — `minimoji init` finds what kind of project the folder
// is, mints a publishable key labelled after it, and writes the key where
// that kind of project reads config. It never writes a secret key into an
// app: the only key it mints is publishable, and it checks before writing.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { CliError, sessionCall } from "./service.js";
import { addSkills } from "./skills.js";

const PUBLISHABLE = /^mk_pub_[0-9a-f]{40}$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "build", "Build", "DerivedData", "Pods", "Carthage", ".build", ".swiftpm", "dist", ".next"]);

/** what the folder is: a web app (a package.json with React; Next or Vite
 *  named when present) or a Swift one (an Xcode project, xcodegen's
 *  project.yml, or a Package.swift) */
export async function detectProject(cwd) {
  const entries = await readdir(cwd).catch(() => []);
  const found = [];
  if (entries.includes("package.json")) {
    let pkg = {};
    try { pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")); } catch { /* not JSON: not a web app we can read */ }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.react || deps.next) {
      found.push({ platform: "web", framework: deps.next ? "next" : deps.vite ? "vite" : "react", name: String(pkg.name ?? basename(cwd)).replace(/^@[^/]+\//, "") });
    }
  }
  const xcodeproj = entries.find((e) => e.endsWith(".xcodeproj"));
  if (xcodeproj || entries.includes("project.yml") || entries.includes("Package.swift")) {
    found.push({ platform: "swift", framework: xcodeproj ? "xcode" : entries.includes("project.yml") ? "xcodegen" : "swiftpm", name: xcodeproj ? basename(xcodeproj, ".xcodeproj") : basename(cwd), xcodeproj });
  }
  return found;
}

/** the variables a web app reads: Next and Vite only show the browser what is prefixed */
export function webVars(framework) {
  const prefix = framework === "next" ? "NEXT_PUBLIC_" : framework === "vite" ? "VITE_" : "";
  return { key: `${prefix}MINIMOJI_KEY`, service: `${prefix}MINIMOJI_SERVICE_URL` };
}
export const SWIFT_VARS = { key: "MINIMOJI_PUBLISHABLE_KEY", service: "MINIMOJI_SERVICE_URL" };

export async function init(ctx, base, opts, out) {
  const cwd = ctx.cwd;
  let found = await detectProject(cwd);
  if (opts.platform) {
    if (!["swift", "web"].includes(opts.platform)) throw new CliError("--platform is swift or web");
    found = found.filter((p) => p.platform === opts.platform);
    if (!found.length) found = [{ platform: opts.platform, framework: opts.platform === "web" ? "react" : "swiftpm", name: basename(cwd) }];
  }
  if (!found.length) throw new CliError("no Xcode project, project.yml, Package.swift or React package.json here; run minimoji init in your app's folder, or pass --platform swift|web");
  if (found.length > 1) throw new CliError("this folder is both a web app and a Swift project; pass --platform swift or --platform web");
  const project = found[0];

  const target = project.platform === "web" ? await webTarget(cwd, project) : await swiftTarget(cwd, project, opts);
  // a key already in place stays, unless it is a secret one (which must not
  // be in an app) or another deployment's (keys are per deployment)
  const otherDeployment = Boolean(target.current && target.currentService && target.currentService.replace(/\/$/, "") !== base);
  let key = opts.force || otherDeployment ? null : target.current;
  const replacedSecret = [target.current, target.otherKey].some((k) => /^mk_sec_/.test(k ?? ""));
  if (key && !PUBLISHABLE.test(key)) key = null;
  let minted = null;
  if (!key) {
    minted = await sessionCall(ctx, base, "POST", "/cli/keys", { kind: "publishable", label: `${project.name} (minimoji init)`.slice(0, 60) });
    key = minted.key;
  }
  if (!PUBLISHABLE.test(key)) throw new CliError("refusing to write a key that is not a publishable mk_pub_ key into an app");
  const wrote = await target.write(key, base);

  // the key is written by now: a skill that cannot be fetched is reported, not a failed init
  let skills = null, skillError = null;
  if (opts["with-skill"]) {
    try { skills = await addSkills(ctx, opts, [SKILL_FOR[project.platform]]); } catch (error) {
      if (!(error instanceof CliError)) throw error;
      skillError = error.message;
    }
  }
  const next = nextSteps(project, target).filter((n) => !(skills && n.includes("skills add")));
  const human = [
    `${project.name}: a ${project.platform === "web" ? `${{ next: "Next.js", vite: "Vite", react: "React" }[project.framework]} app` : `Swift project (${project.framework})`}.`,
    minted ? `Minted a publishable key ${minted.prefix} labelled "${project.name} (minimoji init)".` : `Kept the publishable key already in ${relative(cwd, target.file) || target.file}.`,
    ...(otherDeployment ? [`The key there was for ${target.currentService}; this one is for ${base}.`] : []),
    ...(replacedSecret ? ["Replaced a SECRET key that was in the app: revoke it with minimoji keys revoke, it has shipped wherever this file went."] : []),
    ...wrote.map((w) => `Wrote ${w.vars.join(" and ")} to ${relative(cwd, w.file) || w.file}.`),
    ...(skills ? skills.installed.map((s) => `Installed the ${s.name} skill in ${relative(cwd, s.dir)}.`) : []),
    ...(skillError ? [`Did not install the ${SKILL_FOR[project.platform]} skill: ${skillError}.`] : []),
    "",
    "Next:",
    ...next.map((n) => `  ${n}`),
  ];
  return out({ project, key: { prefix: minted?.prefix ?? `${key.slice(0, 11)}…${key.slice(-4)}`, kind: "publishable", minted: Boolean(minted) }, replacedSecret, wrote: wrote.map((w) => ({ ...w, file: relative(cwd, w.file) })), skills, ...(skillError ? { skillError } : {}), next }, human.join("\n"));
}

async function webTarget(cwd, project) {
  const vars = webVars(project.framework);
  const file = join(cwd, ".env.local");
  const text = await readFile(file, "utf8").catch(() => "");
  return {
    file, vars,
    current: envValue(text, vars.key),
    currentService: envValue(text, vars.service),
    async write(key, base) {
      const now = await readFile(file, "utf8").catch(() => "");
      await writeFile(file, upsertEnv(upsertEnv(now, vars.key, key), vars.service, base));
      return [{ file, vars: [vars.key, vars.service] }];
    },
  };
}

/** the demo app's convention (apps/minimoji-ios): MINIMOJI_PUBLISHABLE_KEY and
 *  MINIMOJI_SERVICE_URL in the app's Info.plist, and in project.yml's info
 *  properties when xcodegen writes that plist. A project whose plist Xcode
 *  generates (no Info.plist file) gets a Minimoji.plist in the app folder:
 *  Xcode 16's synchronized folders take it in as a resource */
async function swiftTarget(cwd, project, opts) {
  const plists = opts.plist ? [resolve(cwd, opts.plist)] : await findInfoPlists(cwd, 4);
  if (plists.length > 1) throw new CliError(`found ${plists.length} Info.plist files (${plists.map((p) => relative(cwd, p)).join(", ")}); pass --plist with the app's`);
  const projectYml = join(cwd, "project.yml");
  const yml = await readFile(projectYml, "utf8").catch(() => null);
  const ymlHasKey = yml != null && new RegExp(`^\\s*${SWIFT_VARS.key}:`, "m").test(yml);
  let plist = plists[0] ?? null, ownPlist = false;
  if (!plist) {
    const appDir = project.xcodeproj ? join(cwd, basename(project.xcodeproj, ".xcodeproj")) : cwd;
    plist = join((await isDir(appDir)) ? appDir : cwd, "Minimoji.plist");
    ownPlist = true;
  }
  const text = await readFile(plist, "utf8").catch(() => null);
  if (text != null && !text.trimStart().startsWith("<")) throw new CliError(`${relative(cwd, plist)} is a binary plist; convert it with plutil -convert xml1 first`);
  if (text != null && !text.includes("</dict>")) throw new CliError(`${relative(cwd, plist)} has no root <dict>`);
  return {
    file: plist, ownPlist, yml: yml != null && !ymlHasKey ? projectYml : null,
    current: (ymlHasKey ? ymlValue(yml, SWIFT_VARS.key) : null) ?? (text ? plistValue(text, SWIFT_VARS.key) : null),
    otherKey: ymlHasKey && text ? plistValue(text, SWIFT_VARS.key) : null,
    currentService: (ymlHasKey ? ymlValue(yml, SWIFT_VARS.service) : null) ?? (text ? plistValue(text, SWIFT_VARS.service) : null),
    async write(key, base) {
      const wrote = [];
      const vars = [SWIFT_VARS.key, SWIFT_VARS.service];
      const now = (await readFile(plist, "utf8").catch(() => null)) ?? EMPTY_PLIST;
      await writeFile(plist, upsertPlist(upsertPlist(now, SWIFT_VARS.key, key), SWIFT_VARS.service, base));
      wrote.push({ file: plist, vars });
      if (ymlHasKey) {
        await writeFile(projectYml, upsertYml(upsertYml(yml, SWIFT_VARS.key, key), SWIFT_VARS.service, base));
        wrote.push({ file: projectYml, vars });
      }
      return wrote;
    },
  };
}

/** the agent skill `--with-skill` installs for each platform */
const SKILL_FOR = { web: "minimoji-web", swift: "minimoji-swift" };

function nextSteps(project, target) {
  if (project.platform === "web") {
    return [
      `Read the key in the app as process.env.${target.vars.key}${project.framework === "vite" ? ` (import.meta.env.${target.vars.key} in Vite)` : ""} and the service as ${target.vars.service}.`,
      ...(project.framework === "react" ? ["Unprefixed variables are not shown to a browser bundle: rename them for your bundler (REACT_APP_…, EXPO_PUBLIC_…) if it needs a prefix."] : []),
      "@minimoji/react is not on npm yet: ask Minimoji for access before adding it.",
      "Saving avatars (POST /avatars) needs a secret key on your server: minimoji keys create --kind secret.",
      "Teach your coding agent the React package: minimoji skills add minimoji-web.",
    ];
  }
  const read = target.ownPlist
    ? `let config = NSDictionary(contentsOf: Bundle.main.url(forResource: "Minimoji", withExtension: "plist")!)!; then config["${SWIFT_VARS.key}"] and config["${SWIFT_VARS.service}"]`
    : `Bundle.main.object(forInfoDictionaryKey: "${SWIFT_VARS.key}") and "${SWIFT_VARS.service}"`;
  return [
    "Add the package https://github.com/hypersocialinc/MinimojiKit (private today: the machine needs GitHub access to it).",
    `Make the service from the config: AvatarService(base: URL(string: service)!, key: key), reading ${read}.`,
    ...(target.ownPlist ? ["Minimoji.plist sits in the app folder; on an Xcode project without synchronized folders, add it to the app target."] : []),
    ...(target.yml ? [`project.yml regenerates Info.plist: add ${SWIFT_VARS.key} and ${SWIFT_VARS.service} under the target's info.properties too.`] : []),
    "Teach your coding agent the Kit: minimoji skills add minimoji-swift.",
  ];
}

// files, as text: small, line-oriented edits that leave the rest alone

export function envValue(text, name) {
  const m = text.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?([^"'\\s#]*)`, "m"));
  return m ? m[1] : null;
}
export function upsertEnv(text, name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
}

const EMPTY_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
`;
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plistValue(text, name) {
  const m = text.match(new RegExp(`<key>${name}</key>\\s*(?:<string>([^<]*)</string>|<string\\s*/>)`));
  return m ? m[1] ?? "" : null;
}
/** set a top-level string; a new one goes before the root dict's close */
export function upsertPlist(text, name, value) {
  const re = new RegExp(`(<key>${name}</key>\\s*)(?:<string>[^<]*</string>|<string\\s*/>)`);
  if (re.test(text)) return text.replace(re, `$1<string>${xml(value)}</string>`);
  const close = text.lastIndexOf("</dict>");
  if (close < 0) throw new CliError("the plist has no root <dict>");
  return `${text.slice(0, close)}\t<key>${name}</key>\n\t<string>${xml(value)}</string>\n${text.slice(close)}`;
}

function ymlValue(text, name) {
  const m = text.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\s#]+)`, "m"));
  return m ? m[1] : null;
}
/** set a value in project.yml's info properties; the caller only edits a
 *  yml that carries the key, and a missing one goes beside it */
export function upsertYml(text, name, value) {
  const re = new RegExp(`^([ \\t]*${name}:[ \\t]*).*$`, "m");
  if (re.test(text)) return text.replace(re, `$1${value}`);
  const key = text.match(new RegExp(`^([ \\t]*)${SWIFT_VARS.key}:.*$`, "m"));
  return key ? text.replace(key[0], `${key[0]}\n${key[1]}${name}: ${value}`) : text;
}

async function findInfoPlists(dir, depth) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile() && e.name === "Info.plist") out.push(join(dir, e.name));
    else if (e.isDirectory() && depth > 0 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".") && !/\.(xcodeproj|xcworkspace|xcassets|bundle|framework|app)$/.test(e.name) && !/Tests$/.test(e.name)) {
      out.push(...(await findInfoPlists(join(dir, e.name), depth - 1)));
    }
  }
  return out;
}

async function isDir(path) {
  try { return (await readdir(path)) !== null; } catch { return false; }
}
