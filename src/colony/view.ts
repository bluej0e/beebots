// GET /colony/state: everything the colony dashboard shows, in one read. No secrets in here: DNA, scores and books only.
import type { Db } from "../db.js";
import type { Engine } from "../engine.js";
import { ROYAL_RULES, type Colony, type ColonyBee } from "./colony.js";
import { describeMutations, diff, GENE_NAMES, GENES, ORAKELIA } from "./genome.js";

type Snap = ReturnType<Engine["snapshot"]>;

export function colonyView(colony: Colony, snap: Snap, health?: { uptimeS: number; marketAgeMs: number }) {
  const books = new Map(snap.bees.map((b) => [b.bee, b]));
  const now = snap.ts;
  const bee = (b: ColonyBee) => {
    const live = books.get(b.id) ?? null;
    return {
      id: b.id,
      tier: b.tier,
      role: b.role,
      name: b.name,
      generation: b.generation,
      origin: b.origin,
      parent: b.parentId ? { id: b.parentId, name: colony.get(b.parentId)?.name ?? b.parentId } : null,
      parent2: b.parent2Id ? { id: b.parent2Id, name: colony.get(b.parent2Id)?.name ?? b.parent2Id } : null,
      mutations: b.mutations,
      vsOrakelia: describeMutations(diff(ORAKELIA, b.genome)),
      genome: b.genome,
      bornAt: b.bornAt,
      ageHours: Number(((now - b.bornAt) / 3_600_000).toFixed(1)),
      diedAt: b.diedAt,
      death: b.death,
      finalEquity: b.finalEquity,
      stars: b.stars,
      xs: b.xs,
      eggs: b.eggs,
      lastScore: b.lastScore,
      children: colony.all().filter((c) => c.parentId === b.id || c.parent2Id === b.id).length,
      rule: b.role ? ROYAL_RULES[b.role] : null,
      live: live && {
        startEquityUsd: live.startEquityUsd,
        equityUsd: live.equityUsd,
        pnlUsd: live.pnlUsd,
        pnlPct: live.pnlPct,
        position: live.position,
        flatMinutes: live.flatMinutes,
        cap: live.cap,
        tradesToday: live.tradesToday,
        maxTradesPerDay: live.maxTradesPerDay,
        totals: live.totals,
        last: live.last && { choice: live.last.choice, status: live.last.status, ts: live.last.ts },
      },
    };
  };
  const all = colony.all();
  const dead = all.filter((b) => b.diedAt !== null).sort((a, b) => b.diedAt! - a.diedAt!);
  return {
    ts: now,
    mode: snap.mode,
    startedAt: snap.startedAt,
    startEquityUsd: snap.startEquityUsd,
    rules: colony.opts,
    nextRatingAt: colony.nextRatingAt(),
    nextPromotionAt: colony.nextPromotionAt(),
    lastRoundRun: colony.lastRoundRun(),
    firstMarksAt: colony.firstMarksAt(now),
    activity: { ...colony.activity(), uptimeS: health?.uptimeS ?? null, marketAgeMs: health?.marketAgeMs ?? null },
    stats: {
      born: all.length,
      alive: colony.alive().length,
      died: dead.length,
      maxGeneration: Math.max(0, ...all.map((b) => b.generation)),
      eggs: colony.nursery().length,
    },
    royals: colony.royals().map(bee),
    workers: colony.workers().map(bee),
    nursery: colony.nursery().map((b) => ({ ...bee(b), hatchBy: b.bornAt + colony.opts.eggWaitHours * 3_600_000 })),
    keeper: (() => {
      const l = colony.lessons();
      return {
        samples: l.samples,
        insights: l.insights.slice(0, 10).map((i) => ({ gene: i.gene, label: i.label, effect: Number(i.effect.toFixed(3)), verdict: i.verdict, value: i.value })),
        blend: l.blend,
        diary: colony.diary(10),
      };
    })(),
    graveyard: dead.slice(0, 40).map(bee),
    lineage: all.map((b) => ({ id: b.id, name: b.name, parent: b.parentId, parent2: b.parent2Id, generation: b.generation, alive: b.diedAt === null, tier: b.tier, genome: b.genome })),
    lastRound: colony.lastRound(),
    log: colony.recentLog(80),
    genes: GENE_NAMES.map((n) => ({ name: n, ...GENES[n] })),
    jev: snap.jev,
    market: { refreshedAt: snap.market.refreshedAt, coins: snap.market.universe.length },
  };
}

const CONVICTION = ["tipsy", "buzzed", "wasted", "legendary"];
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

