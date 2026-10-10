// GET /colony/state: everything the colony dashboard shows, in one read. No secrets in here: DNA, scores and books only.
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
