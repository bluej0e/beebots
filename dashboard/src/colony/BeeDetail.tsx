// The inside of a bee, for the drawer: Jev's last call with every option on the menu, the numbers Jev saw, what it
// picked over the last day, its recent decisions and its trades. GET /colony/bee?id=, refreshed while open.
import { useEffect, useState } from "react";
import type { Bee } from "./types";

interface Action {
  kind: string;
  instId?: string;
  side?: string;
  notionalUsd?: number;
  reason?: string;
  fraction?: number;
}
interface Detail {
  id: string;
  rulesOnly: boolean;
  lastCall: {
    ts: number;
    choice: string | null;
    options: Array<{ label: string; p: number }>;
    menu: string[];
    confidence: number | null;
    conviction: string | null;
    latencyMs: number | null;
    tokens: number | null;
    costUsd: number;
    status: string | null;
    vetoedBy: string | null;
    action: Action;
    saw: { utc?: string; me?: Record<string, unknown>; coins?: { cols: string[]; rows: Record<string, Array<number | string | null>> }; [k: string]: unknown };
  } | null;
  recent: Array<{ ts: number; choice: string | null; top: Array<{ label: string; p: number }>; confidence: number | null; conviction: string | null; action: Action; vetoedBy: string | null; forcedBy: string | null; error: string | null; status: string | null }>;
  tally: Array<{ label: string; n: number }>;
  jev: { calls: number; costUsd: number; avgLatencyMs: number | null; vetoes: number };
  trades: Array<{ ts: number; coin: string; side: string; px: number; notionalUsd: number; feeUsd: number; realisedUsd: number; purpose: string | null }>;
}

