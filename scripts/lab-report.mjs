// A/B/C lab scoreboard: every bee in every lab, from each lab's own database (read-only, safe while running).
// Usage: node scripts/lab-report.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const LABS = [
  { lab: "lab1", variable: "min hold", dir: DATA },
  { lab: "lab2", variable: "stop width", dir: join(DATA, "lab2") },
  { lab: "lab3", variable: "coin range", dir: join(DATA, "lab3") },
];
const START = 333;
const pct = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

for (const l of LABS) {
  const dbPath = join(l.dir, "bees-dry.sqlite");
  if (!existsSync(dbPath)) continue;
  const names = JSON.parse(readFileSync(join(l.dir, "settings.json"), "utf8")).bees.map((b) => b.name);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const since = Number(db.prepare("select v from meta where k = 'experiment_started_at'").get()?.v ?? 0);
  const hours = ((Date.now() - since) / 3_600_000).toFixed(1);
  console.log(`\n${l.lab} (${l.variable}), running ${hours}h`);
  const rows = db.prepare("select bee, json from bee_state order by bee").all().map((r, i) => {
    const s = JSON.parse(r.json);
    const t = s.totals;
    // Worst drop from a running equity peak, from the 10 s snapshots.
    let peak = START;
    let maxDd = 0;
    for (const { e } of db.prepare("select equity_usd e from equity_snapshots where bee = ? order by ts").iterate(r.bee)) {
      peak = Math.max(peak, e);
      maxDd = Math.max(maxDd, (peak - e) / peak);
    }
    return {
      bee: names[i] ?? r.bee,
      pnl: pct(((s.equityUsd - START) / START) * 100),
      equity: `$${s.equityUsd.toFixed(2)}`,
      maxDrawdown: pct(-maxDd * 100),
      orders: t.orders,
      realised: `$${t.realisedUsd.toFixed(2)}`,
      fees: `$${t.feesUsd.toFixed(2)}`,
      holding: s.position ? `${s.position.coin} ${s.position.side}` : "flat",
    };
  });
  console.table(rows);
}