interface DecisionRow {
  id: number;
  ts: number;
  choice: string | null;
  probabilities_json: string | null;
  confidence: number | null;
  conviction: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  jev_cost_usd: number;
  jev_error: string | null;
  action_json: string;
  vetoed_by: string | null;
  forced_by: string | null;
  status: string | null;
  menu_json: string | null;
  state_json: string | null;
}

/**
 * GET /colony/bee?id=: one bee's decisions the way the classic dashboard shows them. Jev's last real call (every option
 * on the menu with its probability, confidence, conviction, the snapshot Jev saw), the recent decisions that mattered
 * (Jev was asked, or something happened), what it picked over the last 24 h, and its trades. undefined = no such bee.
 */
export function beeDetail(db: Db, colony: Colony, id: string) {
  if (!colony.get(id)) return undefined;
  const asked = db.raw
    .prepare(`SELECT * FROM decisions WHERE bee = ? AND probabilities_json IS NOT NULL AND latency_ms > 0 ORDER BY id DESC LIMIT 1`)
    .get(id) as DecisionRow | undefined;
  const recent = db.raw
    .prepare(
      `SELECT id, ts, choice, probabilities_json, confidence, conviction, latency_ms, input_tokens, jev_cost_usd, jev_error, action_json, vetoed_by, forced_by, status
       FROM decisions WHERE bee = ? AND (latency_ms > 0 OR action_json NOT LIKE '{"kind":"none"%' OR forced_by IS NOT NULL OR jev_error IS NOT NULL)
       ORDER BY id DESC LIMIT 60`,
    )
    .all(id) as unknown as DecisionRow[];
  const since = Date.now() - 86_400_000;
  const tally = db.raw
    .prepare(`SELECT COALESCE(choice, forced_by, 'no call') AS label, COUNT(*) AS n FROM decisions WHERE bee = ? AND ts >= ? GROUP BY label ORDER BY n DESC`)
    .all(id, since) as Array<{ label: string; n: number }>;
  const jev = db.raw
    .prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(jev_cost_usd), 0) AS cost, AVG(latency_ms) AS latency, SUM(vetoed_by IS NOT NULL) AS vetoes FROM decisions WHERE bee = ? AND latency_ms > 0`)
    .get(id) as { calls: number; cost: number; latency: number | null; vetoes: number };
  const trades = db.raw
    .prepare(
      `SELECT f.ts, f.inst_id AS instId, f.side, f.px, f.notional_usd AS notionalUsd, f.fee_usd AS feeUsd, f.realised_usd AS realisedUsd, o.purpose
       FROM fills f LEFT JOIN orders o ON o.id = f.order_id WHERE f.bee = ? ORDER BY f.id DESC LIMIT 30`,
    )
    .all(id) as Array<{ ts: number; instId: string; side: string; px: number; notionalUsd: number; feeUsd: number; realisedUsd: number; purpose: string | null }>;
  const probs = (r: DecisionRow) =>
    Object.entries(parse<Record<string, number>>(r.probabilities_json, {}))
      .sort((a, b) => b[1] - a[1])
      .map(([label, p]) => ({ label, p: Number(p.toFixed(3)) }));
  const conviction = (r: DecisionRow) => (r.conviction === null ? null : CONVICTION[Math.max(0, Math.min(3, Math.round(r.conviction)))]!);
  const action = (r: DecisionRow) => parse<{ kind: string; instId?: string; side?: string; notionalUsd?: number; reason?: string; fraction?: number }>(r.action_json, { kind: "none" });
  return {
    id,
    rulesOnly: colony.get(id)!.genome.useJev === false,
    lastCall: asked && {
      ts: asked.ts,
      choice: asked.choice,
      options: probs(asked),
      menu: parse<string[]>(asked.menu_json, []),
      confidence: asked.confidence,
      conviction: conviction(asked),
      latencyMs: asked.latency_ms,
      tokens: asked.input_tokens,
      costUsd: asked.jev_cost_usd,
      status: asked.status,
      vetoedBy: asked.vetoed_by,
      action: action(asked),
      saw: parse<Record<string, unknown>>(asked.state_json, {}),
    },
    recent: recent.map((r) => ({
      ts: r.ts,
      choice: r.choice,
      top: probs(r).slice(0, 3),
      confidence: r.confidence,
      conviction: conviction(r),
      action: action(r),
      vetoedBy: r.vetoed_by,
      forcedBy: r.forced_by,
      error: r.jev_error,
      status: r.status,
    })),
    tally,
    jev: { calls: jev.calls, costUsd: Number(jev.cost.toFixed(4)), avgLatencyMs: jev.latency === null ? null : Math.round(jev.latency), vetoes: jev.vetoes },
    trades: trades.map((t) => ({ ...t, coin: t.instId.split("-")[0] })),
  };
}
