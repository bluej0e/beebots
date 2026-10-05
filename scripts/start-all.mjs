// Runs the whole local beebots stack and keeps it running: engine, Beekeeper, the shared site (built dashboard on
// :4173) and the Cloudflare tunnel for beebots.covewrk.com. Each part restarts when it exits, like Docker's restart
// policy. Started at Windows logon by the "beebots" scheduled task (scripts/beebots-hidden.vbs); stop it with
// `node scripts/stop-all.mjs`. Logs: data/logs/<part>.log
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = join(ROOT, "dashboard");
const LOGS = join(ROOT, "data", "logs");
const NODE = process.execPath;
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const VITE = join(DASH, "node_modules", "vite", "bin", "vite.js");
const CLOUDFLARED = process.env.CLOUDFLARED_BIN || "C:\\cloudflared\\cloudflared.exe";
const TUNNEL_CONFIG = process.env.BEEBOTS_TUNNEL_CONFIG || join(process.env.USERPROFILE ?? "", ".cloudflared", "beebots.yml");
/** Held while the stack runs, so a second launcher (a second logon, a manual start) exits instead of fighting it. */
const LOCK_PORT = 8790;

const PARTS = [
  { name: "engine", cmd: NODE, args: [TSX, "--env-file-if-exists=.env", "src/index.ts"], cwd: ROOT },
  { name: "beekeeper", cmd: NODE, args: [TSX, "--env-file-if-exists=.env", "beekeeper/local.ts"], cwd: ROOT },
  { name: "site", cmd: NODE, args: [VITE, "preview"], cwd: DASH },
  // Only when a tunnel is set up (README: "Share it on your own domain"); without one the site stays local.
  ...(existsSync(TUNNEL_CONFIG)
    ? [{ name: "tunnel", cmd: CLOUDFLARED, args: ["--config", TUNNEL_CONFIG, "--metrics", "127.0.0.1:20299", "tunnel", "run", "beebots"], cwd: ROOT }]
    : []),
];

mkdirSync(LOGS, { recursive: true });

function logFile(name) {
  const path = join(LOGS, `${name}.log`);
  try {
    if (statSync(path).size > 20 * 1024 * 1024) truncateSync(path, 0);
  } catch {
    /* new file */
  }
  return createWriteStream(path, { flags: "a" });
}

// Synchronous, so the line is written even when the launcher exits right after (a second launch).
const say = (msg) => appendFileSync(join(LOGS, "start-all.log"), `${new Date().toISOString()} ${msg}\n`);

function run(part) {
  const out = logFile(part.name);
  let fails = 0;
  const start = () => {
    const began = Date.now();
    const child = spawn(part.cmd, part.args, { cwd: part.cwd, windowsHide: true, env: process.env });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    say(`${part.name} started (pid ${child.pid})`);
    const again = (why) => {
      // Quick crashes back off up to a minute; a part that ran a while restarts at once (the engine exits after Setup).
      fails = Date.now() - began < 30_000 ? fails + 1 : 0;
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(fails, 5));
      say(`${part.name} ${why}; restarting in ${wait / 1000} s`);
      setTimeout(start, wait);
    };
    child.on("error", (e) => again(`failed to start: ${e.message}`));
    child.on("exit", (code) => again(`exited with ${code}`));
  };
  start();
}

const lock = createServer();
lock.once("error", () => {
  say("already running; this launcher exits");
  process.exit(0);
});
lock.listen(LOCK_PORT, "127.0.0.1", () => {
  writeFileSync(join(LOGS, "start-all.pid"), String(process.pid));
  say(`starting the beebots stack (pid ${process.pid})`);
  // Build the shared site once per start, so it always serves the current dashboard code.
  const build = spawnSync(NODE, [VITE, "build"], { cwd: DASH, windowsHide: true, encoding: "utf8" });
  say(`dashboard build ${build.status === 0 ? "ok" : `failed: ${(build.stderr || build.stdout || "").slice(-500)}`}`);
  for (const part of PARTS) run(part);
});
