// Export a saved character's revision to Hyperdecks as an owner-private avatar, through
// Hyperdecks' OWN installed CLI (`hyperdecks avatar import`, its supported interface). This file
// never reads Hyperdecks' credentials, imports its code or handles its tokens: it runs the
// command with an argv array (no shell), always naming the environment, the expected destination
// account and an owner-only pack, and then checks every field of the answer against the request.
// Interface: Hyperdecks CLI 0.9.18 (@hypersocial/decks-cli, released 2026-11-14; #269 + #270); masked-face speech and
// bake 19 (attached mouth pieces) need 0.9.19 (#274, its player runs the official Minimoji heads runtime).
import { execFile } from "node:child_process";

export const HYPERDECKS_IMPORT_VERSION = "0.9.18";
// From 0.9.18 the CLI sends requirePrivate with every pack import and FAILS CLOSED (private_not_enforced,
// exit 1) unless the server confirms the pack was private and ungranted; its success answer then does not
// repeat the flag. An older or unknown CLI gives no such guarantee, so export refuses to run it at all
// (supportedHyperdecks, checked before the import): a pack shared between its checks would go through.
export const FAILS_CLOSED_FROM = "0.9.18";
// Exact stable versions only: "0.9.18", nothing embedded, no prerelease or build suffix.
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const semver = (v) => (STABLE.exec(String(v ?? "")) ?? []).slice(1).map(Number);
const atLeast = (version, min) => {
  const [a, b, c] = semver(version), [x, y, z] = semver(min);
  if (a == null) return false;
  return a !== x ? a > x : b !== y ? b > y : c >= z;
};
export function failsClosed(version) { return atLeast(version, FAILS_CLOSED_FROM); }
// From 0.9.19 (Hyperdecks #274) the destination shows a masked head's speech (indicator) and attached mouth
// pieces (bake 19): its player runs the official Minimoji heads runtime that has them and its import accepts
// bake 19. Such a head is refused for an older CLI before anything is imported.
export const RUNTIME_FEATURES_FROM = "0.9.19";
/** what a head file needs from the destination: indicator speech or bake 19 need RUNTIME_FEATURES_FROM */
export function hyperdecksNeeds({ bakeVersion, speech }) {
  const why = [speech === "indicator" && "masked-face speech (indicator)", bakeVersion >= 19 && "attached mouth pieces (bake 19)"].filter(Boolean);
  return why.length ? { min: RUNTIME_FEATURES_FROM, why } : { min: FAILS_CLOSED_FROM, why: [] };
}

/** the installed Hyperdecks CLI: { version } with its exact stable version, or null when the answer is anything
 *  else (a prerelease, extra text, an error), and { missing: true } when it is not installed; `run` is
 *  injectable for tests. The whole trimmed answer must be one x.y.z. */
export function hyperdecksVersion({ bin = "hyperdecks", run = execFile, env = process.env } = {}) {
  return new Promise((resolve) => run(bin, ["--version"], { env, timeout: 60000, windowsHide: true }, (error, stdout) => {
    if (error?.code === "ENOENT") return resolve({ version: null, missing: true });
    const text = String(stdout ?? "").trim();
    resolve({ version: error || !STABLE.test(text) ? null : text, missing: false });
  }));
}

/** refuse an unsupported or unknown Hyperdecks CLI BEFORE anything is imported: only a CLI that fails closed
 *  on requirePrivate (the server re-checks the pack atomically with the upload) may be run */
export function supportedHyperdecks(version, needs = { min: FAILS_CLOSED_FROM, why: [] }) {
  if (failsClosed(version) && atLeast(version, needs.min)) return null;
  if (failsClosed(version)) return `Hyperdecks CLI ${version} cannot show this head: ${needs.why.join(" and ")} need ${needs.min} or later (a stable release)`;
  return version
    ? `Hyperdecks CLI ${version} is not supported: it does not refuse a pack that was shared after its own check (needs ${FAILS_CLOSED_FROM} or later, a stable release)`
    : `the Hyperdecks CLI version could not be read as a stable release (needs ${FAILS_CLOSED_FROM} or later)`;
}
const ID = /^[A-Za-z0-9_|:.-]{1,200}$/;

