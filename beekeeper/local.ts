// The Beekeeper without Zapier: the same nine-step round as the shared Zap (README.md in this folder), run on this
// machine. Jev picks the bee, Claude (the local `claude` CLI, on your Claude plan) writes its new rules.
//
// Run:  node node_modules/tsx/dist/cli.mjs --env-file-if-exists=.env beekeeper/local.ts
// Then point the engine at it in .env:
//   BEEKEEPER_WEBHOOK_URL=http://127.0.0.1:8787/hook
//   PUBLIC_URL=http://127.0.0.1:8080
//
// The engine still enforces every safety rule (rules text and coins only, one rewrite per bee per 20 hours, a
// single-use 15-minute key). The diary is data/beekeeper-diary.jsonl, one line per round.
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as SDK from "@typesafe-ai/sdk" with { "resolution-mode": "require" };
import { askClaude } from "../src/claude.js";

const require = createRequire(import.meta.url);
const { TypeSafeClient, choice, noul, score } = require("@typesafe-ai/sdk") as typeof SDK;

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BEEKEEPER_PORT) || 8787;
const SETTINGS = process.env.SETTINGS_PATH?.trim() || "./data/settings.json";
const DIARY = process.env.BEEKEEPER_DIARY?.trim() || "./data/beekeeper-diary.jsonl";
const MODEL = process.env.CLAUDE_KEEPER_MODEL?.trim() || "claude-opus-5-5";
const JEV_MODEL = process.env.JEV_MODEL?.trim() || "jev-1.13.0";
const MIN_CONFIDENCE = 0.6;

function jevKey(): string {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return env;
  try {
    const k = (JSON.parse(readFileSync(SETTINGS, "utf8")) as { jevKey?: string }).jevKey;
    if (k) return k;
  } catch {
    /* no Setup file yet */
  }
  throw new Error(`No Jev key: set TYPESAFE_API_KEY or finish Setup first (${SETTINGS}).`);
}

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

function diary(row: Record<string, unknown>) {
  mkdirSync(dirname(DIARY), { recursive: true });
  appendFileSync(DIARY, JSON.stringify({ when: new Date().toISOString(), ...row }) + "\n");
}

interface Hook {
  source?: string;
  alert?: string;
  round?: number;
  base_url?: string;
  key?: string;
}

interface Card {
  scorecard: string;
  playbook: string;
  universe: string;
  open_bees: string;
}

interface Rewrite {
  idea: string;
  rules: string;
  coins: string;
  reason: string;
  quip: string;
  note: string;
}

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "rules", "coins", "reason", "quip", "note"],
  properties: {
    idea: { type: "string" },
    rules: { type: "string" },
    coins: { type: "string", description: "comma-separated tickers, or empty to keep all" },
    reason: { type: "string" },
    quip: { type: "string" },
    note: { type: "string" },
  },
};

const ANGER = [
  "1: Down less than 5% since start, or up.",
  "2: Down 5% to 10% since start.",
  "3: Down 10% to 18% since start.",
  "4: Down 18% to 25% since start.",
  "5: Down more than 25% since start, or benched, or retired.",
] as const;

