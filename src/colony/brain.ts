// A colony bee's brain: the Momentum (boozy) strategy with every constant read from the bee's genome. The engine,
// the risk layer and the ledger treat it exactly like any other brain, so every hard rule still applies.
import { atrStop, maxNotionalUsd, minutesSince, positionNotional, r2 } from "../bees/common.js";
import type { BeeBrain, BeeContext, Menu, MenuOption } from "../bees/types.js";
import type { BeeKnobs } from "../config.js";
import type { CoinStats, MarketView } from "../market/types.js";
import { universeCoins, type Genome } from "./genome.js";

export interface Ranked {
  s: CoinStats;
  score: number;
}

function zs(xs: number[]): (x: number) => number {
  const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)) || 1;
  return (x) => (x - m) / sd;
}

/** Every coin this genome may trade, best momentum score first. */
export function rank(view: MarketView, g: Genome): Ranked[] {
  const allowed = universeCoins(g.universe);
  const pool = view.gated
    .map((id) => view.stats.get(id))
    .filter((s): s is CoinStats => !!s && s.ret24hPct !== null && s.spreadBp <= g.spreadGateBps && (!allowed || allowed.includes(s.coin)));
  if (!pool.length) return [];
  const z24 = zs(pool.map((s) => s.ret24hPct!));
  const z7 = zs(pool.map((s) => s.ret7dPct ?? s.ret24hPct!));
  const z1 = zs(pool.map((s) => s.ret1hPct ?? 0));
  return pool
    .map((s) => ({
      s,
      score: g.w7d * z7(s.ret7dPct ?? s.ret24hPct!) + g.w24h * z24(s.ret24hPct!) + g.w1h * z1(s.ret1hPct ?? 0) + g.wAttn * Math.max(0, s.newsZ ?? s.volZ ?? 0),
    }))
    .sort((a, b) => b.score - a.score);
}

const longable = (g: Genome) => (r: Ranked) => !g.requireUp24h || (r.s.ret24hPct ?? 0) > 0;
/** 1h ATR approximated as 2 x the 15m ATR (sqrt of 4 bars), as boozy does. */
const atr1hPx = (s: CoinStats | undefined) => (s && s.atr14Pct !== null ? (s.mid * s.atr14Pct * 2) / 100 : null);

export function knobsFor(g: Genome): BeeKnobs {
  return {
    maxTradesPerDay: g.maxTradesPerDay,
    feeBudgetUsdDay: Math.max(1, g.maxTradesPerDay),
    spreadGateBps: g.spreadGateBps,
    cooldownMinutes: g.cooldownMinutes,
    stopAtrMult: 2,
    maxFlatMinutes: g.canWait ? g.maxFlatMinutes : 0,
    minHoldMinutes: g.minHoldHours * 60,
    trailAtr: g.trailAtr,
  };
}

/** What the bee tells Jev it is, in one paragraph built from its genes. */
export function strategyText(name: string, g: Genome): string {
  const where = g.universe === "large" ? "large-cap coins only" : g.universe === "midsmall" ? "mid and small caps only" : "any liquid coin";
  const parts = [
    `You are ${name}, a momentum bee in an evolving colony. Back the strongest mover among ${where}${g.shortLosers ? ", or short the weakest" : ""}.`,
    g.addFrac > 0 ? `DOUBLE_DOWN into a winner each time it runs another ${g.addEveryAtr} ATR.` : "Never add to a position.",
    `Commit to each pick for ${g.minHoldHours} hours: bailing and rotating unlock after that.`,
    g.canWait ? "WAIT when nothing looks clean; staying flat is allowed." : "Always be holding something.",
    "The code trails your stop.",
  ];
  return parts.join(" ");
}

