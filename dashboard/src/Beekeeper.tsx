// The Beekeeper card: an outside coach (a Zap on Zapier: Jev picks the bee, Claude Opus 5.5 writes the rules) that
// looks at all three bees every round and may rewrite one bee's rules. The engine records every round (src/keeper.ts)
// and serves the last few in /snapshot.keeper; live changes also arrive on the feed as "keeper" events.
// Off: a short pitch and the "Connect the Beekeeper" form. On: the rounds, plus the owner's controls.
// Every write carries the owner password picked on Setup, exactly as joining the Hive does.
import { useState, type FormEvent } from "react";
import { BEE_META, type BeeName, type KeeperEntry, type KeeperState } from "./types";


export function ago(ts: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function until(ts: number, now = Date.now()): string {
  const m = Math.max(0, Math.ceil((ts - now) / 60_000));
  if (m < 1) return "any moment";
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${m % 60} min`;
}

const VERB: Record<KeeperEntry["action"], string> = {
  calling: "On his rounds",
  rewrote: "Rewrote",
  quiet: "Left them alone",
  skipped: "Hands off",
  refused: "Bounced",
  failed: "No answer",
  rolled_back: "Rolled back",
};

/** The bee a round was about, or the Beekeeper himself for a round that touched nobody. */
function Who({ bee, big }: { bee: BeeName | null; big?: boolean }) {
  const meta = bee ? BEE_META[bee] : null;
  return (
    <img
      className={`keeper-who ${big ? "big" : ""} ${meta ? "" : "nobody"}`}
      src={meta ? meta.img : "/beekeeper.jpg"}
      alt={meta ? meta.title : "nobody"}
      title={meta ? meta.title : "No bee was rewritten"}
      style={meta ? { ["--bee" as string]: meta.color } : undefined}
    />
  );
}

function meta(e: KeeperEntry): string {
  const who = e.bee ? BEE_META[e.bee].short : null;
  const head = e.action === "rewrote" || e.action === "rolled_back" || e.action === "refused" ? `${VERB[e.action]}${who ? ` ${who}` : ""}` : VERB[e.action];
  return e.idea ? `${head} · ${e.idea}` : head;
}

/**
 * The entries whose rewrite is the one its bee trades on right now, so "Undo" belongs next to them. A replay of the
 * list, oldest first: a rewrite goes on top of its bee's pile, a rollback takes the top one off.
 */
export function undoable(entries: KeeperEntry[]): Set<number> {
  const piles: Partial<Record<BeeName, number[]>> = {};
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    if (!e.bee) continue;
    const pile = (piles[e.bee] ??= []);
    if (e.action === "rewrote") pile.push(e.id);
    else if (e.action === "rolled_back") pile.pop();
  }
  const live = new Set<number>();
  for (const pile of Object.values(piles)) {
    const top = pile?.[pile.length - 1];
    if (top !== undefined) live.add(top);
  }
  return live;
}

type OwnerAction = { kind: "round" } | { kind: "pause"; paused: boolean } | { kind: "undo"; bee: BeeName };
const ACTION: Record<OwnerAction["kind"], { path: string; go: string; busy: string }> = {
  round: { path: "/keeper/round", go: "Call him now", busy: "Calling…" },
  pause: { path: "/keeper/pause", go: "Confirm", busy: "Saving…" },
  undo: { path: "/keeper/rollback", go: "Undo", busy: "Undoing…" },
};

/** One owner write. The password travels URI-encoded in a header, the same way the Hive's join and leave send it. */
async function ownerPost(path: string, password: string, body: unknown): Promise<KeeperState> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-owner-password": encodeURIComponent(password) }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { keeper?: KeeperState; error?: string };
  if (!r.ok || !j.keeper) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.keeper;
}

export function Beekeeper({ keeper }: { keeper: KeeperState | undefined }) {
  // What the engine answered to this page's own last write, shown until the next /snapshot poll catches up.
  const [mine, setMine] = useState<{ at: number; state: KeeperState } | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<OwnerAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ahead = mine && Date.now() - mine.at < 6000 && (!keeper || mine.state.on !== keeper.on || !!mine.state.paused !== !!keeper.paused || (mine.state.entries[0]?.id ?? 0) > (keeper.entries[0]?.id ?? 0));
  const k = ahead ? mine.state : keeper;
  // An engine from before the Beekeeper has no such block: no card.
  if (!k) return null;

  const entries = k.entries;
  const [latest, ...rest] = entries;
  const fresh = latest && latest.action === "rewrote" && Date.now() - latest.at < 15_000;
  const canUndo = undoable(entries);
  const passwordOk = password.length >= 8;
  const paused = !!k.paused;

  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      setMine({ at: Date.now(), state: await ownerPost(path, password, body) });
      setPending(null);
      setHookUrl("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const connect = (e: FormEvent) => {
    e.preventDefault();
    // This page's own address is where the Zap will find the engine: the owner never has to type it.
    if (passwordOk && hookUrl.trim() && !busy) void run("/keeper/connect", { hookUrl: hookUrl.trim(), publicUrl: location.origin });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (pending && passwordOk && !busy) void run(ACTION[pending.kind].path, pending.kind === "undo" ? { bee: pending.bee } : pending.kind === "pause" ? { paused: pending.paused } : {});
  };
  const ask = (a: OwnerAction) => {
    setError("");
    setPending(a);
  };
  const undoButton = (e: KeeperEntry) =>
    e.bee && canUndo.has(e.id) ? (
      <button type="button" className="keeper-undo" title={`Put ${BEE_META[e.bee].short} back on the rules from before this rewrite (owner password)`} onClick={() => ask({ kind: "undo", bee: e.bee! })}>
        Undo
      </button>
    ) : null;

  return (
    <section className={`rail-card keeper ${fresh ? "keeper-fresh" : ""}`}>
      <div className="keeper-head">
        <img className="keeper-face" src="/beekeeper.jpg" alt="" />
        <div className="keeper-title">
          <span className="eyebrow keeper-eyebrow">The Beekeeper</span>
          <span className="keeper-sub dim">
            {k.on ? `checks all three bees every ${k.everyHours} h · ${k.rewrites} ${k.rewrites === 1 ? "rewrite" : "rewrites"} so far` : "rewrites a bee's rules when they stop working"}
          </span>
        </div>
        {k.on && k.nextRoundAt !== null && (
          <div className={`keeper-next num ${paused ? "keeper-paused" : ""}`} title={paused ? "Switched off: the timer keeps counting, but no round starts until he is switched back on" : undefined}>
            <span className="dim">{paused ? "off · next round" : "next round"}</span>
            <b>{latest?.action === "calling" ? "now" : until(k.nextRoundAt)}</b>
          </div>
        )}
      </div>

      {!k.on && (
        <form className="keeper-connect" onSubmit={connect}>
          <p className="keeper-pitch">
            An outside coach for your bees. Every few hours he looks at all three. If one keeps losing because its rules are wrong, he writes it new ones. He runs on this
            machine, and he can only change a bee's rules and coins. Start him (beekeeper/local.ts) and paste his hook URL below.
          </p>
          <label className="keeper-label" htmlFor="keeper-hook">
            Connect the Beekeeper
          </label>
          <input id="keeper-hook" className="keeper-input" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="Beekeeper hook URL, e.g. http://127.0.0.1:8787/hook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
          <div className="keeper-form-row">
            <input className="keeper-input" type="password" autoComplete="current-password" placeholder="Owner password" aria-label="Owner password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="keeper-go" disabled={busy || !passwordOk || !hookUrl.trim()}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
          {error && !pending && <p className="keeper-error bad">{error}</p>}
        </form>
      )}

      {latest ? (
        <div className={`keeper-latest keeper-${latest.action}`} style={latest.bee ? { ["--bee" as string]: BEE_META[latest.bee].color } : undefined}>
          <Who bee={latest.bee} big />
          <div className="keeper-latest-body">
            <div className="keeper-quip">“{latest.quip}”</div>
            <div className="keeper-meta">
              <span className="keeper-verb">{meta(latest)}</span>
              <span className="dim num keeper-when">
                {ago(latest.at)}
                {undoButton(latest)}
              </span>
            </div>
            {latest.action === "rewrote" && latest.reason && <div className="keeper-reason dim">{latest.reason}</div>}
          </div>
        </div>
      ) : (
        k.on && <div className="keeper-empty dim">No rounds yet. He's putting his gloves on.</div>
      )}

      {rest.length > 0 && (
        <ol className="keeper-log">
          {rest.map((e) => (
            <li key={e.id} className={`keeper-row keeper-${e.action} ${canUndo.has(e.id) ? "keeper-live" : ""}`} title={`${meta(e)}${e.reason ? `: ${e.reason}` : ""}`}>
              <Who bee={e.bee} />
              <span className="keeper-row-quip">{e.quip}</span>
              <span className="dim num keeper-row-ago">
                {ago(e.at)}
                {undoButton(e)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {k.on && !pending && (
        <div className="keeper-owner">
          <span className="dim">Owner:</span>
          <button type="button" className="keeper-link" onClick={() => ask({ kind: "round" })}>
            Call him now
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={!paused}
            className={`keeper-switch ${paused ? "" : "on"}`}
            title={paused ? "Off: no rounds on the timer. Click to switch him on (owner password)" : "On: rounds run on the timer. Click to switch him off (owner password)"}
            onClick={() => ask({ kind: "pause", paused: !paused })}
          >
            <span className="keeper-switch-track" aria-hidden="true">
              <span className="keeper-switch-knob" />
            </span>
            {paused ? "Off" : "On"}
          </button>
        </div>
      )}
      {pending && (
        <form className="keeper-confirm" onSubmit={confirm}>
          <span className="keeper-confirm-what">
            {pending.kind === "undo"
              ? `Undo the Beekeeper's latest rewrite of ${BEE_META[pending.bee].short}?`
              : pending.kind === "round"
                ? "Start a round now? The next scheduled round is counted from this one."
                : pending.paused
                  ? "Switch the Beekeeper off? No rounds run until you switch him back on. Rewrites stay."
                  : "Switch the Beekeeper back on?"}
          </span>
          <div className="keeper-form-row">
            <input className="keeper-input" type="password" autoComplete="current-password" placeholder="Owner password" aria-label="Owner password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <button type="submit" className={`keeper-go ${pending.kind === "undo" || (pending.kind === "pause" && pending.paused) ? "danger" : ""}`} disabled={busy || !passwordOk}>
              {busy ? ACTION[pending.kind].busy : ACTION[pending.kind].go}
            </button>
            <button type="button" className="keeper-link" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
          {error && <p className="keeper-error bad">{error}</p>}
        </form>
      )}

    </section>
  );
}