async function round(hook: Hook) {
  const base = String(hook.base_url ?? "").replace(/\/+$/, "");
  const key = String(hook.key ?? "");
  const row: Record<string, unknown> = { round: hook.round, source: hook.source ?? "manual", trigger: hook.alert || "scheduled round" };
  try {
    if (!/^https?:\/\//.test(base) || !key) throw new Error("this round came with no base_url or key");

    // Step 2: the scorecard.
    const card = (await (await fetch(`${base}/keeper/scorecard`)).json()) as Card;
    const alert = String(hook.alert ?? "").trim().slice(0, 300);
    const scorecard = card.scorecard + (alert ? `\n\nWhy the Beekeeper was called early: ${alert}` : "");

    // Step 3: Jev, broken or just unlucky?
    const jev = new TypeSafeClient({ apiKey: jevKey(), defaultModel: JEV_MODEL, logLevel: "off" });
    const r = await jev.systemOne({
      model: JEV_MODEL,
      state: scorecard,
      questions: {
        broken: noul("Is at least one of the three bees losing because its rules are wrong for this market, rather than just unlucky?"),
        bee: choice(
          "Which bee should the Beekeeper rewrite this round? Pick the bee whose rules are failing, and only a bee the scorecard marks Rewrite: OPEN. Pick none if all three should be left alone, or if the failing bee is LOCKED.",
          { bee1: "the first bee", bee2: "the second bee", bee3: "the third bee", none: "leave all three alone" },
        ),
        anger: score("How badly is the picked bee doing? Read its \"% since start\" and its cap off the scorecard.", ANGER),
      },
    });
    const a = r.answers;
    const bee = a.bee.confidence >= MIN_CONFIDENCE ? a.bee.choice : "unsure";
    const anger = a.anger.confidence >= MIN_CONFIDENCE ? String(Math.min(5, Math.max(1, Math.round(a.anger.score) + 1))) : "unsure";
    // Step 4: log Jev's verdict.
    Object.assign(row, { bee, broken: a.broken.noul, anger, confidence: a.bee.confidence, confidence_anger: a.anger.confidence, jev_model: r.model });

    // Step 5: only if Jev names an open bee.
    if (bee === "none" || bee === "unsure" || !String(card.open_bees).includes(bee)) {
      log("left them alone", { round: hook.round, bee });
      diary({ ...row, door_status: "not sent: Jev left them alone" });
      return;
    }

    // Step 6: Claude writes the new rules (the Zap's Opus prompt, unchanged).
    const prompt = readFileSync(join(HERE, "opus-prompt.txt"), "utf8")
      .replaceAll("{{bee}}", bee)
      .replaceAll("{{anger}}", anger === "unsure" ? "3" : anger)
      .replaceAll("{{playbook}}", card.playbook)
      .replaceAll("{{scorecard}}", scorecard)
      .replaceAll("{{universe}}", card.universe);
    const w = await askClaude<Rewrite>(prompt, "Write the new rules now. Answer only in the schema.", REWRITE_SCHEMA, MODEL, 300_000);
    // Step 7: log the new rules.
    Object.assign(row, w);

    // Step 8: sign and deliver to the lab door (same as step8-deliver.js).
    const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    const level = /[1-5]/.exec(anger);
    const body = JSON.stringify({
      bee,
      rules: clean(w.rules, 500),
      coins: String(w.coins ?? "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
      reason: clean(w.reason, 300),
      metrics: { source: "local-beekeeper", anger: level ? Number(level[0]) : 3, idea: clean(w.idea, 80), quip: clean(w.quip, 160) },
    });
    const ts = String(Date.now());
    const sig = createHmac("sha256", key).update(`${ts}.POST./lab/overlay.${body}`).digest("hex");
    const res = await fetch(`${base}/lab/overlay`, { method: "POST", headers: { "content-type": "application/json", "x-lab-ts": ts, "x-lab-sig": sig }, body });
    const reply = (await res.text()).slice(0, 1000);
    // Step 9: log the delivery.
    log(res.ok ? "rewrite delivered" : "rewrite bounced", { round: hook.round, bee, status: res.status, reply: res.ok ? undefined : reply });
    diary({ ...row, door_status: String(res.status), door_reply: reply, payload: body });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    log("round failed", { round: hook.round, err: message });
    diary({ ...row, door_status: `failed: ${message}` });
  }
}

jevKey(); // fail at start, not on the first round, when there is no key

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/hook") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (d: Buffer) => {
    raw += d.toString();
    if (raw.length > 16_384) req.destroy();
  });
  req.on("end", () => {
    let hook: Hook;
    try {
      hook = JSON.parse(raw) as Hook;
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Answer at once, like Zapier's Catch Hook: the engine waits 10 s at most. The round runs after.
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    log("round started", { round: hook.round, source: hook.source });
    void round(hook);
  });
}).listen(PORT, "127.0.0.1", () => log("local beekeeper listening", { hook: `http://127.0.0.1:${PORT}/hook`, model: MODEL }));
