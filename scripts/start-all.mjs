// Local view of the beebots VPS: an SSH link to the lab engines, the three lab dashboards (:4173-4175) and the overview
// (:4170), all on 127.0.0.1 only. Each part restarts when it exits. The public site, the engines and the Cloudflare
// tunnel all run on the VPS (deploy/vps/), so this is optional and the PC may sleep. Started at Windows logon by the
// "beebots" scheduled task (scripts/beebots-hidden.vbs); stop it with `node scripts/stop-all.mjs`. Logs: data/logs/<part>.log
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = join(ROOT, "dashboard");
const LOGS = join(ROOT, "data", "logs");
const NODE = process.execPath;
const VITE = join(DASH, "node_modules", "vite", "bin", "vite.js");
/** Held while the stack runs, so a second launcher (a second logon, a manual start) exits instead of fighting it. */
const LOCK_PORT = 8790;
// The three A/B/C lab engines run on the VPS (systemd beebots@lab1..3 in /opt/beebots); an SSH forward brings each
// engine port here.
const VPS = process.env.BEEBOTS_VPS || "ubuntu@132.145.99.2";
const VPS_KEY = join(process.env.USERPROFILE ?? "", ".ssh", "beebots_vps");
const LABS = [
  { name: "lab1", port: 8080, site: 4173 },
  { name: "lab2", port: 8081, site: 4174 },
  { name: "lab3", port: 8082, site: 4175 },
];

const PARTS = [
  {
    name: "vps-link",
    cmd: "ssh",
    args: [
      "-i", VPS_KEY, "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
      ...LABS.flatMap((l) => ["-L", `127.0.0.1:${l.port}:127.0.0.1:${l.port}`]),
      VPS,
    ],
    cwd: ROOT,
  },
  ...LABS.map((l) => ({ name: `${l.name}-site`, cmd: NODE, args: [VITE, "preview", "--port", String(l.site), "--strictPort"], cwd: DASH, env: { ENGINE_URL: `http://127.0.0.1:${l.port}` } })),
  { name: "overview", cmd: NODE, args: [join(ROOT, "scripts", "overview.mjs")], cwd: ROOT },
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
    const child = spawn(part.cmd, part.args, { cwd: part.cwd, windowsHide: true, env: { ...process.env, ...part.env } });
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
