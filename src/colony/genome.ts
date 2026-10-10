// A colony bee's DNA: every knob of the Momentum strategy that the colony is allowed to mutate, each with a range.
// Nothing in here can reach leverage past MAX_LEVERAGE, the daily loss stop, retirement or the mode: those stay in
// config.ts and the risk layer, the same for every bee.
import { z } from "zod";

export const LARGE_CAPS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "LINK", "AVAX", "LTC", "HYPE"] as const;
export const MID_SMALL_CAPS = ["ZEC", "NEAR", "ENA", "PUMP", "SUI", "WLD", "TAO", "ONDO", "PENGU", "PEPE", "AAVE", "GRASS", "INJ", "LIT", "VIRTUAL", "STRK", "ARB", "HBAR", "XLM"] as const;
export const UNIVERSES = ["any", "large", "midsmall"] as const;
export type Universe = (typeof UNIVERSES)[number];

type NumGene = { kind: "num"; min: number; max: number; log?: boolean; dp: number; label: string; help: string };
type IntGene = { kind: "int"; min: number; max: number; label: string; help: string };
type EnumGene = { kind: "enum"; values: readonly string[]; label: string; help: string };
type BoolGene = { kind: "bool"; label: string; help: string };
export type GeneSpec = NumGene | IntGene | EnumGene | BoolGene;

/** The genes, their ranges, and what they mean. The order here is the order the dashboard shows them in. */
export const GENES = {
  // --- what to buy
  universe: { kind: "enum", values: UNIVERSES, label: "coins", help: "which coins it may trade: any liquid coin, 11 large caps, or 19 mid/small caps" },
  w7d: { kind: "num", min: 0, max: 1, dp: 2, label: "7d weight", help: "weight of the 7-day return in the momentum score" },
  w24h: { kind: "num", min: 0, max: 1, dp: 2, label: "24h weight", help: "weight of the 24-hour return in the momentum score" },
  w1h: { kind: "num", min: 0, max: 0.5, dp: 2, label: "1h weight", help: "weight of the 1-hour return in the momentum score" },
  wAttn: { kind: "num", min: 0, max: 1, dp: 2, label: "attention weight", help: "bonus for unusual volume (or news)" },
  requireUp24h: { kind: "bool", label: "needs green 24h", help: "only buys coins that are up over the last 24 hours" },
  shortLosers: { kind: "bool", label: "shorts losers", help: "may also short the weakest coin when flat" },
  candidates: { kind: "int", min: 1, max: 8, label: "shortlist", help: "how many top-ranked coins Jev chooses between" },
  // --- how much
  entryFrac: { kind: "num", min: 0.2, max: 1, dp: 2, label: "entry size", help: "first entry, as a share of the bee's max position" },
  addFrac: { kind: "num", min: 0, max: 0.5, dp: 2, label: "add size", help: "each pyramid add, as a share of max (0 = never adds)" },
  addEveryAtr: { kind: "num", min: 0.5, max: 3, dp: 1, label: "add every", help: "adds after each run of this many ATR(1h) in profit" },
  // --- how long
  minHoldHours: { kind: "num", min: 1, max: 72, log: true, dp: 1, label: "min hold (h)", help: "hours a pick is held before it may bail or rotate" },
  switchStreak: { kind: "int", min: 1, max: 4, label: "switch streak", help: "hourly ranks a new #1 must hold before it may rotate into it" },
  flipShort: { kind: "bool", label: "may flip short", help: "may reverse a fading long into a short" },
  canWait: { kind: "bool", label: "may wait", help: "may stay flat instead of always holding something" },
  maxFlatMinutes: { kind: "int", min: 0, max: 240, label: "max flat (min)", help: "a waiting bee is pushed in after this long flat" },
  // --- how it gets out
  trailAtr: { kind: "num", min: 1, max: 6, dp: 1, label: "stop (ATR)", help: "stop distance in ATR(1h), trailed behind the price" },
  lock1At: { kind: "num", min: 1, max: 8, dp: 1, label: "lock 1 at %", help: "profit lock: from this gain..." },
  lock1Keep: { kind: "num", min: 0, max: 0.9, dp: 2, label: "lock 1 keeps", help: "...the stop keeps this share of the best move" },
  lock2At: { kind: "num", min: 3, max: 20, dp: 1, label: "lock 2 at %", help: "second profit-lock rung..." },
  lock2Keep: { kind: "num", min: 0, max: 0.95, dp: 2, label: "lock 2 keeps", help: "...and the share it keeps" },
  // --- pace and budget
  maxTradesPerDay: { kind: "int", min: 1, max: 8, label: "trades/day", help: "new positions per UTC day before it is benched" },
  cooldownMinutes: { kind: "int", min: 0, max: 240, label: "cooldown (min)", help: "minutes after any order before it may open again" },
  spreadGateBps: { kind: "int", min: 5, max: 25, label: "spread gate (bp)", help: "skips coins with a wider spread than this" },
  // --- the brain
  useJev: { kind: "bool", label: "asks Jev", help: "Jev picks among the moves; off = pure rules, always the top-ranked move, zero tokens" },
  decideEveryMin: { kind: "int", min: 1, max: 15, label: "decides every (min)", help: "how often it decides (stops are checked every tick regardless)" },
} as const satisfies Record<string, GeneSpec>;

