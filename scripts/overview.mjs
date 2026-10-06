// The A/B/C overview for beebots.covewrk.com: one page with every bee from every lab, linking to each lab's own
// dashboard. Serves scripts/overview.html and proxies a few read-only GETs to each lab engine
// (reached through the SSH forward in start-all.mjs). No dependencies.
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.OVERVIEW_PORT ?? 4170);
const PAGE = join(dirname(fileURLToPath(import.meta.url)), "overview.html");
/** Lab number -> engine port (lab1 = 8080, lab2 = 8081, lab3 = 8082). */
const ENGINE = { 1: 8080, 2: 8081, 3: 8082 };
const ROUTE = /^\/lab\/([123])\/(snapshot|profile|bee-image\/bee[123])$/;

createServer((req, res) => {
  if (req.method !== "GET") return void res.writeHead(405).end();
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return void res.end(readFileSync(PAGE));
  }
  const m = ROUTE.exec(url.pathname);
  if (!m) return void res.writeHead(404).end();
  const up = request({ host: "127.0.0.1", port: ENGINE[m[1]], path: `/${m[2]}`, method: "GET", timeout: 8000 }, (r) => {
    res.writeHead(r.statusCode ?? 502, { "content-type": r.headers["content-type"] ?? "application/octet-stream", "cache-control": "no-store" });
    r.pipe(res);
  });
  up.on("timeout", () => up.destroy());
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "lab unreachable" }));
  });
  up.end();
}).listen(PORT, "127.0.0.1", () => console.log(`overview on http://127.0.0.1:${PORT}`));
