// Pictures of a bee's DNA: nine traits folded out of the 26 genes (radar chart and the blob avatar), and the full
// gene strip.
import type { Genome, GeneSpec } from "./types";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lin = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));
const logn = (v: number, lo: number, hi: number) => clamp01((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
const n = (g: Genome, k: string) => Number(g[k]);
const b = (g: Genome, k: string) => (g[k] === true ? 1 : 0);

/** Nine traits, each 0..1, built from the genes. The order is the order round the radar. */
export const TRAITS: Array<{ name: string; help: string; of: (g: Genome) => number }> = [
  { name: "Patience", help: "how long it commits to a pick (min hold)", of: (g) => logn(n(g, "minHoldHours"), 1, 72) },
  { name: "Size", help: "how big the first entry is", of: (g) => lin(n(g, "entryFrac"), 0.2, 1) },
  { name: "Pyramids", help: "how hard it adds to winners", of: (g) => clamp01((n(g, "addFrac") / 0.5) * (1 - 0.5 * lin(n(g, "addEveryAtr"), 0.5, 3))) },
  { name: "Stop room", help: "how far away its stop sits", of: (g) => lin(n(g, "trailAtr"), 1, 6) },
  { name: "Locks gains", help: "how much of a run its profit lock keeps", of: (g) => clamp01(((n(g, "lock1Keep") / 0.9 + n(g, "lock2Keep") / 0.95) / 2) * (1 - 0.4 * lin(n(g, "lock1At"), 1, 8))) },
  { name: "Activity", help: "trades a day, short cooldown, quick decisions", of: (g) => (lin(n(g, "maxTradesPerDay"), 1, 8) + 1 - lin(n(g, "cooldownMinutes"), 0, 240) + 1 - lin(n(g, "decideEveryMin"), 1, 15)) / 3 },
  { name: "Long view", help: "7-day momentum over 24h and 1h", of: (g) => clamp01(n(g, "w7d") / (n(g, "w7d") + n(g, "w24h") + n(g, "w1h") || 1)) },
  { name: "Breadth", help: "how many coins it looks at", of: (g) => ((g.universe === "any" ? 1 : g.universe === "midsmall" ? 0.55 : 0.3) + lin(n(g, "candidates"), 1, 8)) / 2 },
  { name: "Tricks", help: "shorts, flips, waits, needs green", of: (g) => (b(g, "shortLosers") + b(g, "flipShort") + b(g, "canWait") + b(g, "requireUp24h")) / 4 },
];

/** A stable hue per bee id. */
export function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function points(g: Genome, cx: number, cy: number, r: number, floor = 0.12): string {
  return TRAITS.map((t, i) => {
    const a = (Math.PI * 2 * i) / TRAITS.length - Math.PI / 2;
    const v = floor + (1 - floor) * t.of(g);
    return `${(cx + Math.cos(a) * r * v).toFixed(1)},${(cy + Math.sin(a) * r * v).toFixed(1)}`;
  }).join(" ");
}

export interface RadarSeries {
  genome: Genome;
  color: string;
  label: string;
  dashed?: boolean;
  fill?: boolean;
}

export function Radar({ series, size = 15 }: { series: RadarSeries[]; size?: number }) {
  const c = 100;
  const r = 70;
  const ring = (f: number) =>
    TRAITS.map((_, i) => {
      const a = (Math.PI * 2 * i) / TRAITS.length - Math.PI / 2;
      return `${(c + Math.cos(a) * r * f).toFixed(1)},${(c + Math.sin(a) * r * f).toFixed(1)}`;
    }).join(" ");
  return (
    <div className="radar">
      <svg viewBox="0 0 200 200" style={{ width: `${size}rem`, height: `${size}rem` }} role="img" aria-label="DNA radar">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={ring(f)} className="radar-ring" />
        ))}
        {TRAITS.map((t, i) => {
          const a = (Math.PI * 2 * i) / TRAITS.length - Math.PI / 2;
          const lx = c + Math.cos(a) * (r + 15);
          const ly = c + Math.sin(a) * (r + 15);
          return (
            <g key={t.name}>
              <line x1={c} y1={c} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r} className="radar-spoke" />
              <text x={lx} y={ly} textAnchor={Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end"} dominantBaseline="central" className="radar-label">
                <title>{t.help}</title>
                {t.name}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <polygon
            key={s.label}
            points={points(s.genome, c, c, r, 0)}
            fill={s.fill ? s.color : "none"}
            fillOpacity={s.fill ? 0.25 : 0}
            stroke={s.color}
            strokeWidth={s.fill ? 2 : 1.4}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="radar-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ borderColor: s.color, borderStyle: s.dashed ? "dashed" : "solid", background: s.fill ? s.color : "transparent" }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The avatar: the bee's DNA as a blob inside a hex cell. Same DNA, same shape. */
export function DnaGlyph({ genome, id, royal = false, size = 2.6 }: { genome: Genome; id: string; royal?: boolean; size?: number }) {
  const color = royal ? "#c98500" : `hsl(${hue(id)} 60% 58%)`;
  return (
    <svg className="hex" viewBox="0 0 100 100" style={{ width: `${size}rem`, height: `${size}rem` }} aria-hidden>
      <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={royal ? 0.9 : 0.55} strokeWidth={royal ? 5 : 3.5} />
      <polygon points={points(genome, 50, 50, 38)} fill={color} fillOpacity={0.55} stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {genome.useJev === false && <circle cx="50" cy="50" r="5" fill="#08070c" stroke={color} strokeWidth={2} />}
    </svg>
  );
}

const GROUP: Record<string, string> = {
  universe: "buy", w7d: "buy", w24h: "buy", w1h: "buy", wAttn: "buy", requireUp24h: "buy", shortLosers: "buy", candidates: "buy",
  entryFrac: "size", addFrac: "size", addEveryAtr: "size",
  minHoldHours: "time", switchStreak: "time", flipShort: "time", canWait: "time", maxFlatMinutes: "time",
  trailAtr: "exit", lock1At: "exit", lock1Keep: "exit", lock2At: "exit", lock2Keep: "exit",
  maxTradesPerDay: "pace", cooldownMinutes: "pace", spreadGateBps: "pace",
  useJev: "brain", decideEveryMin: "brain",
};
export const GROUP_LABEL: Record<string, string> = { buy: "what to buy", size: "how much", time: "how long", exit: "getting out", pace: "pace", brain: "brain" };

export function geneLevel(spec: GeneSpec, v: number | boolean | string): number {
  if (spec.kind === "bool") return v ? 1 : 0.08;
  if (spec.kind === "enum") return ((spec.values?.indexOf(String(v)) ?? 0) + 1) / (spec.values?.length ?? 1);
  if (spec.name === "minHoldHours") return logn(Number(v), spec.min!, spec.max!);
  return Math.max(0.06, lin(Number(v), spec.min!, spec.max!));
}

/** Every gene as a bar, grouped and coloured; a dot marks the genes that differ from the parent. */
export function GeneStrip({ genome, parent, genes }: { genome: Genome; parent?: Genome; genes: GeneSpec[] }) {
  return (
    <div className="strip">
      <div className="strip-bars">
        {genes.map((g) => {
          const v = genome[g.name]!;
          const changed = parent && parent[g.name] !== v;
          return (
            <div key={g.name} className={`strip-col g-${GROUP[g.name] ?? "brain"}`} title={`${g.label}: ${String(v)}${changed ? ` (parent ${String(parent![g.name])})` : ""}`}>
              <div className="strip-bar" style={{ height: `${Math.round(geneLevel(g, v) * 100)}%` }} />
              <span className={`strip-dot ${changed ? "on" : ""}`} />
            </div>
          );
        })}
      </div>
      <div className="strip-legend">
        {Object.entries(GROUP_LABEL).map(([k, l]) => (
          <span key={k} className={`g-${k}`}>
            <i />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