export type GeneName = keyof typeof GENES;
export const GENE_NAMES = Object.keys(GENES) as GeneName[];

export interface Genome {
  universe: Universe;
  w7d: number;
  w24h: number;
  w1h: number;
  wAttn: number;
  requireUp24h: boolean;
  shortLosers: boolean;
  candidates: number;
  entryFrac: number;
  addFrac: number;
  addEveryAtr: number;
  minHoldHours: number;
  switchStreak: number;
  flipShort: boolean;
  canWait: boolean;
  maxFlatMinutes: number;
  trailAtr: number;
  lock1At: number;
  lock1Keep: number;
  lock2At: number;
  lock2Keep: number;
  maxTradesPerDay: number;
  cooldownMinutes: number;
  spreadGateBps: number;
  useJev: boolean;
  decideEveryMin: number;
}

/** The Orakelia rules the nine lab bees ran (BOOZY defaults in config.ts and bees/boozy.ts). */
export const ORAKELIA: Genome = {
  universe: "any",
  w7d: 1,
  w24h: 0.1,
  w1h: 0,
  wAttn: 0.3,
  requireUp24h: false,
  shortLosers: false,
  candidates: 5,
  entryFrac: 0.5,
  addFrac: 0.25,
  addEveryAtr: 1,
  minHoldHours: 24,
  switchStreak: 2,
  flipShort: true,
  canWait: false,
  maxFlatMinutes: 0,
  trailAtr: 3,
  lock1At: 2.5,
  lock1Keep: 0.5,
  lock2At: 5,
  lock2Keep: 0.65,
  maxTradesPerDay: 3,
  cooldownMinutes: 2,
  spreadGateBps: 15,
  useJev: true,
  decideEveryMin: 2,
};

const GenomeSchema = z.object(
  Object.fromEntries(
    GENE_NAMES.map((g) => {
      const s: GeneSpec = GENES[g];
      const t =
        s.kind === "num" ? z.number().min(s.min).max(s.max) : s.kind === "int" ? z.number().int().min(s.min).max(s.max) : s.kind === "enum" ? z.enum(s.values as [string, ...string[]]) : z.boolean();
      return [g, t];
    }),
  ),
);

/** Parse stored DNA. Genes added after the bee was born take the Orakelia value. */
export function parseGenome(v: unknown): Genome {
  return normalize(GenomeSchema.parse({ ...ORAKELIA, ...(v as object) }) as unknown as Genome);
}

/** A random number source, injectable for tests. Returns [0, 1). */
export type Rng = () => number;

