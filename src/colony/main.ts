// The colony engine: one process, one market feed, the royals and the worker grid on paper.
//
//   node dist/colony/main.js
//
// Environment (everything else as in .env.example):
//   COLONY_DB        default ./data/colony/colony-{mode}.sqlite
//   SETTINGS_PATH    a Setup file to borrow the Jev key from (or set TYPESAFE_API_KEY)
//   COLONY_WORKERS, COLONY_RATE_EVERY_HOURS, COLONY_RATE_WINDOW_HOURS, COLONY_MIN_AGE_HOURS,
//   COLONY_STARS_TO_BREED, COLONY_XS_TO_DIE, COLONY_PROMOTE_EVERY_HOURS, COLONY_IMMIGRANT_RATE,
//   COLONY_EGG_WAIT_HOURS, COLONY_MAX_NURSERY, COLONY_LEARN_WINDOW_HOURS,
//   COLONY_ROYAL_EQUITY_USD (default 333), COLONY_WORKER_EQUITY_USD (default 100): paper money each bee starts with
//   COLONY_KEEPER_CLAUDE=1   the beekeeper's daily visit also asks Claude (the local `claude` CLI) for a diary entry,
//                            a quip and up to 3 gene ideas for the Prince. Without it he writes his own plain diary.
//
// Paper only for now: the royals are where real money would go one day, behind the same LIVE_ACK gate as the
// classic engine, but this entrypoint refuses anything but MODE=dry until that has been built and tested.
import { Alerts } from "../alerts.js";
import { ConfigError, loadConfig } from "../config.js";
import { Db } from "../db.js";
import { Engine } from "../engine.js";
import { EventBus } from "../events.js";
import { SimExecutor } from "../exec/executor.js";
import { Jev } from "../jev.js";
import { log, setLogLevel } from "../log.js";
import { MarketFeed } from "../market/data.js";
import { createPublicApi } from "../okx/public.js";
import { createOkxPublicRest } from "../okx/rest.js";
import { safeError } from "../redact.js";
import { startServer } from "../server.js";
import { loadSettings } from "../settings.js";
import { Visitors } from "../visitors.js";
import { BREEZY_COINS } from "../bees/breezy.js";
import { Colony, DEFAULT_OPTS, type ColonyOpts } from "./colony.js";
import { GENES } from "./genome.js";
import { claudeAdvisor } from "./advisor.js";
import { beeDetail, colonyView } from "./view.js";

function opts(env: NodeJS.ProcessEnv): ColonyOpts {
  const n = (k: string, d: number, min: number) => {
    const v = Number(env[k]);
    return env[k]?.trim() && Number.isFinite(v) && v >= min ? v : d;
  };
  return {
    workers: Math.round(n("COLONY_WORKERS", DEFAULT_OPTS.workers, 4)),
    rateEveryHours: n("COLONY_RATE_EVERY_HOURS", DEFAULT_OPTS.rateEveryHours, 0.25),
    rateWindowHours: n("COLONY_RATE_WINDOW_HOURS", DEFAULT_OPTS.rateWindowHours, 1),
    minAgeHours: n("COLONY_MIN_AGE_HOURS", DEFAULT_OPTS.minAgeHours, 0),
    starsToBreed: Math.round(n("COLONY_STARS_TO_BREED", DEFAULT_OPTS.starsToBreed, 1)),
    xsToDie: Math.round(n("COLONY_XS_TO_DIE", DEFAULT_OPTS.xsToDie, 1)),
    promoteEveryHours: n("COLONY_PROMOTE_EVERY_HOURS", DEFAULT_OPTS.promoteEveryHours, 1),
    eggWaitHours: n("COLONY_EGG_WAIT_HOURS", DEFAULT_OPTS.eggWaitHours, 0),
    maxNursery: Math.round(n("COLONY_MAX_NURSERY", DEFAULT_OPTS.maxNursery, 0)),
    learnWindowHours: n("COLONY_LEARN_WINDOW_HOURS", DEFAULT_OPTS.learnWindowHours, 4),
    royalDecideMs: 0,
    royalEquityUsd: n("COLONY_ROYAL_EQUITY_USD", DEFAULT_OPTS.royalEquityUsd, 10),
    workerEquityUsd: n("COLONY_WORKER_EQUITY_USD", DEFAULT_OPTS.workerEquityUsd, 10),
    immigrantRate: Math.min(1, n("COLONY_IMMIGRANT_RATE", DEFAULT_OPTS.immigrantRate, 0)),
  };
}

async function main() {
  const env = process.env;
  const settingsPath = env.SETTINGS_PATH?.trim() || "./data/settings.json";
  let cfg;
  try {
    cfg = loadConfig({ ...env, DB_PATH: env.COLONY_DB?.trim() || "./data/colony/colony-{mode}.sqlite" }, loadSettings(settingsPath));
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error("refusing to start", { reason: err.message });
      process.exit(1);
    }
    throw err;
  }
  if (cfg.mode !== "dry") {
    log.error("refusing to start: the colony runs on paper only (MODE=dry) for now");
    process.exit(1);
  }
  setLogLevel(cfg.logLevel);

  const db = new Db(cfg.dbPath);
  const bus = new EventBus(db);
  const alerts = new Alerts(cfg.alertWebhookUrl);
  const api = createPublicApi(cfg.okx.apiBase, false, createOkxPublicRest({ apiBase: cfg.okx.apiBase, timeoutMs: cfg.okx.cliTimeoutMs }));
  const colony = new Colony(db, bus, opts(env));

  let engine: Engine | null = null;
  const held = () => (engine ? Object.values(engine.bees).map((b) => b.position?.instId).filter((x): x is string => !!x) : []);
  // The widest spread gate any genome can have, so every bee's coins are in the feed.
  const feed = new MarketFeed(api, { min24hVolUsd: cfg.universe.min24hVolUsd, allowNonCrypto: cfg.universe.allowNonCrypto, spreadGateBps: GENES.spreadGateBps.max, trendCoins: [...BREEZY_COINS] }, null, held);
  const exec = new SimExecutor(() => feed.view(), cfg.risk.takerFeeRate);
  const startOfDay = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const jev = new Jev({ ...cfg.jev, spentTodayUsd: db.jevSpendSince(startOfDay) });

  engine = new Engine({ cfg, db, feed, jev, exec, bus, alerts, roster: colony });
  await engine.start();
  if (/^(1|true|yes|on)$/i.test(env.COLONY_KEEPER_CLAUDE?.trim() ?? "")) colony.setAdvisor(claudeAdvisor(env.CLAUDE_KEEPER_MODEL?.trim() || "claude-opus-5-5"));
  colony.tick();
  const colonyTimer = setInterval(() => colony.tick(), 30_000);
  log.info("colony started", { bees: colony.ids().length, db: cfg.dbPath, opts: colony.opts });

  const server = startServer(
    {
      engine: { bus, db, visitors: new Visitors(db), snapshot: () => engine!.snapshot(), health: () => engine!.health() },
      profile: () => ({ setup: false, mode: cfg.mode, links: cfg.links, colony: true, bees: [] }),
      beeImage: () => null,
      routes: {
        "/colony/state": () => colonyView(colony, engine!.snapshot(), engine!.health()),
        "/colony/bee": (url) => beeDetail(db, colony, url.searchParams.get("id") ?? ""),
      },
    },
    cfg.server.port,
    cfg.server.bind,
  );

  const shutdown = (sig: string) => {
    log.info("shutting down", { sig });
    clearInterval(colonyTimer);
    engine?.stop();
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { err: safeError(err) });
  process.exit(1);
});
