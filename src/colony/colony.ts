// The colony: royals that trade on the colony's best DNA, and a grid of worker bees that evolve.
//
// Every rating round (default every 4 h) each worker old enough to have a full window is scored on its return over
// that window minus half its worst drawdown in it. The best gets a star, the worst an X. Every worker is mortal.
// Five X's: it dies. Five stars: it lays an egg (a mutated copy), its stars reset and it earns a +1. The egg waits in
// the nursery until a cell frees up; if it waits too long (or the nursery is full) the worst grown worker is
// terminated to make room. Cells that are still empty are filled by a cross of the two best bees, a child of the
// best, a bee bred by the beekeeper, or now and then a random immigrant.
//
// The beekeeper (keeper.ts) learns from every rated bee, alive or dead, which gene values are winning. He tilts
// mutations towards them (never dictates), breeds some of the refills himself, and once a day visits the royals:
//   King   - the anchor: only a worker that beat him over a week AND on most single days of it
//   Queen  - the champion: the best worker over 3 days, if it beat her by 2 points
//   Prince - the beekeeper's apprentice: trades the keeper's own blend of what is working
// The royals keep their books through a change of DNA: the account is the royal's, only the brain changes.
import type { BeeBrain, BeeState } from "../bees/types.js";
import type { BeeKnobs } from "../config.js";
import type { Db } from "../db.js";
import type { EventBus } from "../events.js";
import type { Roster } from "../engine.js";
import { log } from "../log.js";
import { colonyBrain, knobsFor } from "./brain.js";
import { crossover, describeMutations, diff, GENES, mutate, ORAKELIA, parseGenome, randomGenome, type GeneName, type Genome, type Guide, type Rng } from "./genome.js";
import { learn, MIN_EFFECT, type Lessons, type Sample } from "./keeper.js";
import { beeName } from "./names.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS colony_bees (
  id TEXT PRIMARY KEY, tier TEXT NOT NULL, role TEXT, name TEXT NOT NULL, genome_json TEXT NOT NULL,
  parent_id TEXT, parent2_id TEXT, generation INTEGER NOT NULL, origin TEXT NOT NULL, mutations TEXT,
  born_at INTEGER NOT NULL, died_at INTEGER, death TEXT, final_equity REAL,
  stars INTEGER NOT NULL DEFAULT 0, xs INTEGER NOT NULL DEFAULT 0, eggs INTEGER NOT NULL DEFAULT 0, last_score REAL
);
CREATE TABLE IF NOT EXISTS colony_ratings (
  id INTEGER PRIMARY KEY, round INTEGER NOT NULL, ts INTEGER NOT NULL, bee TEXT NOT NULL,
  score REAL NOT NULL, ret_pct REAL NOT NULL, dd_pct REAL NOT NULL, rank INTEGER NOT NULL, mark TEXT
);
CREATE INDEX IF NOT EXISTS colony_ratings_round ON colony_ratings(round);
CREATE TABLE IF NOT EXISTS colony_log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, bee TEXT, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS colony_diary (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, text TEXT NOT NULL, quip TEXT);
`;

/** "egg": laid, waiting in the nursery for a cell. Not trading yet. */
export type Tier = "royal" | "worker" | "egg";
export type Role = "king" | "queen" | "prince";
export const ROLES: readonly Role[] = ["king", "queen", "prince"];
export type Origin = "founder" | "egg" | "cross" | "immigrant" | "keeper";

export interface ColonyBee {
  id: string;
  tier: Tier;
  role: Role | null;
  name: string;
  genome: Genome;
  parentId: string | null;
  parent2Id: string | null;
  generation: number;
  origin: Origin;
  mutations: string | null;
  /** When it started trading (for an egg: when it was laid). */
  bornAt: number;
  diedAt: number | null;
  death: string | null;
  finalEquity: number | null;
  stars: number;
  xs: number;
  eggs: number;
  lastScore: number | null;
}

export interface ColonyOpts {
  /** Worker cells. */
  workers: number;
  rateEveryHours: number;
  rateWindowHours: number;
  /** A worker is rated (and can die) only once it is this old. */
  minAgeHours: number;
  starsToBreed: number;
  xsToDie: number;
  /** An egg that has waited this long gets a cell: the worst grown worker is terminated for it. */
  eggWaitHours: number;
  /** More eggs than this waiting: the oldest hatches the same way. */
  maxNursery: number;
  promoteEveryHours: number;
  /** Decision rhythm of the royals (ms). 0 = every engine tick. */
  royalDecideMs: number;
  /** Paper money a royal starts with. */
  royalEquityUsd: number;
  /** Paper money a new worker starts with. */
  workerEquityUsd: number;
  /** Share of refills that are random immigrants. */
  immigrantRate: number;
  /** How far back the beekeeper learns from (hours of rating rounds). */
  learnWindowHours: number;
}

export const DEFAULT_OPTS: ColonyOpts = {
  workers: 12,
  rateEveryHours: 4,
  rateWindowHours: 24,
  minAgeHours: 24,
  starsToBreed: 5,
  xsToDie: 5,
  eggWaitHours: 24,
  maxNursery: 3,
  promoteEveryHours: 24,
  royalDecideMs: 0,
  royalEquityUsd: 333,
  workerEquityUsd: 100,
  immigrantRate: 0.2,
  learnWindowHours: 7 * 24,
};

export interface RoyalRule {
  title: string;
  blurb: string;
  horizonHours: number;
  marginPct: number;
}

export const ROYAL_RULES: Record<Role, RoyalRule> = {
  king: { title: "King", blurb: "the anchor: takes a worker's DNA only if it beat him by 5 points over a week and won at least 5 of its 7 days", horizonHours: 168, marginPct: 5 },
  queen: { title: "Queen", blurb: "the champion: takes the DNA of the best worker over 3 days, if it beat her by 2 points", horizonHours: 72, marginPct: 2 },
  prince: { title: "Prince", blurb: "the beekeeper's apprentice: trades the keeper's own blend of what is working, retaught every day", horizonHours: 24, marginPct: 0 },
};

/** Days of the King's week a worker must win against him. */
export const KING_DAYS_TO_WIN = 5;

export interface Score {
  bee: string;
  score: number;
  retPct: number;
  ddPct: number;
}

/** What an outside voice (Claude, when the CLI is on this machine) is given, and may answer. */
export interface AdvisorInput {
  lessons: Lessons;
  prince: Genome;
  standings: Array<{ name: string; score: number | null; stars: number; xs: number; genome: Genome }>;
}
export interface AdvisorAnswer {
  diary: string;
  quip: string;
  /** Up to 3 genes the keeper wants to try on the Prince beyond the blend. */
  tweaks: Array<{ gene: string; value: number | string | boolean }>;
}
export type Advisor = (input: AdvisorInput) => Promise<AdvisorAnswer>;

interface Row {
  id: string;
  tier: string;
  role: string | null;
  name: string;
  genome_json: string;
  parent_id: string | null;
  parent2_id: string | null;
  generation: number;
  origin: string;
  mutations: string | null;
  born_at: number;
  died_at: number | null;
  death: string | null;
  final_equity: number | null;
  stars: number;
  xs: number;
  eggs: number;
  last_score: number | null;
}

const fromRow = (r: Row): ColonyBee => ({
  id: r.id,
  // "control" was an immortal yardstick bee in the first version: it is a plain worker now.
  tier: (r.tier === "control" ? "worker" : r.tier) as Tier,
  role: r.role as Role | null,
  name: r.name,
  genome: parseGenome(JSON.parse(r.genome_json)),
  parentId: r.parent_id,
  parent2Id: r.parent2_id,
  generation: r.generation,
  origin: r.origin as Origin,
  mutations: r.mutations,
  bornAt: r.born_at,
  diedAt: r.died_at,
  death: r.death,
  finalEquity: r.final_equity,
  stars: r.stars,
  xs: r.xs,
  eggs: r.eggs,
  lastScore: r.last_score,
});

const HOUR = 3_600_000;

export class Colony implements Roster {
  private bees = new Map<string, ColonyBee>();
  private brains = new Map<string, { genome: Genome; brain: BeeBrain }>();
  private seq: number;
  private lessonsCache: { at: number; lessons: Lessons } | null = null;
  private advisor: Advisor | null = null;

  constructor(
    private db: Db,
    private bus: EventBus | null,
    readonly opts: ColonyOpts = DEFAULT_OPTS,
    private rng: Rng = Math.random,
    private now: () => number = Date.now,
  ) {
    db.raw.exec(SCHEMA);
    const rows = db.raw.prepare(`SELECT * FROM colony_bees`).all() as unknown as Row[];
    for (const r of rows) {
      const b = fromRow(r);
      this.bees.set(r.id, b);
      if (r.tier === "control") this.save(b);
    }
    this.seq = Number(db.getMeta("colony_seq") ?? 0);
    if (!rows.length) this.found();
  }

  /** An outside voice for the beekeeper's daily visit (diary, quip, up to 3 tweaks on the Prince). Optional. */
  setAdvisor(a: Advisor | null): void {
    this.advisor = a;
  }

  // ---------- Roster (what the engine reads) ----------

  ids(): string[] {
    return this.alive()
      .filter((b) => b.tier !== "egg")
      .map((b) => b.id);
  }

  name(id: string): string {
    return this.bees.get(id)?.name ?? id;
  }

  brain(id: string): BeeBrain {
    const b = this.bees.get(id);
    const g = b?.genome ?? ORAKELIA;
    const hit = this.brains.get(id);
    if (hit && hit.genome === g) return hit.brain;
    const brain = colonyBrain(b?.name ?? id, g);
    this.brains.set(id, { genome: g, brain });
    return brain;
  }

  knobs(id: string): BeeKnobs {
    return knobsFor(this.bees.get(id)?.genome ?? ORAKELIA);
  }

  decideEveryMs(id: string): number {
    const b = this.bees.get(id);
    if (!b || b.tier === "royal") return this.opts.royalDecideMs;
    return b.genome.decideEveryMin * 60_000;
  }

  startEquityUsd(id: string): number {
    return this.bees.get(id)?.tier === "royal" ? this.opts.royalEquityUsd : this.opts.workerEquityUsd;
  }

  onExit(id: string, state: BeeState): void {
    const b = this.bees.get(id);
    if (!b) return;
    b.finalEquity = Number(state.equityUsd.toFixed(2));
    this.save(b);
  }

  // ---------- reads ----------

  alive(): ColonyBee[] {
    return [...this.bees.values()].filter((b) => b.diedAt === null);
  }

  get(id: string): ColonyBee | undefined {
    return this.bees.get(id);
  }

  all(): ColonyBee[] {
    return [...this.bees.values()];
  }

  royals(): ColonyBee[] {
    return ROLES.map((r) => this.alive().find((b) => b.role === r)).filter((b): b is ColonyBee => !!b);
  }

  workers(): ColonyBee[] {
    return this.alive().filter((b) => b.tier === "worker");
  }

  /** Eggs waiting for a cell, oldest first. */
  nursery(): ColonyBee[] {
    return this.alive()
      .filter((b) => b.tier === "egg")
      .sort((a, b) => a.bornAt - b.bornAt);
  }

  recentLog(n: number): Array<{ ts: number; kind: string; bee: string | null; text: string }> {
    return (this.db.raw.prepare(`SELECT ts, kind, bee, text FROM colony_log ORDER BY id DESC LIMIT ?`).all(n) as Array<{ ts: number; kind: string; bee: string | null; text: string }>).reverse();
  }

  diary(n: number): Array<{ ts: number; text: string; quip: string | null }> {
    return this.db.raw.prepare(`SELECT ts, text, quip FROM colony_diary ORDER BY id DESC LIMIT ?`).all(n) as Array<{ ts: number; text: string; quip: string | null }>;
  }

  lastRound(): { round: number; ts: number; scores: Array<Score & { rank: number; mark: string | null }> } | null {
    const r = this.db.raw.prepare(`SELECT MAX(round) AS round FROM colony_ratings`).get() as { round: number | null };
    if (r.round === null) return null;
    const rows = this.db.raw.prepare(`SELECT ts, bee, score, ret_pct, dd_pct, rank, mark FROM colony_ratings WHERE round = ? ORDER BY rank`).all(r.round) as Array<{
      ts: number;
      bee: string;
      score: number;
      ret_pct: number;
      dd_pct: number;
      rank: number;
      mark: string | null;
    }>;
    return { round: r.round, ts: rows[0]?.ts ?? 0, scores: rows.map((x) => ({ bee: x.bee, score: x.score, retPct: x.ret_pct, ddPct: x.dd_pct, rank: x.rank, mark: x.mark })) };
  }

  nextRatingAt(): number {
    return Number(this.db.getMeta("colony_next_rating") ?? 0);
  }

  nextPromotionAt(): number {
    return Number(this.db.getMeta("colony_next_promotion") ?? 0);
  }

  // ---------- the clock ----------

  /** Called every engine tick or so. Runs a rating round and the beekeeper's visit when they are due. */
  tick(): void {
    const now = this.now();
    try {
      // The first call only sets the clocks: nothing has a track record yet.
      const rating = this.nextRatingAt();
      if (now >= rating) {
        this.db.setMeta("colony_next_rating", String(now + this.opts.rateEveryHours * HOUR));
        if (rating > 0) this.rate(now);
      }
      const promotion = this.nextPromotionAt();
      if (now >= promotion) {
        this.db.setMeta("colony_next_promotion", String(now + this.opts.promoteEveryHours * HOUR));
        if (promotion > 0) this.promote(now);
      }
    } catch (err) {
      log.error("colony tick failed", { err: String(err) });
    }
  }

  // ---------- scoring ----------

  /** Return over the window minus half the worst drawdown in it, from the engine's 10 s equity snapshots. */
  scoreOver(bee: string, fromTs: number, toTs: number): Score | null {
    const rows = this.db.raw.prepare(`SELECT equity_usd AS e FROM equity_snapshots WHERE bee = ? AND ts >= ? AND ts <= ? ORDER BY ts`).all(bee, fromTs, toTs) as Array<{ e: number }>;
    if (rows.length < 2) return null;
    const start = rows[0]!.e;
    const end = rows[rows.length - 1]!.e;
    let peak = start;
    let dd = 0;
    for (const { e } of rows) {
      peak = Math.max(peak, e);
      dd = Math.max(dd, (peak - e) / peak);
    }
    const retPct = ((end - start) / start) * 100;
    const ddPct = dd * 100;
    return { bee, retPct: Number(retPct.toFixed(3)), ddPct: Number(ddPct.toFixed(3)), score: Number((retPct - 0.5 * ddPct).toFixed(3)) };
  }

  // ---------- the beekeeper's notebook ----------

  /** What the keeper has learned from every rating in his window (cached per round). */
  lessons(now = this.now()): Lessons {
    const round = Number(this.db.getMeta("colony_round") ?? 0);
    if (this.lessonsCache && this.lessonsCache.at === round) return this.lessonsCache.lessons;
    const rows = this.db.raw.prepare(`SELECT bee, score FROM colony_ratings WHERE ts >= ?`).all(now - this.opts.learnWindowHours * HOUR) as Array<{ bee: string; score: number }>;
    const samples: Sample[] = rows.map((r) => ({ genome: this.bees.get(r.bee)?.genome, score: r.score })).filter((s): s is Sample => !!s.genome);
    const lessons = learn(samples, this.get("prince")?.genome ?? ORAKELIA);
    this.lessonsCache = { at: round, lessons };
    return lessons;
  }

  /** The keeper's hint for a mutation: genes with a clear lesson, weighted by how clear it is. */
  guide(): Guide | undefined {
    const l = this.lessons();
    const strong = l.insights.filter((i) => Math.abs(i.effect) >= MIN_EFFECT);
    if (!strong.length) return undefined;
    const weight: Guide["weight"] = {};
    const target: Guide["target"] = {};
    for (const i of strong) {
      weight[i.gene] = Math.min(1, Math.abs(i.effect) * 2);
      (target as Record<GeneName, Genome[GeneName]>)[i.gene] = i.value;
    }
    return { weight, target };
  }

  // ---------- a rating round ----------

  rate(now: number): void {
    const round = Number(this.db.getMeta("colony_round") ?? 0) + 1;
    this.db.setMeta("colony_round", String(round));
    const from = now - this.opts.rateWindowHours * HOUR;
    const eligible = this.workers().filter((b) => now - b.bornAt >= this.opts.minAgeHours * HOUR);
    const scores = eligible.map((b) => this.scoreOver(b.id, from, now)).filter((s): s is Score => s !== null);
    scores.sort((a, b) => b.score - a.score);
    const marks = new Map<string, "star" | "x">();
    if (scores.length >= 3) {
      marks.set(scores[0]!.bee, "star");
      marks.set(scores[scores.length - 1]!.bee, "x");
    }
    const ins = this.db.raw.prepare(`INSERT INTO colony_ratings (round, ts, bee, score, ret_pct, dd_pct, rank, mark) VALUES (?,?,?,?,?,?,?,?)`);
    scores.forEach((s, i) => {
      ins.run(round, now, s.bee, s.score, s.retPct, s.ddPct, i + 1, marks.get(s.bee) ?? null);
      const b = this.bees.get(s.bee)!;
      b.lastScore = s.score;
      if (marks.get(s.bee) === "star") b.stars++;
      if (marks.get(s.bee) === "x") b.xs++;
      this.save(b);
    });
    for (const [id, m] of marks) {
      const b = this.bees.get(id)!;
      const s = scores.find((x) => x.bee === id)!;
      this.note(now, m, id, `${b.name} ${m === "star" ? `earned a star (${b.stars}/${this.opts.starsToBreed})` : `got an X (${b.xs}/${this.opts.xsToDie})`}, score ${s.score >= 0 ? "+" : ""}${s.score.toFixed(2)}`);
    }

    // Deaths first (they free cells), then eggs, then the nursery hatches, then empty cells refill.
    for (const b of this.workers()) if (b.xs >= this.opts.xsToDie) this.kill(b, now, `${this.opts.xsToDie} X's`);
    for (const b of this.workers()) if (b.stars >= this.opts.starsToBreed) this.layEgg(b, now);
    this.hatch(now);
    this.refill(now);
    this.bus?.emit("colony", { event: "round", round }, now);
  }

  private kill(b: ColonyBee, now: number, why: string): void {
    b.diedAt = now;
    b.death = why;
    this.save(b);
    this.note(now, "death", b.id, `${b.name} died: ${why}`);
  }

  /** Five stars: a mutated copy goes to the nursery (the keeper tilts the mutation), the parent's stars reset. */
  private layEgg(parent: ColonyBee, now: number): void {
    parent.stars = 0;
    parent.eggs++;
    this.save(parent);
    const guide = this.guide();
    const { genome, mutations } = mutate(parent.genome, this.rng, undefined, undefined, guide);
    const egg = this.spawn({ tier: "egg", genome, parentId: parent.id, generation: parent.generation + 1, origin: "egg", mutations: describeMutations(mutations) }, now);
    this.note(now, "egg", egg.id, `${parent.name} laid an egg (+${parent.eggs}): ${egg.name}, gen ${egg.generation}, ${egg.mutations || "no change"}${guide ? " (the beekeeper tilted it)" : ""}`);
  }

  /** Eggs take free cells, oldest first. An egg that waited too long, or a full nursery, terminates the worst worker. */
  private hatch(now: number): void {
    const free = () => this.opts.workers - this.workers().length;
    for (;;) {
      const egg = this.nursery()[0];
      if (!egg) return;
      if (free() <= 0) {
        const overdue = now - egg.bornAt >= this.opts.eggWaitHours * HOUR || this.nursery().length > this.opts.maxNursery;
        if (!overdue) return;
        const victim = this.workers()
          .filter((b) => b.id !== egg.parentId && now - b.bornAt >= this.opts.minAgeHours * HOUR)
          .sort((a, b) => b.xs - a.xs || (a.lastScore ?? 0) - (b.lastScore ?? 0))[0];
        if (!victim) return; // everyone is too young to judge: the egg keeps waiting
        this.kill(victim, now, `terminated to make room for ${egg.name}`);
      }
      egg.tier = "worker";
      egg.bornAt = now;
      this.save(egg);
      this.note(now, "birth", egg.id, `${egg.name} hatched (gen ${egg.generation}, child of ${this.name(egg.parentId ?? "")})`);
    }
  }

  /** Cells still empty: a cross of the two best, a child of the best, a bee bred by the beekeeper, or an immigrant. */
  private refill(now: number): void {
    const ranked = this.workers()
      .filter((b) => b.lastScore !== null)
      .sort((a, b) => b.lastScore! - a.lastScore!);
    const guide = this.guide();
    const blend = this.lessons().blend;
    while (this.workers().length < this.opts.workers) {
      const [a, b] = ranked;
      const roll = this.rng();
      const rest = 1 - this.opts.immigrantRate;
      if (!a || roll < this.opts.immigrantRate) {
        const child = this.spawn({ tier: "worker", genome: randomGenome(this.rng), parentId: null, generation: 0, origin: "immigrant", mutations: null }, now);
        this.note(now, "birth", child.id, `${child.name} flew in from outside (random DNA)`);
      } else if (guide && roll < this.opts.immigrantRate + rest / 3) {
        const { genome, mutations } = mutate(blend, this.rng, undefined, undefined, guide);
        const child = this.spawn({ tier: "worker", genome, parentId: null, generation: 0, origin: "keeper", mutations: describeMutations(mutations) }, now);
        this.note(now, "birth", child.id, `the beekeeper bred ${child.name} from his notes on what is working`);
      } else if (b && roll < this.opts.immigrantRate + (2 * rest) / 3) {
        const { genome, mutations } = mutate(crossover(a.genome, b.genome, this.rng), this.rng, 0.05, undefined, guide);
        const child = this.spawn({ tier: "worker", genome, parentId: a.id, parent2Id: b.id, generation: Math.max(a.generation, b.generation) + 1, origin: "cross", mutations: describeMutations(mutations) }, now);
        this.note(now, "birth", child.id, `${child.name} hatched from ${a.name} x ${b.name} (gen ${child.generation})`);
      } else {
        const { genome, mutations } = mutate(a.genome, this.rng, undefined, undefined, guide);
        const child = this.spawn({ tier: "worker", genome, parentId: a.id, generation: a.generation + 1, origin: "egg", mutations: describeMutations(mutations) }, now);
        this.note(now, "birth", child.id, `${child.name} hatched from ${a.name}'s line (gen ${child.generation}), ${child.mutations}`);
      }
    }
  }

  // ---------- the beekeeper's visit ----------

  promote(now: number): void {
    const queen = this.get("queen");
    if (queen && queen.diedAt === null) this.promoteQueen(queen, now);
    const king = this.get("king");
    if (king && king.diedAt === null) this.promoteKing(king, now);
    const prince = this.get("prince");
    if (prince && prince.diedAt === null) this.teachPrince(prince, now);
    this.bus?.emit("colony", { event: "beekeeper" }, now);
  }

  private give(royal: ColonyBee, donor: ColonyBee | null, genome: Genome, now: number, why: string): void {
    const changes = describeMutations(diff(royal.genome, genome));
    royal.genome = genome;
    royal.parentId = donor?.id ?? null;
    royal.generation = donor?.generation ?? royal.generation;
    royal.mutations = changes;
    this.save(royal);
    this.note(now, "promotion", royal.id, `${why}: ${changes}`);
  }

  private promoteQueen(queen: ColonyBee, now: number): void {
    const rule = ROYAL_RULES.queen;
    const from = now - rule.horizonHours * HOUR;
    const mine = this.scoreOver(queen.id, from, now);
    if (!mine) return;
    const best = this.workers()
      .filter((w) => now - w.bornAt >= rule.horizonHours * HOUR && diff(w.genome, queen.genome).length > 0)
      .map((w) => ({ w, s: this.scoreOver(w.id, from, now) }))
      .filter((x): x is { w: ColonyBee; s: Score } => x.s !== null)
      .sort((a, b) => b.s.score - a.s.score)[0];
    if (!best || best.s.score < mine.score + rule.marginPct) return;
    this.give(queen, best.w, best.w.genome, now, `the beekeeper gave the Queen ${best.w.name}'s DNA (${best.s.score.toFixed(2)} vs her ${mine.score.toFixed(2)} over 3 days)`);
  }

  /** The King wants consistency: the week as a whole by 5 points, and at least 5 of its 7 single days. */
  private promoteKing(king: ColonyBee, now: number): void {
    const rule = ROYAL_RULES.king;
    const from = now - rule.horizonHours * HOUR;
    const mine = this.scoreOver(king.id, from, now);
    if (!mine) return;
    const days = Array.from({ length: 7 }, (_, i) => [from + i * 24 * HOUR, from + (i + 1) * 24 * HOUR] as const);
    const kingDays = days.map(([a, b]) => this.scoreOver(king.id, a, b)?.score ?? null);
    const best = this.workers()
      .filter((w) => now - w.bornAt >= rule.horizonHours * HOUR && diff(w.genome, king.genome).length > 0)
      .map((w) => {
        const s = this.scoreOver(w.id, from, now);
        const won = days.filter(([a, b], i) => {
          const d = this.scoreOver(w.id, a, b)?.score;
          return d !== undefined && kingDays[i] !== null && d > kingDays[i]!;
        }).length;
        return { w, s, won };
      })
      .filter((x): x is { w: ColonyBee; s: Score; won: number } => x.s !== null && x.s.score >= mine.score + rule.marginPct && x.won >= KING_DAYS_TO_WIN)
      .sort((a, b) => b.won - a.won || b.s.score - a.s.score)[0];
    if (!best) return;
    this.give(king, best.w, best.w.genome, now, `the King took ${best.w.name}'s DNA: ${best.s.score.toFixed(2)} vs ${mine.score.toFixed(2)} over the week, won ${best.won} of 7 days`);
  }

  /** The apprentice: the keeper's blend, retaught daily; an advisor (Claude) may try up to 3 more genes on top. */
  private teachPrince(prince: ColonyBee, now: number): void {
    const l = this.lessons(now);
    const top = l.insights.filter((i) => Math.abs(i.effect) >= MIN_EFFECT).slice(0, 3);
    const diary = l.samples < 12 ? `Too early to say what works: ${l.samples} ratings so far. The Prince keeps his DNA.` : top.length ? `What is working: ${top.map((i) => i.verdict).join("; ")}.` : `No gene stands out yet over ${l.samples} ratings. The Prince keeps his DNA.`;
    if (top.length && diff(prince.genome, l.blend).length) this.give(prince, null, l.blend, now, "the beekeeper retaught the Prince");
    this.writeDiary(now, diary, null);
    const advisor = this.advisor;
    if (!advisor || l.samples < 12) return;
    const standings = this.workers().map((w) => ({ name: w.name, score: w.lastScore, stars: w.stars, xs: w.xs, genome: w.genome }));
    void advisor({ lessons: l, prince: prince.genome, standings })
      .then((a) => {
        const next = { ...prince.genome } as Record<string, unknown>;
        for (const t of a.tweaks.slice(0, 3)) if (t.gene in GENES) next[t.gene] = t.value;
        let genome: Genome | null = null;
        try {
          genome = parseGenome(next);
        } catch {
          log.warn("beekeeper advisor tweak out of range, ignored");
        }
        if (genome && diff(prince.genome, genome).length) this.give(prince, null, genome, this.now(), "the beekeeper tried an idea on the Prince");
        this.writeDiary(this.now(), a.diary.slice(0, 600), a.quip.slice(0, 120));
      })
      .catch((err) => log.warn("beekeeper advisor failed", { err: String(err) }));
  }

  private writeDiary(ts: number, text: string, quip: string | null): void {
    this.db.raw.prepare(`INSERT INTO colony_diary (ts, text, quip) VALUES (?,?,?)`).run(ts, text, quip);
    this.bus?.emit("colony", { event: "diary", text, quip }, ts);
  }

  // ---------- births and the founders ----------

  private spawn(
    p: { tier: Tier; role?: Role; genome: Genome; parentId: string | null; parent2Id?: string | null; generation: number; origin: Origin; mutations: string | null; name?: string; id?: string },
    now: number,
  ): ColonyBee {
    this.seq++;
    this.db.setMeta("colony_seq", String(this.seq));
    const id = p.id ?? `w${String(this.seq).padStart(4, "0")}`;
    const b: ColonyBee = {
      id,
      tier: p.tier,
      role: p.role ?? null,
      name: p.name ?? beeName(this.seq, this.rng, new Set(this.alive().map((x) => x.name))),
      genome: p.genome,
      parentId: p.parentId,
      parent2Id: p.parent2Id ?? null,
      generation: p.generation,
      origin: p.origin,
      mutations: p.mutations,
      bornAt: now,
      diedAt: null,
      death: null,
      finalEquity: null,
      stars: 0,
      xs: 0,
      eggs: 0,
      lastScore: null,
    };
    this.bees.set(id, b);
    this.save(b);
    return b;
  }

  /**
   * Generation 0: the King runs the labs' Orakelia rules, the Queen the two lab leaders combined (6 h hold, 2x stop),
   * the Prince 12 h with a 4x stop until the keeper has something to teach him. Workers: plain Orakelia, the six lab
   * variants, and random immigrants.
   */
  private found(): void {
    const now = this.now();
    const o = ORAKELIA;
    this.spawn({ id: "king", tier: "royal", role: "king", name: "King", genome: o, parentId: null, generation: 0, origin: "founder", mutations: null }, now);
    this.spawn({ id: "queen", tier: "royal", role: "queen", name: "Queen", genome: { ...o, minHoldHours: 6, trailAtr: 2 }, parentId: null, generation: 0, origin: "founder", mutations: "min hold 24 -> 6, stop 3 -> 2" }, now);
    this.spawn({ id: "prince", tier: "royal", role: "prince", name: "Prince", genome: { ...o, minHoldHours: 12, trailAtr: 4 }, parentId: null, generation: 0, origin: "founder", mutations: "min hold 24 -> 12, stop 3 -> 4" }, now);
    const labs: Array<[string, Partial<Genome>]> = [
      ["Orakelia, unchanged", {}],
      ["min hold 6 h", { minHoldHours: 6 }],
      ["min hold 12 h", { minHoldHours: 12 }],
      ["stop 2x", { trailAtr: 2 }],
      ["stop 4x", { trailAtr: 4 }],
      ["large caps", { universe: "large" }],
      ["mid/small caps", { universe: "midsmall" }],
    ];
    for (const [what, g] of labs) this.spawn({ tier: "worker", genome: { ...o, ...g }, parentId: null, generation: 0, origin: "founder", mutations: what }, now);
    while (this.workers().length < this.opts.workers) this.spawn({ tier: "worker", genome: randomGenome(this.rng), parentId: null, generation: 0, origin: "immigrant", mutations: null }, now);
    this.note(now, "founded", null, `the colony was founded: 3 royals and ${this.opts.workers} workers`);
  }

  private save(b: ColonyBee): void {
    this.db.raw
      .prepare(
        `INSERT INTO colony_bees (id, tier, role, name, genome_json, parent_id, parent2_id, generation, origin, mutations, born_at, died_at, death, final_equity, stars, xs, eggs, last_score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET tier = excluded.tier, genome_json = excluded.genome_json, parent_id = excluded.parent_id, generation = excluded.generation,
           mutations = excluded.mutations, born_at = excluded.born_at, died_at = excluded.died_at, death = excluded.death, final_equity = excluded.final_equity,
           stars = excluded.stars, xs = excluded.xs, eggs = excluded.eggs, last_score = excluded.last_score`,
      )
      .run(b.id, b.tier, b.role, b.name, JSON.stringify(b.genome), b.parentId, b.parent2Id, b.generation, b.origin, b.mutations, b.bornAt, b.diedAt, b.death, b.finalEquity, b.stars, b.xs, b.eggs, b.lastScore);
  }

  private note(ts: number, kind: string, bee: string | null, text: string): void {
    this.db.raw.prepare(`INSERT INTO colony_log (ts, kind, bee, text) VALUES (?,?,?,?)`).run(ts, kind, bee, text);
    log.info(`colony: ${text}`);
    this.bus?.emit("colony", { event: kind, bee, text }, ts);
  }
}