export function colonyBrain(name: string, g: Genome): BeeBrain {
  const lock = [
    { atPct: g.lock1At, keep: g.lock1Keep },
    { atPct: g.lock2At, keep: g.lock2Keep },
  ].filter((r) => r.keep > 0);

  /** The coin to rotate into, or null: outranks the held long now and was #1 on the last `switchStreak` hourly ranks. */
  const switchTarget = (ctx: BeeContext, ranked: Ranked[]): Ranked | null => {
    const p = ctx.bee.position;
    if (!p || p.side !== "long") return null;
    const leader = ranked.filter(longable(g))[0];
    if (!leader || leader.s.instId === p.instId || !ranked.some((r) => r.s.instId === p.instId)) return null;
    const { coin, streak } = ctx.bee.top1;
    return coin === leader.s.coin && streak >= g.switchStreak ? leader : null;
  };

  const losers = (ranked: Ranked[]) =>
    g.shortLosers
      ? ranked
          .slice()
          .reverse()
          .filter((r) => (r.s.ret24hPct ?? 0) < 0)
          .slice(0, 2)
      : [];

  return {
    id: "boozy",
    strategy: strategyText(name, g),
    convictionLabels: ["tipsy", "buzzed", "wasted", "legendary"],
    profitLock: lock,
    protectAdds: true,
    rulesOnly: !g.useJev,

    universe: (ctx) => rank(ctx.view, g).map((r) => r.s.instId),

    snapshotCoins(ctx) {
      const ranked = rank(ctx.view, g);
      const ids = ranked
        .filter(longable(g))
        .slice(0, g.candidates)
        .map((r) => r.s.instId);
      for (const r of losers(ranked)) if (!ids.includes(r.s.instId)) ids.push(r.s.instId);
      const p = ctx.bee.position;
      if (p && !ids.includes(p.instId)) ids.push(p.instId);
      return ids;
    },

    coinSnapshot(s, ctx) {
      const row: Record<string, number | string | null> = {
        r1h_pct: r2(s.ret1hPct, 1),
        r24h_pct: r2(s.ret24hPct, 0),
        r7d_pct: r2(s.ret7dPct, 0),
        attn_z: r2(s.newsZ ?? s.volZ, 1),
        oi1h_pct: r2(s.oiChg1hPct, 1),
        spread_bp: r2(s.spreadBp, 0),
        vol_musd: r2(s.vol24hUsd / 1e6, 1),
      };
      if (ctx.view.newsAvailable) row.sentiment = r2(s.sentiment, 1);
      return row;
    },

    menu(ctx) {
      const ranked = rank(ctx.view, g);
      const m: Menu = {};
      const p = ctx.bee.position;
      if (!p) {
        const top = ranked.filter(longable(g)).slice(0, g.candidates);
        // Rules-only bees take the first option, so the order here is their preference.
        for (const [i, r] of top.entries()) m[`APE_${r.s.coin}`] = { desc: `#${i + 1} momentum`, intent: { kind: "open", instId: r.s.instId, side: "long", sizeFrac: g.entryFrac, setup: "strict" } };
        for (const r of losers(ranked)) m[`SHORT_${r.s.coin}`] = { desc: `weakest, 24h ${r2(r.s.ret24hPct, 0)}%`, intent: { kind: "open", instId: r.s.instId, side: "short", sizeFrac: g.entryFrac, setup: "strict" } };
        if (g.canWait) m.WAIT = { desc: "stay flat", intent: { kind: "hold" } };
        return m;
      }
      const s = ctx.view.stats.get(p.instId);
      const inst = ctx.view.instruments.get(p.instId);
      const opts: Array<[string, MenuOption]> = [];
      const committed = minutesSince(p.openedAt, ctx.now) < g.minHoldHours * 60;
      // Pyramid: one more add each time price has run another `addEveryAtr` ATR(1h) past the average entry.
      const notional = s && inst ? positionNotional(p, s.mid, inst.ctVal) : 0;
      const max = maxNotionalUsd(ctx);
      const atr = atr1hPx(s);
      if (g.addFrac > 0 && max > 0 && notional < max * 0.95 && s && atr) {
        const steps = Math.max(0, Math.round((notional / max - g.entryFrac) / g.addFrac));
        const runAtr = ((p.side === "long" ? 1 : -1) * (s.mid - p.entryPx)) / atr;
        if (runAtr >= (steps + 1) * g.addEveryAtr) opts.push(["DOUBLE_DOWN", { desc: `add (run ${runAtr.toFixed(1)} ATR)`, intent: { kind: "add", sizeFrac: g.addFrac } }]);
      }
      const best = committed ? null : switchTarget(ctx, ranked);
      if (best) opts.push(["SWITCH_COIN", { desc: `close, ape ${best.s.coin}`, intent: { kind: "switch", instId: best.s.instId, side: "long", sizeFrac: g.entryFrac, setup: "strict" } }]);
      opts.push(["RIDE", { desc: "keep position", intent: { kind: "hold" } }]);
      if (!committed) opts.push(["BAIL", { desc: "close now", intent: { kind: "close", reason: "bail" } }]);
      if (!committed && g.flipShort && p.side === "long" && s && (s.ret1hPct ?? 0) < 0 && (s.oiChg1hPct ?? 0) < 0) {
        opts.push(["FLIP_SHORT", { desc: "reverse to short", intent: { kind: "switch", instId: p.instId, side: "short", sizeFrac: g.entryFrac, setup: "strict" } }]);
      }
      // A Jev bee sees RIDE first (as boozy always did); a rules-only bee's first option is its move.
      if (g.useJev) opts.sort((a, b) => (a[0] === "RIDE" ? -1 : b[0] === "RIDE" ? 1 : 0));
      for (const [k, v] of opts) m[k] = v;
      return m;
    },

    forcedEntry(ctx) {
      const r = rank(ctx.view, g).filter(longable(g))[0];
      return r ? { kind: "open", instId: r.s.instId, side: "long", sizeFrac: g.entryFrac, setup: "loose" } : null;
    },

    sizeFrac: (intent) => intent.sizeFrac,

    stopFor(instId, side, entryPx, ctx) {
      const s = ctx.view.stats.get(instId);
      const atr = atr1hPx(s);
      if (atr === null) return atrStop(s, side, entryPx, 2);
      return side === "long" ? entryPx - g.trailAtr * atr : entryPx + g.trailAtr * atr;
    },

    trail(ctx) {
      const p = ctx.bee.position;
      const s = p ? ctx.view.stats.get(p.instId) : undefined;
      const atr = atr1hPx(s);
      if (!p || !s || atr === null) return null;
      return p.side === "long" ? s.mid - g.trailAtr * atr : s.mid + g.trailAtr * atr;
    },

    idleStatus: () => "waiting for a clean setup",
  };
}
