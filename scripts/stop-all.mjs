// Stops the stack that scripts/start-all.mjs runs: the launcher and every part under it.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pidFile = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "logs", "start-all.pid");
let pid;
try {
  pid = readFileSync(pidFile, "utf8").trim();
} catch {
  console.log("beebots is not running (no pid file).");
  process.exit(0);
}
const r = spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { encoding: "utf8" });
console.log((r.stdout || r.stderr).trim());
rmSync(pidFile, { force: true });
