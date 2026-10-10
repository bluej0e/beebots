// Entry point for the shared OKX market-data proxy (okx/proxy.ts). One per machine; point every engine's
// OKX_API_BASE at it. Env: PROXY_PORT (default 8090), PROXY_HOST (default 127.0.0.1), OKX_API_BASE (upstream,
// default https://eea.okx.com), OKX_CLI_TIMEOUT_MS (upstream timeout, default 15000).

import { createServer } from "node:http";
import { log } from "./log.js";
import { createMarketProxyHandler } from "./okx/proxy.js";
import { createOkxPublicRest } from "./okx/rest.js";

const env = process.env;
const port = Number(env.PROXY_PORT) || 8090;
const host = env.PROXY_HOST?.trim() || "127.0.0.1";
const upstream = env.OKX_API_BASE?.trim().replace(/\/+$/, "") || "https://eea.okx.com";
const rest = createOkxPublicRest({ apiBase: upstream, timeoutMs: Number(env.OKX_CLI_TIMEOUT_MS) || 15_000 });

const handler = createMarketProxyHandler(rest);
createServer((req, res) => void handler(req, res)).listen(port, host, () => log.info("okx market proxy listening", { host, port, upstream }));

// One line every 10 min instead of one per request: how much the sharing saved.
setInterval(() => log.info("okx market proxy stats", { ...rest.stats }), 10 * 60_000).unref();
