#!/usr/bin/env node
// the `minimoji` command: the real process behind main() — its argv, its
// environment, a real browser and clock. Everything else is in main.js.
import { spawn } from "node:child_process";
import { hostname, homedir } from "node:os";
import { main } from "./main.js";

/** open a URL in the person's browser; false when there is none to open */
function openURL(url) {
  // only web pages: a URL the service sent must not open a file or an app
  if (process.env.MINIMOJI_NO_BROWSER || !/^https:\/\//.test(url)) return false;
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const code = await main(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  hostname: hostname().replace(/\.local$/, ""),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  fetch: globalThis.fetch,
  open: openURL,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});
process.exitCode = code;