function useDetail(id: string) {
  const [d, setD] = useState<Detail | null>(null);
  useEffect(() => {
    let alive = true;
    setD(null);
    const pull = async () => {
      try {
        const r = await fetch(`/colony/bee?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (r.ok && alive) setD((await r.json()) as Detail);
      } catch {
        /* next pull */
      }
    };
    void pull();
    const t = setInterval(pull, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  return d;
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const px = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x >= 1000 ? x.toLocaleString("en-US", { maximumFractionDigits: 1 }) : x >= 1 ? x.toFixed(3) : x.toPrecision(4));
const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toFixed(2)}`;

function describe(a: Action): string {
  switch (a.kind) {
    case "none":
      return "hold";
    case "close":
      return `close (${a.reason ?? ""})`;
    case "trim":
      return `trim ${Math.round((a.fraction ?? 0) * 100)}%`;
    case "add":
      return `add $${Math.round(a.notionalUsd ?? 0)}`;
    case "open":
      return `${a.side} ${a.instId?.split("-")[0]} $${Math.round(a.notionalUsd ?? 0)}`;
    case "switch":
      return `switch to ${a.side} ${a.instId?.split("-")[0]} $${Math.round(a.notionalUsd ?? 0)}`;
    default:
      return a.kind;
  }
}

function Options({ options, choice, color }: { options: Array<{ label: string; p: number }>; choice: string | null; color: string }) {
  return (
    <div className="opts">
      {options.map((o) => (
        <div key={o.label} className={`opt ${o.label === choice ? "chosen" : ""}`}>
          <span className="opt-label">{o.label}</span>
          <span className="opt-track">
            <span className="opt-fill" style={{ width: `${Math.max(1.5, o.p * 100)}%`, background: o.label === choice ? color : undefined }} />
          </span>
          <span className="num opt-p">{(o.p * 100).toFixed(o.p < 0.1 ? 1 : 0)}%</span>
        </div>
      ))}
    </div>
  );
}

function Saw({ saw }: { saw: NonNullable<Detail["lastCall"]>["saw"] }) {
  const coins = saw.coins;
  return (
    <details className="saw">
      <summary>What Jev saw ({coins ? Object.keys(coins.rows).length : 0} coins)</summary>
      {saw.me && (
        <div className="saw-me small">
          {Object.entries(saw.me).map(([k, v]) => (
            <span key={k}>
              <span className="dim">{k}</span> {String(v)}
            </span>
          ))}
        </div>
      )}
      {coins && coins.cols.length > 0 && (
        <div className="saw-scroll">
          <table className="saw-table">
            <thead>
              <tr>
                <th>coin</th>
                {coins.cols.map((c) => (
                  <th key={c}>{c.replace(/_/g, " ")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(coins.rows).map(([coin, row]) => (
                <tr key={coin}>
                  <td>{coin}</td>
                  {row.map((v, i) => (
                    <td key={i} className="num">
                      {v === null ? "–" : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export function BeeDetail({ bee, color }: { bee: Bee; color: string }) {
  const d = useDetail(bee.id);
  const p = bee.live?.position;
  return (
    <>
      {p && (
        <div className="drawer-section">
          <span className="eyebrow">Position</span>
          <div className="pos-detail">
            <span className={`side ${p.side}`}>{p.side === "long" ? "▲ LONG" : "▼ SHORT"}</span> <b>{p.coin}</b> {p.sizeUsd !== null && <span className="dim">${Math.round(p.sizeUsd)}</span>}
            <span className={`num ${p.uplUsd >= 0 ? "good" : "bad"}`}> {usd(p.uplUsd)}</span>
            <div className="num dim small">
              entry {px(p.entryPx)} → mark {px(p.markPx)} · stop {px(p.stopPx)} · held {p.minutesHeld >= 120 ? `${(p.minutesHeld / 60).toFixed(1)}h` : `${p.minutesHeld}m`}
            </div>
          </div>
        </div>
      )}

      <div className="drawer-section">
        <div className="sec-head">
          <span className="eyebrow">Jev's last call</span>
          {d?.lastCall && (
            <span className="dim small num">
              {clock(d.lastCall.ts)} · {d.lastCall.latencyMs} ms · {d.lastCall.tokens} tokens · ${d.lastCall.costUsd.toFixed(5)}
            </span>
          )}
        </div>
        {!d ? (
          <p className="dim small">loading…</p>
        ) : d.rulesOnly ? (
          <p className="dim small">This bee never asks Jev: it always takes the top move its rules rank first. Its decisions are below.</p>
        ) : !d.lastCall ? (
          <p className="dim small">Jev hasn't been asked yet. While a bee is inside its minimum hold, holding is its only legal move, so the rules make that call without spending a token.</p>
        ) : (
          <>
            <Options options={d.lastCall.options} choice={d.lastCall.choice} color={color} />
            <div className="call-meta small">
              {d.lastCall.confidence !== null && (
                <span>
                  confidence <b className="num">{Math.round(d.lastCall.confidence * 100)}%</b>
                </span>
              )}
              {d.lastCall.conviction && (
                <span>
                  conviction <b>{d.lastCall.conviction}</b>
                </span>
              )}
              <span>
                → <b>{describe(d.lastCall.action)}</b>
              </span>
            </div>
            {d.lastCall.vetoedBy && <p className="small veto">Code overruled it: {d.lastCall.vetoedBy}</p>}
            {d.lastCall.status && <p className="dim small">{d.lastCall.status}</p>}
            <Saw saw={d.lastCall.saw} />
          </>
        )}
        {d && d.jev.calls > 0 && (
          <div className="jev-stats small dim">
            {d.jev.calls.toLocaleString()} Jev calls · ${d.jev.costUsd.toFixed(3)} total · avg {d.jev.avgLatencyMs} ms · {d.jev.vetoes} overruled by code
          </div>
        )}
      </div>

      {d && d.tally.length > 0 && (
        <div className="drawer-section">
          <span className="eyebrow">What it picked, last 24h</span>
          <div className="tally">
            {d.tally.slice(0, 10).map((t) => (
              <div key={t.label} className="tally-row">
                <span className="opt-label">{t.label}</span>
                <span className="opt-track">
                  <span className="opt-fill" style={{ width: `${(t.n / d.tally[0]!.n) * 100}%` }} />
                </span>
                <span className="num opt-p">{t.n.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {d && d.recent.length > 0 && (
        <div className="drawer-section">
          <span className="eyebrow">Decisions</span>
          <ol className="feed">
            {d.recent.map((r, i) => (
              <li key={i} className={r.forcedBy ? "forced" : r.vetoedBy ? "vetoed" : r.action.kind !== "none" ? "acted" : ""}>
                <span className="num dim">{clock(r.ts)}</span>
                <span className="feed-main">
                  <b>{r.choice ?? (r.forcedBy ? r.forcedBy.toUpperCase() : r.error ? "NO ANSWER" : "—")}</b>
                  {r.top.length > 1 && (
                    <span className="dim">
                      {" "}
                      {r.top.map((t) => `${t.label} ${Math.round(t.p * 100)}%`).join(" · ")}
                    </span>
                  )}
                  {r.action.kind !== "none" && <span className="feed-act"> → {describe(r.action)}</span>}
                  {r.vetoedBy && <span className="veto"> · overruled: {r.vetoedBy}</span>}
                  {r.forcedBy && <span className="forced-by"> · forced: {r.forcedBy}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {d && d.trades.length > 0 && (
        <div className="drawer-section">
          <span className="eyebrow">Trades</span>
          <table className="trades">
            <tbody>
              {d.trades.map((t, i) => (
                <tr key={i}>
                  <td className="num dim">{clock(t.ts)}</td>
                  <td className={t.side === "buy" ? "good" : "bad"}>{t.side}</td>
                  <td>
                    <b>{t.coin}</b> <span className="dim">{t.purpose}</span>
                  </td>
                  <td className="num">${Math.round(t.notionalUsd)}</td>
                  <td className="num dim">@ {px(t.px)}</td>
                  <td className={`num ${t.realisedUsd > 0 ? "good" : t.realisedUsd < 0 ? "bad" : "dim"}`}>{t.realisedUsd ? usd(t.realisedUsd) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
