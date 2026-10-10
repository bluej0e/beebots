// A shared, cached front for OKX's public market endpoints, for several engines on one machine.
//
// OKX rate-limits public calls per IP. Each engine's own client (okx/rest.ts) keeps its buckets at 75% of OKX's
// limits, so three engines on one VPS ask for ~225% and spend the day backing off. Pointing every engine's
// OKX_API_BASE here gives them one set of buckets, one cache and one in-flight table: identical candle requests
// from the three labs go to OKX once, and the total stays under the per-IP limit.
//
// It answers in OKX's own envelope ({code, msg, data}), so the engines' kit client needs no change. Only the
// public GET paths in OKX_PUBLIC_LIMITS are forwarded; anything else is a 404.

import type { IncomingMessage, ServerResponse } from "node:http";
import { NetworkError, OkxMcpError, RateLimitError } from "./kit/errors.js";
import { OKX_PUBLIC_LIMITS, type OkxPublicRest } from "./rest.js";

/**
 * How long one engine's answer is reused for the others. Engines refresh every DATA_REFRESH_MS (60 s on the VPS)
 * at unrelated phases, so the candle TTL has to be long enough to bridge them; 45 s keeps a 15m/1H bar at most
 * ~45 s behind, while every tick's prices still come from tickers (under a second).
 */
export const PROXY_TTL_MS: Record<string, number> = {
  "/api/v5/market/candles": 45_000,
  "/api/v5/market/tickers": 900,
  "/api/v5/public/instruments": 60_000,
  "/api/v5/public/open-interest": 15_000,
  "/api/v5/public/funding-rate": 30_000,
  "/api/v5/public/funding-rate-history": 300_000,
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
};

export function createMarketProxyHandler(rest: OkxPublicRest, ttlMs: Record<string, number> = PROXY_TTL_MS) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://proxy");
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, stats: rest.stats });
    if (req.method !== "GET" || !(url.pathname in OKX_PUBLIC_LIMITS)) return send(res, 404, { code: "404", msg: "not a proxied OKX public path" });

    const query = Object.fromEntries(url.searchParams);
    const demo = req.headers["x-simulated-trading"] === "1";
    try {
      const data = await rest.get<unknown>(url.pathname, query, { ttlMs: ttlMs[url.pathname] ?? 0, demo });
      send(res, 200, { code: "0", msg: "", data });
    } catch (err) {
      // Hand OKX's own codes back, so the engine's client throws the same error class it would have thrown.
      if (err instanceof RateLimitError) send(res, 429, { code: "50011", msg: err.message });
      else if (err instanceof NetworkError) send(res, 502, { code: "50001", msg: err.message });
      else if (err instanceof OkxMcpError && err.code) send(res, 200, { code: err.code, msg: err.message });
      else send(res, 500, { code: "50000", msg: err instanceof Error ? err.message : String(err) });
    }
  };
}
