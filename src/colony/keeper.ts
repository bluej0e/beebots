// The beekeeper's notebook: what is working in the hive. Every rated (bee, round) pair is a sample: the bee's DNA
// and the score it got that round. Dead bees count too: what killed them is knowledge. For each gene the keeper
// asks "do the bees with more of this score better?" and writes down the value the winners lean towards. Put
// together, those values are his blend: the DNA he would build a bee from. The Prince (his apprentice) trades it.
import { GENE_NAMES, GENES, normalize, type GeneName, type GeneSpec, type Genome } from "./genome.js";

export interface Sample {
  genome: Genome;
  score: number;
}

export interface Insight {
  gene: GeneName;
  label: string;
  /** How strongly the gene goes with score, -1..1 (sign: more of it scores better or worse). For a choice gene, the
   * gap between the best and worst value's average score, scaled to the same range. */
  effect: number;
  /** One line for the dashboard: "shorter holds are winning: top half 7.2 h, bottom half 31 h". */
  verdict: string;
  /** What the winners lean towards. */
  value: Genome[GeneName];
  samples: number;
}

export interface Lessons {
  samples: number;
  bees: number;
  insights: Insight[];
  /** The keeper's DNA: every gene with a clear lesson set to the winners' value, the rest from `base`. */
  blend: Genome;
}

/** Below this many samples the keeper has nothing to say about a gene. */
export const MIN_SAMPLES = 12;
/** An effect smaller than this is noise to him. */
export const MIN_EFFECT = 0.15;

const norm = (s: GeneSpec, v: number) => {
  if (s.kind !== "num" && s.kind !== "int") return 0;
  if (s.kind === "num" && s.log) return (Math.log(v) - Math.log(s.min)) / (Math.log(s.max) - Math.log(s.min));
  return (v - s.min) / (s.max - s.min || 1);
};

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

const fmt = (s: GeneSpec, v: Genome[GeneName]) => (typeof v === "boolean" ? (v ? "yes" : "no") : s.kind === "num" ? Number((v as number).toFixed(s.dp)) : v);

export function learn(samples: Sample[], base: Genome): Lessons {
  const insights: Insight[] = [];
  const blend = { ...base } as Record<GeneName, Genome[GeneName]>;
  const bees = new Set(samples.map((s) => JSON.stringify(s.genome))).size;
  if (samples.length >= MIN_SAMPLES) {
    const scores = samples.map((s) => s.score);
    const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)]!;
    const top = samples.filter((s) => s.score > median);
    const bottom = samples.filter((s) => s.score <= median);
    for (const g of GENE_NAMES) {
      const spec: GeneSpec = GENES[g];
      const values = samples.map((s) => s.genome[g]);
      if (new Set(values.map(String)).size < 2) continue; // everyone has the same value: nothing to learn
      if (spec.kind === "num" || spec.kind === "int") {
        const effect = pearson(
          samples.map((s) => norm(spec, s.genome[g] as number)),
          scores,
        );
        const avg = (xs: Sample[]) => xs.reduce((a, s) => a + (s.genome[g] as number), 0) / (xs.length || 1);
        // The winners' value: the score-weighted mean of the top half (better scores pull harder).
        const lo = Math.min(...top.map((s) => s.score));
        const w = top.map((s) => s.score - lo + 1e-6);
        const sum = w.reduce((a, b) => a + b, 0);
        let v = top.reduce((a, s, i) => a + (s.genome[g] as number) * w[i]!, 0) / (sum || 1);
        v = spec.kind === "int" ? Math.round(v) : Number(v.toFixed(spec.dp));
        v = Math.max(spec.min, Math.min(spec.max, v));
        const dir = effect > 0 ? "higher" : "lower";
        insights.push({ gene: g, label: spec.label, effect, value: v, samples: samples.length, verdict: `${dir} ${spec.label} is winning: top half ${fmt(spec, avg(top) as never)}, bottom half ${fmt(spec, avg(bottom) as never)}` });
        if (Math.abs(effect) >= MIN_EFFECT) blend[g] = v;
      } else {
        const groups = new Map<string, number[]>();
        for (const s of samples) {
          const k = String(s.genome[g]);
          (groups.get(k) ?? groups.set(k, []).get(k)!).push(s.score);
        }
        const means = [...groups].filter(([, xs]) => xs.length >= 3).map(([k, xs]) => ({ k, mean: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length }));
        if (means.length < 2) continue;
        means.sort((a, b) => b.mean - a.mean);
        const best = means[0]!;
        const worst = means[means.length - 1]!;
        const sd = Math.sqrt(scores.reduce((a, x) => a + (x - scores.reduce((p, q) => p + q, 0) / scores.length) ** 2, 0) / scores.length) || 1;
        const effect = Math.max(-1, Math.min(1, (best.mean - worst.mean) / (2 * sd)));
        const value = (spec.kind === "bool" ? best.k === "true" : best.k) as Genome[GeneName];
        const show = (k: string) => (spec.kind === "bool" ? (k === "true" ? "yes" : "no") : k);
        insights.push({ gene: g, label: spec.label, effect, value, samples: samples.length, verdict: `${spec.label} = ${show(best.k)} is winning: avg ${best.mean.toFixed(2)} vs ${show(worst.k)} ${worst.mean.toFixed(2)}` });
        if (effect >= MIN_EFFECT) blend[g] = value;
      }
    }
  }
  insights.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return { samples: samples.length, bees, insights, blend: normalize(blend as unknown as Genome) };
}
