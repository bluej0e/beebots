// Local stand-in for Docker's restart policy: runs a command and starts it again whenever it exits.
// The engine exits on purpose after Setup saves, expecting to be restarted.
// Usage: node scripts/forever.mjs <command> [args...]
import { spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
let child;
const start = () => {
  child = spawn(cmd, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[forever] exited with ${code}; restarting in 2 s`);
    setTimeout(start, 2000);
  });
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (child?.kill(sig), process.exit(0)));
start();
