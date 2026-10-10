import { useEffect, useMemo, useState } from "react";
import { BeeDetail } from "./BeeDetail";
import { DnaGlyph, GeneStrip, Radar, hue, type RadarSeries } from "./dna";
import { ORAKELIA, type Bee, type ColonyView, type GeneSpec, type RoundScore } from "./types";

type Curves = Record<string, Array<[number, number]>>;

function useColony() {
  const [view, setView] = useState<ColonyView | null>(null);
  const [curves, setCurves] = useState<Curves>({});
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/colony/state", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const v = (await r.json()) as ColonyView;
        if (alive) {
          setView(v);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    const pullCurves = async () => {
      try {
        const r = await fetch("/equity?days=3", { cache: "no-store" });
        if (r.ok && alive) setCurves((await r.json()) as Curves);
      } catch {
        /* the next pull will try again */
      }
    };
    void pull();
    void pullCurves();
    const a = setInterval(pull, 5000);
    const b = setInterval(pullCurves, 60_000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);
  return { view, curves, error };
}

// ---------- formatting ----------

const money = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (x: number, dp = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}`;
const tone = (x: number | null | undefined) => (x === null || x === undefined || Math.abs(x) < 0.005 ? "" : x > 0 ? "good" : "bad");

function until(ts: number, now: number): string {
  const s = Math.max(0, Math.round((ts - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function age(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function ago(ts: number, now: number): string {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function fmtGene(spec: GeneSpec | undefined, v: number | boolean | string): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (spec?.name === "universe") return v === "any" ? "any coin" : v === "large" ? "large caps" : "mid/small";
  return String(v);
}

function traitChips(b: Pick<Bee, "genome">): string[] {
  const g = b.genome;
  const out: string[] = [];
  out.push(g.universe === "any" ? "any coin" : g.universe === "large" ? "large caps" : "mid/small");
  out.push(`hold ${g.minHoldHours}h`);
  out.push(`stop ${g.trailAtr}×`);
  if (!g.useJev) out.push("rules-only");
  if (g.shortLosers) out.push("shorts");
  if (g.canWait) out.push("waits");
  if (g.addFrac === 0) out.push("no adds");
  return out;
}

const beeColor = (b: Pick<Bee, "id" | "tier">) => (b.tier === "royal" ? "#c98500" : `hsl(${hue(b.id)} 60% 58%)`);

// ---------- small parts ----------

function Pips({ n, of, kind }: { n: number; of: number; kind: "star" | "x" }) {
  return (
    <span className={`pips ${kind}`} title={`${n} of ${of} ${kind === "star" ? `stars (lays an egg at ${of})` : `X's (dies at ${of})`}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={i < n ? "on" : ""}>
          {kind === "star" ? "★" : "✕"}
        </span>
      ))}
    </span>
  );
}

