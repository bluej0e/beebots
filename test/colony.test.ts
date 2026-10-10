import { describe, expect, it } from "vitest";
import { Colony, DEFAULT_OPTS } from "../src/colony/colony.js";
import { colonyBrain, knobsFor, rank } from "../src/colony/brain.js";
import { crossover, GENE_NAMES, GENES, mutate, ORAKELIA, parseGenome, randomGenome, type Genome } from "../src/colony/genome.js";
import { Db } from "../src/db.js";

/** Deterministic [0, 1) source. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const HOUR = 3_600_000;

function inRange(g: Genome) {
  for (const n of GENE_NAMES) {
    const s = GENES[n] as { kind: string; min?: number; max?: number; values?: readonly string[] };
    const v = g[n];
    if (s.kind === "num" || s.kind === "int") {
      expect(v as number).toBeGreaterThanOrEqual(s.min!);
      expect(v as number).toBeLessThanOrEqual(s.max!);
    }
    if (s.kind === "int") expect(Number.isInteger(v)).toBe(true);
    if (s.kind === "enum") expect(s.values).toContain(v);
    if (s.kind === "bool") expect(typeof v).toBe("boolean");
  }
}

describe("genome", () => {
  it("random and mutated genomes stay inside every gene's range and stay consistent", () => {
    const rng = seeded(7);
    let g = ORAKELIA;
    for (let i = 0; i < 500; i++) {
      const r = randomGenome(rng);
      inRange(r);
      expect(r.lock2At).toBeGreaterThan(r.lock1At);
      g = mutate(g, rng).genome;
      inRange(g);
      expect(g.lock2At).toBeGreaterThan(g.lock1At);
      inRange(crossover(g, r, rng));
    }
  });

  it("a mutation always changes at least one gene and reports what changed", () => {
    const rng = seeded(3);
    for (let i = 0; i < 100; i++) {
      const { genome, mutations } = mutate(ORAKELIA, rng);
      expect(mutations.length).toBeGreaterThan(0);
      for (const m of mutations) expect(genome[m.gene]).toBe(m.to);
    }
  });

  it("stored DNA from before a gene existed parses with the Orakelia value", () => {
    const old: Partial<Genome> = { ...ORAKELIA };
    delete old.useJev;
    expect(parseGenome(old).useJev).toBe(true);
    expect(() => parseGenome({ ...ORAKELIA, trailAtr: 99 })).toThrow();
  });

  it("Orakelia DNA gives the boozy knobs the labs ran", () => {
    const k = knobsFor(ORAKELIA);
    expect(k).toMatchObject({ maxTradesPerDay: 3, spreadGateBps: 15, cooldownMinutes: 2, maxFlatMinutes: 0, minHoldMinutes: 24 * 60, trailAtr: 3 });
  });
});

describe("colony brain", () => {
  const stats = (coin: string, r7: number, r24: number) => ({
    instId: `${coin}-USDT-SWAP`, coin, last: 1, mid: 1, bid: 1, ask: 1, spreadBp: 2, vol24hUsd: 5e7,
    rsi14: null, pctB: null, bbWidthPct: null, bbMid: null, atr14Pct: 1, macdHistPct: null, ret1hPct: 0,
    ret24hPct: r24, ret7dPct: r7, volZ: 0, fundingPct: 0, fundingZ: 0, oiUsd: null, oiChg1hPct: 0, newsZ: null, sentiment: null,
  });
  const view = {
    ts: 0, instruments: new Map(), tickers: new Map(), newsAvailable: false, spreadBlocked: [],
    gated: ["BTC-USDT-SWAP", "PEPE-USDT-SWAP", "TIA-USDT-SWAP"],
    stats: new Map([["BTC-USDT-SWAP", stats("BTC", 5, 1)], ["PEPE-USDT-SWAP", stats("PEPE", 20, -2)], ["TIA-USDT-SWAP", stats("TIA", 10, 3)]]),
  };

  it("ranks by the genome's weights inside its universe", () => {
    expect(rank(view, ORAKELIA).map((r) => r.s.coin)).toEqual(["PEPE", "TIA", "BTC"]);
    expect(rank(view, { ...ORAKELIA, universe: "large" }).map((r) => r.s.coin)).toEqual(["BTC"]);
    expect(rank(view, { ...ORAKELIA, w7d: 0, w24h: 1 }).map((r) => r.s.coin)[0]).toBe("TIA");
  });

  it("a rules-only bee lists its own pick first; needs-green-24h skips red coins", () => {
    const ctx = { bee: { position: null, top1: { coin: null, streak: 0, rankedAt: 0 } }, view, now: 0 } as never;
    const b = colonyBrain("Test", { ...ORAKELIA, useJev: false, requireUp24h: true });
    expect(b.rulesOnly).toBe(true);
    expect(Object.keys(b.menu(ctx))[0]).toBe("APE_TIA");
  });
});

describe("colony", () => {
  const T0 = 1_800_000_000_000;
  const make = (seed = 1, opts = DEFAULT_OPTS) => {
    let now = T0;
    const db = new Db(":memory:");
    const colony = new Colony(db, null, opts, seeded(seed), () => now);
    return { db, colony, at: (ms: number) => (now = ms) };
  };
  /** Equity snapshots that move linearly from 333 to 333 x (1 + pct/100) over the window. */
  const curve = (db: Db, bee: string, from: number, to: number, pct: number) => {
    for (let t = from; t <= to; t += HOUR) db.insertEquity(bee, t, 333 * (1 + ((pct / 100) * (t - from)) / (to - from)), 333, 0);
  };
  /** One round: each worker's curve over the last 25 h from `pct(bee)`, then rate. */
  const round = (c: ReturnType<typeof make>, t: number, pct: (id: string) => number) => {
    for (const w of c.colony.workers()) curve(c.db, w.id, t - 25 * HOUR, t, pct(w.id));
    c.at(t);
    c.colony.rate(t);
  };

  it("founds 3 royals and 12 mortal workers, Orakelia among them", () => {
    const { colony } = make();
    expect(colony.royals().map((b) => b.role)).toEqual(["king", "queen", "prince"]);
    expect(colony.workers()).toHaveLength(12);
    expect(colony.workers().some((b) => b.mutations === "Orakelia, unchanged")).toBe(true);
    expect(colony.ids()).toHaveLength(15);
    expect(colony.decideEveryMs("queen")).toBe(0);
    expect(colony.startEquityUsd("king")).toBe(333);
    expect(colony.startEquityUsd(colony.workers()[0]!.id)).toBe(100);
  });

  it("the best gets a star and the worst an X, every round", () => {
    const c = make();
    const ws = c.colony.workers();
    const t = T0 + 25 * HOUR;
    round(c, t, (id) => ws.findIndex((w) => w.id === id) - 5);
    expect(c.colony.get(ws[ws.length - 1]!.id)!.stars).toBe(1);
    expect(c.colony.get(ws[0]!.id)!.xs).toBe(1);
    expect(c.colony.lastRound()!.scores[0]!.bee).toBe(ws[ws.length - 1]!.id);
  });

  it("bees younger than the minimum age are not rated", () => {
    const { db, colony } = make();
    colony.workers().forEach((w, i) => curve(db, w.id, T0, T0 + 10 * HOUR, i));
    colony.rate(T0 + 10 * HOUR);
    expect(colony.lastRound()).toBeNull();
  });

  it("five X's kill any worker; five stars lay an egg that waits in the nursery, parent gets +1 and its stars reset", () => {
    const c = make(5);
    const [loser, star] = c.colony.workers();
    let t = T0;
    for (let r = 0; r < 5; r++) round(c, (t += 25 * HOUR), (id) => (id === loser!.id ? -20 : id === star!.id ? 20 : 1));
    expect(c.colony.get(loser!.id)!.death).toBe("5 X's");
    // The loser's death freed a cell, so the egg hatched straight into it.
    const kid = c.colony.alive().find((b) => b.parentId === star!.id && b.origin === "egg")!;
    expect(kid.tier).toBe("worker");
    expect(kid.generation).toBe(1);
    expect(kid.mutations).toBeTruthy();
    expect(c.colony.get(star!.id)!.stars).toBe(0);
    expect(c.colony.get(star!.id)!.eggs).toBe(1);
    expect(c.colony.workers()).toHaveLength(12);
  });

  it("with no free cell an egg waits; once overdue, the worst grown worker is terminated for it", () => {
    const c = make(11, { ...DEFAULT_OPTS, xsToDie: 99, eggWaitHours: 24 });
    const [star, worst] = c.colony.workers();
    let t = T0;
    for (let r = 0; r < 5; r++) round(c, (t += 25 * HOUR), (id) => (id === star!.id ? 20 : id === worst!.id ? -20 : 1));
    const egg = c.colony.nursery()[0]!;
    expect(egg.parentId).toBe(star!.id);
    expect(c.colony.ids()).not.toContain(egg.id);
    expect(c.colony.workers()).toHaveLength(12);
    round(c, (t += 25 * HOUR), (id) => (id === star!.id ? 20 : id === worst!.id ? -20 : 1));
    expect(c.colony.nursery()).toHaveLength(0);
    expect(c.colony.get(egg.id)!.tier).toBe("worker");
    expect(c.colony.get(worst!.id)!.death).toContain("terminated to make room");
  });

  it("the beekeeper learns which gene values win and teaches the Prince his blend", () => {
    const c = make(9);
    const ws = c.colony.workers();
    let t = T0;
    // Short holds win, long holds lose, every round.
    for (let r = 0; r < 4; r++) round(c, (t += 25 * HOUR), (id) => 10 - c.colony.get(id)!.genome.minHoldHours / 3);
    const l = c.colony.lessons(t);
    const hold = l.insights.find((i) => i.gene === "minHoldHours")!;
    expect(hold.effect).toBeLessThan(-0.5);
    expect(hold.value as number).toBeLessThan(24);
    expect(l.blend.minHoldHours).toBe(hold.value);
    c.colony.promote(t);
    expect(c.colony.get("prince")!.genome.minHoldHours).toBe(hold.value);
    expect(c.colony.diary(1)[0]!.text).toContain("min hold");
    void ws;
  });

  it("the keeper's guide tilts mutations towards the winners' value without forcing it", () => {
    const rng = seeded(4);
    const guide = { weight: { minHoldHours: 1 }, target: { minHoldHours: 3 } };
    let down = 0;
    let up = 0;
    for (let i = 0; i < 400; i++) {
      const { genome } = mutate(ORAKELIA, rng, 0.1, 0.15, guide);
      if (genome.minHoldHours < 24) down++;
      if (genome.minHoldHours > 24) up++;
    }
    expect(down).toBeGreaterThan(up * 2);
    expect(up).toBeGreaterThan(0);
  });

  it("the King needs the week by 5 points and 5 of its 7 days; the Queen 3 days by 2", () => {
    const c = make(9);
    const champ = c.colony.workers()[3]!;
    const t = T0 + 169 * HOUR;
    for (const b of c.colony.alive()) curve(c.db, b.id, T0, t, b.id === champ.id ? 15 : 1);
    c.at(t);
    c.colony.promote(t);
    expect(c.colony.get("king")!.genome).toEqual(champ.genome);
    expect(c.colony.get("queen")!.genome).toEqual(champ.genome);

    // A worker that made it all in one day out of seven: the Queen takes it, the King does not.
    const d = make(9);
    const lucky = d.colony.workers()[3]!;
    for (const b of d.colony.alive()) {
      if (b.id !== lucky.id) curve(d.db, b.id, T0, t, 1);
      else {
        curve(d.db, b.id, T0, t - 24 * HOUR, 0);
        for (let x = t - 23 * HOUR; x <= t; x += HOUR) d.db.insertEquity(b.id, x, 333 * (1 + (0.15 * (x - (t - 24 * HOUR))) / (24 * HOUR)), 333, 0);
      }
    }
    d.at(t);
    d.colony.promote(t);
    expect(d.colony.get("king")!.genome).toEqual(ORAKELIA);
    expect(d.colony.get("queen")!.genome).toEqual(lucky.genome);
  });

  it("survives a restart, and an old immortal control comes back as a plain worker", () => {
    const db = new Db(":memory:");
    const a = new Colony(db, null, DEFAULT_OPTS, seeded(2), () => 1);
    db.raw.prepare(`UPDATE colony_bees SET tier = 'control' WHERE id = ?`).run(a.workers()[0]!.id);
    const b = new Colony(db, null, DEFAULT_OPTS, seeded(99), () => 2);
    expect(b.ids().sort()).toEqual(a.ids().sort());
    expect(b.get(a.workers()[0]!.id)!.tier).toBe("worker");
  });

  it("the first tick only sets the clocks", () => {
    const { colony, at } = make();
    colony.tick();
    expect(colony.nextRatingAt()).toBe(T0 + 4 * HOUR);
    expect(colony.nextPromotionAt()).toBe(T0 + 24 * HOUR);
    at(T0 + 4 * HOUR);
    colony.tick();
    expect(colony.nextRatingAt()).toBe(T0 + 8 * HOUR);
  });
});
