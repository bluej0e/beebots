import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OkxApiError, RateLimitError } from "../src/okx/kit/errors.js";
import { createMarketProxyHandler } from "../src/okx/proxy.js";
import { createPublicApi } from "../src/okx/public.js";
import { createOkxPublicRest } from "../src/okx/rest.js";

const CANDLES = [["1790340300000", "101", "103", "100", "102", "5", "0.05", "5100", "1"]];

/** Upstream OKX stand-in: records each URL and demo header, answers with `answer()`. */
function upstream(answer: () => Response) {
  const calls: Array<{ url: string; demo: string | null }> = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), demo: new Headers(init?.headers).get("x-simulated-trading") });
    return answer();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const ok = (data: unknown) => () => new Response(JSON.stringify({ code: "0", msg: "", data }));

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function startProxy(fetch: typeof globalThis.fetch): Promise<string> {
  const rest = createOkxPublicRest({ apiBase: "https://eea.okx.com", timeoutMs: 1000, fetch, maxRateLimitRetries: 0 });
  const handler = createMarketProxyHandler(rest);
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
/** An engine's own client, as index.ts builds it, but aimed at the proxy. */
const engine = (base: string, demo = false) => createPublicApi(base, demo, createOkxPublicRest({ apiBase: base, timeoutMs: 2000, maxRateLimitRetries: 0 }));

describe("shared OKX market proxy", () => {
  it("serves three engines' identical candle requests from one upstream call", async () => {
    const up = upstream(ok(CANDLES));
    const base = await startProxy(up.fetch);
    const [a, b, c] = [engine(base), engine(base), engine(base)];
    const first = await a.candles("BTC-USD_UM_XPERP-310404", "1H", 200);
    const rest = await Promise.all([b.candles("BTC-USD_UM_XPERP-310404", "1H", 200), c.candles("BTC-USD_UM_XPERP-310404", "1H", 200)]);
    expect(first).toHaveLength(1);
    expect(first[0]!.c).toBe(102);
    expect(rest).toEqual([first, first]);
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0]!.url).toBe("https://eea.okx.com/api/v5/market/candles?instId=BTC-USD_UM_XPERP-310404&bar=1H&limit=200");
  });

  it("keeps demo and live apart and forwards the demo header", async () => {
    const up = upstream(ok(CANDLES));
    const base = await startProxy(up.fetch);
    await engine(base).candles("X", "15m", 100);
    await engine(base, true).candles("X", "15m", 100);
    expect(up.calls.map((c) => c.demo)).toEqual([null, "1"]);
  });

  it("hands OKX's rate-limit and API errors back as the same error classes", async () => {
    const limited = upstream(() => new Response(JSON.stringify({ code: "50011", msg: "Too Many Requests" }), { status: 429 }));
    let base = await startProxy(limited.fetch);
    await expect(engine(base).candles("X", "15m", 100)).rejects.toBeInstanceOf(RateLimitError);
    await new Promise<void>((r) => server!.close(() => r()));

    const bad = upstream(() => new Response(JSON.stringify({ code: "51001", msg: "Instrument ID does not exist" })));
    base = await startProxy(bad.fetch);
    const err = await engine(base).candles("NOPE", "15m", 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OkxApiError);
    expect((err as OkxApiError).code).toBe("51001");
  });

  it("refuses paths that are not OKX public market data", async () => {
    const up = upstream(ok([]));
    const base = await startProxy(up.fetch);
    const res = await fetch(`${base}/api/v5/account/balance`);
    expect(res.status).toBe(404);
    expect(up.calls).toHaveLength(0);
  });
});
