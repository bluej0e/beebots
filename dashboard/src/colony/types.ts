// The shape of GET /colony/state (src/colony/view.ts in the engine).

export type Tier = "royal" | "worker" | "egg";
export type Role = "king" | "queen" | "prince";

export interface Position {
  coin: string;
  side: "long" | "short";
  sizeUsd: number | null;
  entryPx: number;
  markPx: number | null;
  stopPx: number | null;
  uplUsd: number;
  minutesHeld: number;
}

export interface Live {
  startEquityUsd: number;
  equityUsd: number;
  pnlUsd: number;
  pnlPct: number;
  position: Position | null;
  flatMinutes: number | null;
  cap: string | null;
  tradesToday: number;
  maxTradesPerDay: number;
  totals: { feesUsd: number; fundingUsd: number; jevUsd: number; realisedUsd: number; decisions: number; orders: number };
  last: { choice: string | null; status: string; ts: number } | null;
}

export type Genome = Record<string, number | boolean | string>;

export interface Bee {
  id: string;
  tier: Tier;
  role: Role | null;
  name: string;
  generation: number;
  origin: "founder" | "egg" | "cross" | "immigrant" | "keeper";
  parent: { id: string; name: string } | null;
  parent2: { id: string; name: string } | null;
  mutations: string | null;
  vsOrakelia: string;
  genome: Genome;
  bornAt: number;
  ageHours: number;
  diedAt: number | null;
  death: string | null;
  finalEquity: number | null;
  stars: number;
  xs: number;
  eggs: number;
  lastScore: number | null;
  children: number;
  rule: { title: string; blurb: string; horizonHours: number; marginPct: number } | null;
  live: Live | null;
}

export interface GeneSpec {
  name: string;
  kind: "num" | "int" | "enum" | "bool";
  label: string;
  help: string;
  min?: number;
  max?: number;
  values?: string[];
}

export interface RoundScore {
  bee: string;
  score: number;
  retPct: number;
  ddPct: number;
  rank: number;
  mark: "star" | "x" | null;
}

export interface ColonyView {
  ts: number;
  mode: string;
  startedAt: number;
  startEquityUsd: number;
  rules: { workers: number; rateEveryHours: number; rateWindowHours: number; minAgeHours: number; starsToBreed: number; xsToDie: number; promoteEveryHours: number; eggWaitHours: number; maxNursery: number };
  nextRatingAt: number;
  nextPromotionAt: number;
  stats: { born: number; alive: number; died: number; maxGeneration: number; eggs: number };
  royals: Bee[];
  workers: Bee[];
  nursery: Array<Bee & { hatchBy: number }>;
  keeper: {
    samples: number;
    insights: Array<{ gene: string; label: string; effect: number; verdict: string; value: number | boolean | string }>;
    blend: Genome;
    diary: Array<{ ts: number; text: string; quip: string | null }>;
  };
  graveyard: Bee[];
  lineage: Array<{ id: string; name: string; parent: string | null; parent2: string | null; generation: number; alive: boolean; tier: Tier; genome: Genome }>;
  lastRound: { round: number; ts: number; scores: RoundScore[] } | null;
  log: Array<{ ts: number; kind: string; bee: string | null; text: string }>;
  genes: GeneSpec[];
  jev: { spentTodayUsd: number; dailyCapUsd: number; capTripped: boolean; down: boolean };
  market: { refreshedAt: number; coins: number };
}

/** The Orakelia rules every founder started from (src/colony/genome.ts). */
export const ORAKELIA: Genome = {
  universe: "any", w7d: 1, w24h: 0.1, w1h: 0, wAttn: 0.3, requireUp24h: false, shortLosers: false, candidates: 5,
  entryFrac: 0.5, addFrac: 0.25, addEveryAtr: 1, minHoldHours: 24, switchStreak: 2, flipShort: true, canWait: false,
  maxFlatMinutes: 0, trailAtr: 3, lock1At: 2.5, lock1Keep: 0.5, lock2At: 5, lock2Keep: 0.65, maxTradesPerDay: 3,
  cooldownMinutes: 2, spreadGateBps: 15, useJev: true, decideEveryMin: 2,
};