const gauss = (rng: Rng) => {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round = (x: number, dp: number) => Number(x.toFixed(dp));

/** Keep the genome self-consistent: rung 2 above rung 1 and keeping at least as much, weights not all zero. */
export function normalize(g: Genome): Genome {
  const out = { ...g };
  if (out.lock2At <= out.lock1At) out.lock2At = round(clamp(out.lock1At + 1, GENES.lock2At.min, GENES.lock2At.max), 1);
  if (out.lock2Keep < out.lock1Keep) out.lock2Keep = out.lock1Keep;
  if (out.w7d + out.w24h + out.w1h === 0) out.w7d = 1;
  return out;
}

function randomGene(name: GeneName, rng: Rng): Genome[GeneName] {
  const s: GeneSpec = GENES[name];
  switch (s.kind) {
    case "num": {
      const x = s.log ? Math.exp(Math.log(s.min) + rng() * (Math.log(s.max) - Math.log(s.min))) : s.min + rng() * (s.max - s.min);
      return round(x, s.dp);
    }
    case "int":
      return s.min + Math.floor(rng() * (s.max - s.min + 1));
    case "enum":
      return s.values[Math.floor(rng() * s.values.length)] as Genome[GeneName];
    case "bool":
      return rng() < 0.5;
  }
}

/** A brand-new random bee (an immigrant: new blood that did not come from anyone in the colony). */
export function randomGenome(rng: Rng): Genome {
  const g = { ...ORAKELIA } as Record<GeneName, unknown>;
  for (const n of GENE_NAMES) g[n] = randomGene(n, rng);
  return normalize(g as unknown as Genome);
}

/**
 * The beekeeper's hint for a mutation: which genes he thinks matter (weight 0..1) and the value winners lean towards.
 * It tilts the dice, never sets them: a hinted gene is picked a bit more often, and its random step leans towards the
 * target, but it can still go the other way.
 */
export interface Guide {
  weight: Partial<Record<GeneName, number>>;
  target: Partial<Record<GeneName, Genome[GeneName]>>;
}

/** One gene nudged: numbers by a normal step of `scale` x their range (in log space for log genes), leaning by `lean`
 * (-1..1 of a step) towards a target when the keeper has one. */
function nudge(name: GeneName, v: Genome[GeneName], rng: Rng, scale: number, target?: Genome[GeneName], w = 0): Genome[GeneName] {
  const s: GeneSpec = GENES[name];
  switch (s.kind) {
    case "num": {
      const t = target as number | undefined;
      const lean = t === undefined || t === v ? 0 : Math.sign(t - (v as number)) * w * 0.8;
      if (s.log) {
        const lo = Math.log(s.min);
        const hi = Math.log(s.max);
        return round(Math.exp(clamp(Math.log(v as number) + (gauss(rng) + lean) * scale * (hi - lo), lo, hi)), s.dp);
      }
      return round(clamp((v as number) + (gauss(rng) + lean) * scale * (s.max - s.min), s.min, s.max), s.dp);
    }
    case "int": {
      const t = target as number | undefined;
      const lean = t === undefined || t === v ? 0 : Math.sign(t - (v as number)) * w * 0.8;
      const step = Math.round((gauss(rng) + lean) * scale * (s.max - s.min)) || (lean !== 0 ? Math.sign(lean) : rng() < 0.5 ? -1 : 1);
      return clamp((v as number) + step, s.min, s.max);
    }
    case "enum": {
      if (target !== undefined && target !== v && rng() < 0.4 + 0.4 * w) return target;
      const others = s.values.filter((x) => x !== v);
      return others[Math.floor(rng() * others.length)] as Genome[GeneName];
    }
    case "bool":
      // A hinted bool that already has the winners' value usually stays: the flip goes to another gene instead.
      return !v;
  }
}

export interface Mutation {
  gene: GeneName;
  from: Genome[GeneName];
  to: Genome[GeneName];
}

/**
 * A child of `parent`: each gene mutates with probability `rate` (at least one always does), numbers by a normal
 * step of `scale` x their range. With a guide, genes the keeper cares about are picked up to 2x as often and lean
 * towards his target. Returns the child and what changed.
 */
export function mutate(parent: Genome, rng: Rng, rate = 0.1, scale = 0.15, guide?: Guide): { genome: Genome; mutations: Mutation[] } {
  const child = { ...parent } as Record<GeneName, Genome[GeneName]>;
  const w = (g: GeneName) => Math.max(0, Math.min(1, guide?.weight[g] ?? 0));
  // A bool already at the keeper's value is not worth flipping: its chance drops instead of rising.
  const settled = (g: GeneName) => GENES[g].kind === "bool" && guide?.target[g] !== undefined && guide.target[g] === parent[g];
  const chance = (g: GeneName) => (settled(g) ? rate * (1 - 0.7 * w(g)) : rate * (1 + w(g)));
  const picked = GENE_NAMES.filter((g) => rng() < chance(g));
  if (!picked.length) picked.push(GENE_NAMES[Math.floor(rng() * GENE_NAMES.length)]!);
  for (const g of picked) child[g] = nudge(g, child[g], rng, scale, guide?.target[g], w(g));
  const genome = normalize(child as unknown as Genome);
  return { genome, mutations: diff(parent, genome) };
}

/** Uniform crossover: each gene from one parent or the other. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const g = {} as Record<GeneName, Genome[GeneName]>;
  for (const n of GENE_NAMES) g[n] = rng() < 0.5 ? a[n] : b[n];
  return normalize(g as unknown as Genome);
}

export function diff(a: Genome, b: Genome): Mutation[] {
  return GENE_NAMES.filter((n) => a[n] !== b[n]).map((n) => ({ gene: n, from: a[n], to: b[n] }));
}

export function fmtGene(name: GeneName, v: Genome[GeneName]): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/** "trail 3 -> 2.4, asks Jev yes -> no" */
export function describeMutations(ms: Mutation[]): string {
  return ms.map((m) => `${GENES[m.gene].label} ${fmtGene(m.gene, m.from)} -> ${fmtGene(m.gene, m.to)}`).join(", ");
}

/** The coins a universe allows (null = any). */
export function universeCoins(u: Universe): readonly string[] | null {
  return u === "large" ? LARGE_CAPS : u === "midsmall" ? MID_SMALL_CAPS : null;
}
