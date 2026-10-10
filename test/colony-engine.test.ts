// The engine with a changing roster (the colony): bees join with fresh books, a removed bee is closed out before it
// leaves, and a bee that decides slowly still has its stop checked every tick.
import { describe, expect, it } from "vitest";
import type { Alerts } from "../src/alerts.js";
import type { BeeState } from "../src/bees/types.js";
import { colonyBrain, knobsFor } from "../src/colony/brain.js";
import { ORAKELIA } from "../src/colony/genome.js";
import { Db } from "../src/db.js";
import { Engine, type Roster } from "../src/engine.js";
import { EventBus } from "../src/events.js";
import type { Executor } from "../src/exec/executor.js";
import { Jev, type SystemOne } from "../src/jev.js";
import type { MarketFeed } from "../src/market/data.js";
import { coin, NOW, testConfig, view } from "./fixtures.js";

function rig(decideEveryMs = 0) {
  const cfg = testConfig({ DRY_RUN: "true" });
  const ena = coin("ENA", { ret24hPct: 25, ret7dPct: 43 });
  const v = view([ena, coin("SUI", { ret24hPct: 12, ret7dPct: 40 })]);
  let now = NOW;
  const feed = { view: () => v, refresh: async () => {}, refreshTickers: async () => {}, get lastRefreshAt() { return now; } } as unknown as MarketFeed;
  let jevCalls = 0;
  const client: SystemOne = {
    async systemOne() {
      jevCalls++;
      return { model: "fake", usage: { input_tokens: 100, output_tokens: 0 }, answers: { action: { type: "choice", choice: "APE_ENA", confidence: 0.9, probabilities: { APE_ENA: 0.9, APE_SUI: 0.1 } }, conviction: { type: "score", score: 1, confidence: 1, legend: {}, probabilities: {} } } } as never;
    },
  };
  const orders: string[] = [];
  const exec: Executor = {
    kind: "sim",
    async init() {},
    async market(bee, req) {
      orders.push(`${bee}:${req.side}:${req.reduceOnly ? "close" : "open"}`);
      const t = v.tickers.get(req.instId)!;
      return { ok: true, ordId: null, contracts: req.contracts, avgPx: t.mid, feeUsd: 0.01, ts: now };
    },
    async positions() { return []; },
    async fundingBills() { return []; },
    async feesFor() { return new Map(); },
  };
  let ids = ["a", "b"];
  const exits: Array<[string, BeeState]> = [];
  const brain = colonyBrain("T", ORAKELIA);
  const roster: Roster = {
    ids: () => ids,
    name: (id) => id.toUpperCase(),
    brain: () => brain,
    knobs: () => knobsFor(ORAKELIA),
    decideEveryMs: () => decideEveryMs,
    startEquityUsd: (id) => (id === "a" ? 100 : 333),
    onExit: (id, s) => exits.push([id, s]),
  };
  const db = new Db(":memory:");
  const engine = new Engine({ cfg, db, feed, jev: new Jev({ ...cfg.jev, client, now: () => now }), exec, bus: new EventBus(db), alerts: { send: () => {} } as unknown as Alerts, now: () => now, roster });
  return {
    engine, v, ena, orders, exits,
    setIds: (x: string[]) => (ids = x),
    advance: (ms: number) => (now += ms),
    jevCalls: () => jevCalls,
  };
}

describe("engine with a colony roster", () => {
  it("bees join with fresh books; a removed bee is closed out, then dropped, then onExit fires once", async () => {
    const r = rig();
    await r.engine.start();
    r.engine.stop();
    await r.engine.tick();
    expect(r.engine.bees.a!.position?.coin).toBe("ENA");
    expect(r.engine.bees.b!.position?.coin).toBe("ENA");

    r.setIds(["b", "c"]);
    r.advance(10_000);
    await r.engine.tick();
    expect(r.orders.filter((o) => o.startsWith("a:"))).toEqual(["a:buy:open", "a:sell:close"]);
    expect(r.engine.bees.a).toBeUndefined();
    expect(r.exits.map(([id]) => id)).toEqual(["a"]);
    expect(r.exits[0]![1].position).toBeNull();
    expect(r.engine.bees.c!.position?.coin).toBe("ENA");
    expect(r.engine.snapshot().bees.map((b) => b.bee).sort()).toEqual(["b", "c"]);

    r.advance(10_000);
    await r.engine.tick();
    expect(r.exits).toHaveLength(1);
  });

  it("each bee starts with its roster's paper money, and a $100 bee is not retired against the $333 line", async () => {
    const r = rig();
    await r.engine.start();
    r.engine.stop();
    await r.engine.tick();
    expect(r.engine.bees.a!.startEquityUsd).toBe(100);
    expect(r.engine.bees.b!.startEquityUsd).toBe(333);
    expect(r.engine.bees.a!.cap).toBeNull();
    const a = r.engine.snapshot().bees.find((b) => b.bee === "a")!;
    expect(a.startEquityUsd).toBe(100);
    expect(Math.abs(a.pnlPct)).toBeLessThan(5);
  });

  it("a slow-deciding bee asks Jev only on its rhythm, but its stop fires on the very next tick", async () => {
    const r = rig(10 * 60_000);
    r.setIds(["a"]);
    await r.engine.start();
    r.engine.stop();
    await r.engine.tick();
    expect(r.jevCalls()).toBe(1);
    for (let i = 0; i < 5; i++) {
      r.advance(30_000);
      await r.engine.tick();
    }
    expect(r.jevCalls()).toBe(1);

    // Crash the price through the stop: closed on the next tick, not at the next decision.
    const p = r.engine.bees.a!.position!;
    expect(p.stopPx).not.toBeNull();
    const crash = p.stopPx! * 0.99;
    Object.assign(r.ena, { mid: crash, last: crash, bid: crash, ask: crash });
    Object.assign(r.v.tickers.get(r.ena.instId)!, { mid: crash, last: crash, bid: crash, ask: crash });
    r.advance(30_000);
    await r.engine.tick();
    expect(r.engine.bees.a!.position).toBeNull();
    expect(r.orders).toEqual(["a:buy:open", "a:sell:close"]);
    expect(r.jevCalls()).toBe(1);
  });
});