/** run `hyperdecks …args` and parse its one JSON answer; `run` is injectable for tests */
export function runHyperdecks(args, { bin = "hyperdecks", run = execFile, env = process.env } = {}) {
  return new Promise((resolve) => {
    run(bin, args, { env, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      let answer = null;
      try { answer = JSON.parse(String(stdout ?? "").trim() || "null"); } catch { /* not JSON: said below */ }
      if (error?.code === "ENOENT") return resolve({ ok: false, code: "hyperdecks-missing", error: `the hyperdecks CLI is not installed (${bin})` });
      if (!answer || typeof answer !== "object") return resolve({ ok: false, code: "hyperdecks-output", error: `hyperdecks answered without JSON${error ? ` (exit ${error.code})` : ""}` });
      if (error || answer.ok === false) {
        // exit 2: refused before any upload; exit 1: failed during or after it — a head may be
        // stored (upload_uncertain / stored_unverified carry its avatarId), and a retry dedupes
        const exit = typeof error?.code === "number" ? error.code : null;
        // conservative: only a plain exit-2 refusal reads as "nothing uploaded"; private_not_enforced
        // (an old server refusing requirePrivate, or a missing acknowledgement) may have stored a head
        const uncertain = answer.code === "private_not_enforced" || ["upload_uncertain", "stored_unverified"].includes(answer.code) || typeof answer.avatarId === "string";
        return resolve({ ok: false, code: answer.code ?? "hyperdecks-failed", error: String(answer.error ?? `exit ${exit}`), exit,
          uploaded: uncertain ? "maybe" : exit === 2 ? false : null, ...(typeof answer.avatarId === "string" ? { avatarId: answer.avatarId } : {}) });
      }
      resolve({ ok: true, answer });
    });
  });
}

/** the argv for one import: environment, expected account and pack are always passed */
export function importArgs({ glb, metadata, pack, expectAccount, env }) {
  if (!["prod", "dev"].includes(env)) throw new Error("env must be prod or dev");
  // Hyperdecks' own pack id shape (avatar-import.mjs): refused here, before any call
  if (!/^[a-z0-9]{16,64}$/.test(pack ?? "")) throw new Error("an owner-only Hyperdecks pack id is required (16-64 lowercase letters and digits: hyperdecks avatar pack list --json)");
  if (!ID.test(expectAccount ?? "")) throw new Error("the expected Hyperdecks account id is required");
  return ["avatar", "import", glb, "--metadata", metadata, "--pack", pack, "--expect-account", expectAccount, "--json", `--${env}`];
}

/** the answer must be exactly what was asked for, else the export is refused */
export function verifyImport(answer, want, { cliVersion = null } = {}) {
  const problems = [];
  if (answer?.owner?.id !== want.expectAccount) problems.push(`it went to account ${answer?.owner?.id ?? "?"}, not ${want.expectAccount}`);
  if (answer?.packId !== want.pack) problems.push(`it went to pack ${answer?.packId ?? "?"}, not ${want.pack}`);
  if (answer?.sha256 !== want.sha256) problems.push("the stored head's sha256 is not the exported revision's");
  if (answer?.bakeVersion !== want.bakeVersion) problems.push(`it was stored at bake ${answer?.bakeVersion ?? "?"}, not ${want.bakeVersion}`);
  if (answer?.visibility !== "private") problems.push(`it is ${answer?.visibility ?? "of unknown visibility"}, not private`);
  // the server's guarantee that the pack is private and ungranted: echoed, or implied by a CLI that fails closed
  if (answer?.requirePrivate !== true && !failsClosed(cliVersion))
    problems.push(`the destination did not confirm it enforced a private, ungranted pack (requirePrivate)${cliVersion ? `; Hyperdecks CLI ${cliVersion} does not fail closed (needs ${FAILS_CLOSED_FROM}+)` : "; the Hyperdecks CLI version is unknown"}`);
  if (answer?.defaultChanged !== false) problems.push("it changed the account's default avatar");
  if (typeof answer?.avatarId !== "string" || !answer.avatarId) problems.push("no destination avatar id came back");
  return problems;
}

/** the destination receipt: an independent copy in Hyperdecks, managed there (revoking a Minimoji
 *  grant does not delete it), pinned to the exported revision and digest */
export function receipt(answer, want) {
  return {
    destination: "hyperdecks", env: want.env, account: { id: answer.owner.id, email: answer.owner.email ?? null },
    avatarId: answer.avatarId, packId: answer.packId, created: !!answer.created, reused: !!answer.reused,
    character: want.character, revision: want.revision, variant: want.variant, sha256: answer.sha256, bakeVersion: answer.bakeVersion,
    stockVoice: answer.stockVoice ?? null, visibility: "private",
    speaker: `[speaker: #guest${answer.stockVoice ? ` voice=${answer.stockVoice}` : ""} avatar=${answer.avatarId} name="${want.name.replace(/"/g, "'")}"]`,
    cameo: `data-hd-avatar="${answer.avatarId}"`,
    managedAt: "Hyperdecks (this copy stays until you remove it there; revoking a Minimoji grant does not delete it)",
    interface: HYPERDECKS_IMPORT_VERSION, hyperdecksCli: want.cliVersion ?? null,
  };
}