function Spark({ points, base, tall = false }: { points?: Array<[number, number]>; base: number; tall?: boolean }) {
  if (!points || points.length < 2) return <div className={`spark empty ${tall ? "tall" : ""}`}>warming up</div>;
  const w = 100;
  const h = tall ? 36 : 22;
  const ys = points.map((p) => p[1]);
  const lo = Math.min(base, ...ys);
  const hi = Math.max(base, ...ys);
  const span = hi - lo || 1;
  const t0 = points[0]![0];
  const t1 = points[points.length - 1]![0];
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => h - ((v - lo) / span) * (h - 2) - 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const up = ys[ys.length - 1]! >= base;
  return (
    <svg className={`spark ${tall ? "tall" : ""}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={w} y1={y(base)} y2={y(base)} className="spark-base" />
      <path d={d} className={up ? "spark-up" : "spark-down"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PositionLine({ b }: { b: Bee }) {
  const p = b.live?.position;
  if (!b.live) return <div className="pos dim">joining…</div>;
  if (!p) return <div className="pos dim">flat{b.live.flatMinutes ? ` ${b.live.flatMinutes}m` : ""}</div>;
  return (
    <div className="pos">
      <span className={`side ${p.side}`}>{p.side === "long" ? "▲" : "▼"}</span>
      <span className="coin">{p.coin}</span>
      <span className="dim">{p.sizeUsd !== null ? `$${Math.round(p.sizeUsd)}` : ""}</span>
      <span className={`num ${tone(p.uplUsd)}`}>{signed(p.uplUsd)}</span>
    </div>
  );
}

const EggTag = ({ n }: { n: number }) =>
  n > 0 ? (
    <span className="plus" title={`laid ${n} egg${n === 1 ? "" : "s"}`}>
      +{n}
    </span>
  ) : null;

// ---------- cards ----------

function RoyalCard({ b, curve, base, onOpen }: { b: Bee; curve?: Array<[number, number]>; base: number; onOpen: () => void }) {
  const crown = b.role === "king" ? "♚" : b.role === "queen" ? "♛" : "♜";
  return (
    <button className={`royal ${b.role}`} onClick={onOpen}>
      <div className="royal-head">
        <DnaGlyph genome={b.genome} id={b.id} royal size={3.6} />
        <div>
          <div className="royal-title">
            {crown} {b.rule?.title ?? b.name}
          </div>
          <div className="royal-blurb">{b.rule?.blurb}</div>
        </div>
      </div>
      <div className="royal-money">
        <span className="num big">{b.live ? money(b.live.equityUsd) : "—"}</span>
        <span className={`num ${tone(b.live?.pnlPct)}`}>{b.live ? `${signed(b.live.pnlPct)}%` : ""}</span>
      </div>
      <Spark points={curve} base={base} tall />
      <PositionLine b={b} />
      <div className="royal-dna">
        <span className="eyebrow">DNA</span>{" "}
        {b.role === "prince" && b.origin !== "founder" ? "the beekeeper's blend" : b.parent ? <>from {b.parent.name} · gen {b.generation}</> : "founding DNA"}
        {b.mutations && <div className="dim small">{b.mutations}</div>}
      </div>
      <div className="chips">
        {traitChips(b).map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}

function WorkerCard({ b, curve, base, rank, rules, onOpen }: { b: Bee; curve?: Array<[number, number]>; base: number; rank: RoundScore | undefined; rules: ColonyView["rules"]; onOpen: () => void }) {
  const young = b.ageHours < rules.minAgeHours;
  return (
    <button className={`cell ${b.xs >= rules.xsToDie - 1 ? "danger" : ""} ${b.stars >= rules.starsToBreed - 1 ? "ready" : ""}`} onClick={onOpen}>
      <div className="cell-head">
        <DnaGlyph genome={b.genome} id={b.id} size={2.9} />
        <div className="cell-id">
          <div className="cell-name">
            {b.name}
            <EggTag n={b.eggs} />
          </div>
          <div className="dim small">
            gen {b.generation} · {age(b.ageHours)}
            {young ? " · unrated" : ""}
          </div>
        </div>
        <div className={`num cell-pnl ${tone(b.live?.pnlPct)}`}>{b.live ? `${signed(b.live.pnlPct, 1)}%` : ""}</div>
      </div>
      <div className="cell-marks">
        <Pips n={b.stars} of={rules.starsToBreed} kind="star" />
        <Pips n={b.xs} of={rules.xsToDie} kind="x" />
      </div>
      <Spark points={curve} base={base} />
      <PositionLine b={b} />
      <div className="cell-foot">
        <div className="chips">
          {traitChips(b)
            .slice(0, 4)
            .map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
        </div>
        {rank && <span className={`rank ${rank.mark ?? ""}`}>#{rank.rank}</span>}
      </div>
    </button>
  );
}

// ---------- side panels ----------

function KeeperPanel({ view, onOpen }: { view: ColonyView; onOpen: (id: string) => void }) {
  const k = view.keeper;
  const latest = k.diary[0];
  const quip = k.diary.find((d) => d.quip)?.quip;
  return (
    <section className="panel keeper">
      <div className="keeper-head">
        <img src="/beekeeper.jpg" alt="" className="keeper-face" />
        <div>
          <div className="keeper-title">The Beekeeper</div>
          <div className="dim small">
            learns from {k.samples} ratings · next visit in {until(view.nextPromotionAt, Date.now())}
          </div>
        </div>
      </div>
      {quip && <p className="quip">“{quip}”</p>}
      <p className="small">{latest ? latest.text : "Watching. He needs a few rating rounds before he has an opinion."}</p>
      {k.insights.length > 0 && (
        <>
          <div className="eyebrow keeper-sub">What's working</div>
          <ul className="insights">
            {k.insights.slice(0, 6).map((i) => (
              <li key={i.gene} title={i.verdict}>
                <span className="ins-label">{i.label}</span>
                <span className="ins-bar">
                  <span className={i.effect >= 0 ? "pos" : "neg"} style={{ width: `${Math.min(50, Math.abs(i.effect) * 50)}%` }} />
                </span>
                <span className="num small">{fmtGene(view.genes.find((g) => g.name === i.gene), i.value)}</span>
              </li>
            ))}
          </ul>
          <p className="dim small">Bar: how strongly the gene goes with winning (right: more of it wins). Number: what the winners lean towards. He tilts every mutation towards these, and the Prince trades them.</p>
        </>
      )}
      <button className="link small" onClick={() => onOpen("prince")}>
        See the Prince, his apprentice →
      </button>
    </section>
  );
}

function Nursery({ view, onOpen }: { view: ColonyView; onOpen: (id: string) => void }) {
  if (!view.nursery.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="eyebrow">Nursery</span>
        <span className="dim small">waiting for a cell</span>
      </div>
      <ul className="nursery">
        {view.nursery.map((e) => (
          <li key={e.id}>
            <button onClick={() => onOpen(e.id)}>
              <DnaGlyph genome={e.genome} id={e.id} size={1.9} />
              <span>
                <b>{e.name}</b> <span className="dim small">of {e.parent?.name}</span>
                <span className="dim small block">hatches when a bee dies, or in {until(e.hatchBy, Date.now())} (the worst worker makes room)</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoundTable({ view }: { view: ColonyView }) {
  const r = view.lastRound;
  const ran = view.lastRoundRun;
  const name = (id: string) => view.lineage.find((b) => b.id === id)?.name ?? id;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="eyebrow">Last rating</span>
        <span className="dim small">{ran ? `round ${ran.round} · ${ago(ran.ts, view.ts)}` : `first round in ${until(view.nextRatingAt, view.ts)}`}</span>
      </div>
      {ran && ran.rated < 3 && (
        <p className="small notice">
          Round {ran.round} ran on schedule, but no worker is {view.rules.minAgeHours}h old yet, so nobody could be rated.
          {view.firstMarksAt && (
            <>
              {" "}
              First stars and X's at <b>{new Date(view.firstMarksAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b> (in {until(view.firstMarksAt, Date.now())}).
            </>
          )}
        </p>
      )}
      {!r ? (
        <p className="dim small">
          Every {view.rules.rateEveryHours}h each worker older than {view.rules.minAgeHours}h is scored on its last {view.rules.rateWindowHours}h: return minus half its worst drawdown. Best gets a star, worst an X.
        </p>
      ) : (
        <table className="round">
          <tbody>
            {r.scores.map((s) => (
              <tr key={s.bee}>
                <td className="dim num">{s.rank}</td>
                <td>{name(s.bee)}</td>
                <td className={`num ${tone(s.score)}`}>{signed(s.score)}</td>
                <td className="mark">{s.mark === "star" ? <span className="star-on">★</span> : s.mark === "x" ? <span className="x-on">✕</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const LOG_ICON: Record<string, string> = { star: "★", x: "✕", death: "†", birth: "◇", egg: "◎", promotion: "♛", founded: "⬡", round: "·" };

function HiveLog({ view }: { view: ColonyView }) {
  return (
    <section className="panel log">
      <div className="panel-head">
        <span className="eyebrow">Hive log</span>
      </div>
      <ol>
        {[...view.log].reverse().map((l, i) => (
          <li key={i} className={`log-${l.kind}`}>
            <span className="log-icon">{LOG_ICON[l.kind] ?? "·"}</span>
            <span className="log-text">{l.text}</span>
            <span className="dim small log-ago">{ago(l.ts, view.ts)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Graveyard({ view, onOpen }: { view: ColonyView; onOpen: (id: string) => void }) {
  if (!view.graveyard.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="eyebrow">Graveyard</span>
        <span className="dim small">{view.stats.died} gone</span>
      </div>
      <ul className="grave">
        {view.graveyard.map((b) => (
          <li key={b.id}>
            <button onClick={() => onOpen(b.id)}>
              <span>† {b.name}</span>
              <span className="dim small">
                gen {b.generation} · {age((b.diedAt! - b.bornAt) / 3_600_000)} · {b.death}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Proof of life: is the engine actually trading, and since when. */
function Pulse({ view }: { view: ColonyView }) {
  const a = view.activity;
  const quiet = a.lastDecisionAt === null || Date.now() - a.lastDecisionAt > 3 * 60_000;
  const up = a.continuousSince ? (Date.now() - a.continuousSince) / 1000 : 0;
  const upText = up >= 86400 ? `${(up / 86400).toFixed(1)} days` : up >= 3600 ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` : `${Math.floor(up / 60)}m`;
  return (
    <div className={`pulse ${quiet ? "quiet" : ""}`}>
      <span className="pulse-dot" />
      <b>{quiet ? "Quiet" : "Live"}</b>
      <span title={`longest pause between equity snapshots: ${a.longestGapMin} min (a restart for an update takes under a minute)`}>trading {upText} without a break</span>
      <span>last move {a.lastDecisionAt ? ago(a.lastDecisionAt, Date.now()) : "never"}</span>
      <span>{a.decisions.toLocaleString()} decisions</span>
      <span>{a.fills.toLocaleString()} trades filled</span>
      <span>{view.lastRoundRun ? `${view.lastRoundRun.round} rating round${view.lastRoundRun.round === 1 ? "" : "s"} run` : "no rating round yet"}</span>
      <span>colony founded {ago(view.startedAt, Date.now())}</span>
    </div>
  );
}

// ---------- the drawer ----------

function Drawer({ b, view, onClose, onOpen }: { b: Bee; view: ColonyView; onClose: () => void; onOpen: (id: string) => void }) {
  const byId = (id: string) => view.lineage.find((x) => x.id === id);
  const line: Array<{ id: string; name: string }> = [];
  let cur = b.parent?.id ?? null;
  while (cur && line.length < 12) {
    const n = byId(cur);
    if (!n) break;
    line.push({ id: n.id, name: n.name });
    cur = n.parent;
  }
  const kids = view.lineage.filter((x) => x.parent === b.id || x.parent2 === b.id);
  const parentGenome = b.parent ? byId(b.parent.id)?.genome : undefined;
  const series: RadarSeries[] = [{ genome: b.genome, color: beeColor(b), label: b.rule?.title ?? b.name, fill: true }];
  if (b.role === "prince") series.push({ genome: view.keeper.blend, color: "#9085e9", label: "keeper's blend", dashed: true });
  else if (parentGenome) series.push({ genome: parentGenome, color: "#9085e9", label: `parent ${b.parent!.name}`, dashed: true });
  series.push({ genome: ORAKELIA, color: "#6f6d7a", label: "Orakelia", dashed: true });
  const lifeHours = b.diedAt ? (b.diedAt - b.bornAt) / 3_600_000 : b.ageHours;

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className={`drawer ${b.tier === "royal" ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose} aria-label="close">
          ×
        </button>
        <div className="drawer-head">
          <DnaGlyph genome={b.genome} id={b.id} royal={b.tier === "royal"} size={4} />
          <div>
            <div className="drawer-name">
              {b.rule?.title ?? b.name} <EggTag n={b.eggs} />
            </div>
            <div className="dim small">
              {b.tier === "royal" ? b.rule?.blurb : b.tier === "egg" ? `egg in the nursery · gen ${b.generation}` : `worker · gen ${b.generation} · ${b.origin === "keeper" ? "bred by the beekeeper" : b.origin}`}
            </div>
          </div>
        </div>
        <Radar series={series} size={17} />
        <div className="drawer-stats">
          <div>
            <span className="eyebrow">equity</span>
            <span className="num">{b.live ? money(b.live.equityUsd) : b.finalEquity !== null ? money(b.finalEquity) : "—"}</span>
          </div>
          <div>
            <span className="eyebrow">age</span>
            <span className="num">{age(lifeHours)}</span>
          </div>
          <div>
            <span className="eyebrow">last score</span>
            <span className={`num ${tone(b.lastScore)}`}>{b.lastScore !== null ? signed(b.lastScore) : "—"}</span>
          </div>
          <div>
            <span className="eyebrow">stars / X's</span>
            <span className="num">
              {b.stars} / {b.xs}
            </span>
          </div>
          <div>
            <span className="eyebrow">eggs</span>
            <span className="num">{b.eggs}</span>
          </div>
          <div>
            <span className="eyebrow">Jev spend</span>
            <span className="num">{b.live ? `$${b.live.totals.jevUsd.toFixed(4)}` : b.genome.useJev ? "—" : "none"}</span>
          </div>
        </div>
        {b.death && (
          <p className="bad small">
            Died {ago(b.diedAt!, view.ts)}: {b.death}
          </p>
        )}
        {b.tier !== "egg" && <BeeDetail bee={b} color={beeColor(b)} />}
        <div className="drawer-section">
          <span className="eyebrow">Gene strip</span>
          <GeneStrip genome={b.genome} parent={parentGenome ?? ORAKELIA} genes={view.genes} />
        </div>
        <div className="drawer-section">
          <span className="eyebrow">Lineage</span>
          <div className="lineage">
            <span className="me">{b.name}</span>
            {line.map((p) => (
              <span key={p.id}>
                <span className="dim"> ← </span>
                <button className="link" onClick={() => onOpen(p.id)}>
                  {p.name}
                </button>
              </span>
            ))}
            {b.parent2 && (
              <span className="dim">
                {" "}
                (×{" "}
                <button className="link" onClick={() => onOpen(b.parent2!.id)}>
                  {b.parent2.name}
                </button>
                )
              </span>
            )}
            {!line.length && !b.parent2 && <span className="dim"> {b.origin === "immigrant" ? "flew in from outside" : b.origin === "keeper" ? "bred by the beekeeper" : "founder"}</span>}
          </div>
          {kids.length > 0 && (
            <div className="small kids">
              {kids.map((k) => (
                <button key={k.id} className={`kid ${k.alive ? "" : "dead"}`} onClick={() => onOpen(k.id)}>
                  <DnaGlyph genome={k.genome} id={k.id} size={1.6} />
                  {k.name}
                </button>
              ))}
            </div>
          )}
          {b.mutations && <p className="small">Born with: {b.mutations}</p>}
        </div>
        <div className="drawer-section">
          <span className="eyebrow">DNA</span>
          <table className="dna">
            <thead>
              <tr>
                <th>gene</th>
                <th>this bee</th>
                <th className="dim">Orakelia</th>
              </tr>
            </thead>
            <tbody>
              {view.genes.map((g) => {
                const v = b.genome[g.name]!;
                const changed = v !== ORAKELIA[g.name];
                return (
                  <tr key={g.name} className={changed ? "changed" : ""} title={g.help}>
                    <td>{g.label}</td>
                    <td className="num">{fmtGene(g, v)}</td>
                    <td className="num dim">{fmtGene(g, ORAKELIA[g.name]!)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}

// ---------- the page ----------

export function ColonyApp() {
  const { view, curves, error } = useColony();
  const [open, setOpen] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const ranks = useMemo(() => new Map((view?.lastRound?.scores ?? []).map((s) => [s.bee, s])), [view]);
  if (!view) return <div className="colony loading">{error ? "Can't reach the colony engine. Retrying…" : "Opening the hive…"}</div>;

  const now = Date.now();
  const base = view.startEquityUsd;
  const workers = [...view.workers].sort((a, b) => (b.live?.pnlPct ?? 0) - (a.live?.pnlPct ?? 0));
  const all = [...view.royals, ...view.workers, ...view.nursery, ...view.graveyard];
  const opened = open ? all.find((b) => b.id === open) : undefined;
  const colonyPnl = view.workers.reduce((a, b) => a + (b.live?.pnlUsd ?? 0), 0);

  return (
    <div className="colony">
      <header className="c-top">
        <div>
          <div className="logo">
            The <span>Colony</span>
          </div>
          <div className="brand-sub">
            <span className="mode">{view.mode === "dry" ? "PAPER" : view.mode.toUpperCase()}</span>
            <span className="dim">royals trade the colony's best DNA · workers evolve · not financial advice</span>
          </div>
        </div>
        <div className="c-stats">
          <div>
            <span className="eyebrow">workers</span>
            <span className="num">{view.workers.length}</span>
          </div>
          <div>
            <span className="eyebrow">eggs</span>
            <span className="num">{view.stats.eggs}</span>
          </div>
          <div>
            <span className="eyebrow">died</span>
            <span className="num">{view.stats.died}</span>
          </div>
          <div>
            <span className="eyebrow">top gen</span>
            <span className="num">{view.stats.maxGeneration}</span>
          </div>
          <div>
            <span className="eyebrow">workers P&amp;L</span>
            <span className={`num ${tone(colonyPnl)}`}>{signed(colonyPnl)}</span>
          </div>
          <div>
            <span className="eyebrow">next rating</span>
            <span className="num">{until(view.nextRatingAt, now)}</span>
          </div>
          <div>
            <span className="eyebrow">Jev today</span>
            <span className={`num ${view.jev.capTripped ? "bad" : ""}`}>${view.jev.spentTodayUsd.toFixed(3)}</span>
          </div>
        </div>
      </header>
      {error ? <div className="banner">Lost the engine, showing the last read. Retrying…</div> : <Pulse view={view} />}

      <main className="c-main">
        <div className="c-left">
          <section>
            <div className="section-head">
              <span className="eyebrow">Royal court</span>
              <span className="dim small">${view.royals[0]?.live?.startEquityUsd ?? 333} paper each · full speed · DNA set by the beekeeper</span>
            </div>
            <div className="court">
              {view.royals.map((b) => (
                <RoyalCard key={b.id} b={b} curve={curves[b.id]} base={b.live?.startEquityUsd ?? base} onOpen={() => setOpen(b.id)} />
              ))}
            </div>
          </section>
          <section>
            <div className="section-head">
              <span className="eyebrow">Workers</span>
              <span className="dim small">
                ${view.workers[0]?.live?.startEquityUsd ?? 100} paper each · {view.rules.starsToBreed} ★ lays an egg · {view.rules.xsToDie} ✕ dies · rated every {view.rules.rateEveryHours}h · each blob is that bee's DNA
              </span>
            </div>
            <div className="comb">
              {workers.map((b) => (
                <WorkerCard key={b.id} b={b} curve={curves[b.id]} base={b.live?.startEquityUsd ?? base} rank={ranks.get(b.id)} rules={view.rules} onOpen={() => setOpen(b.id)} />
              ))}
            </div>
          </section>
        </div>
        <aside className="c-rail">
          <KeeperPanel view={view} onOpen={setOpen} />
          <Nursery view={view} onOpen={setOpen} />
          <RoundTable view={view} />
          <HiveLog view={view} />
          <Graveyard view={view} onOpen={setOpen} />
        </aside>
      </main>
      {opened && <Drawer b={opened} view={view} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
