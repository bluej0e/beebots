import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const engine = process.env.ENGINE_URL ?? "http://127.0.0.1:8080";
const proxy = Object.fromEntries(["/events", "/snapshot", "/history", "/equity", "/visit", "/health", "/profile", "/bee-image", "/setup", "/hive", "/keeper", "/colony/"].map((p) => [p, { target: engine, changeOrigin: false }]));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // The shared site: the built dashboard behind a Cloudflare tunnel (beebots.covewrk.com, or a quick *.trycloudflare.com one). /lab stays private.
  preview: { port: 4173, host: "127.0.0.1", proxy, allowedHosts: ["beebots.covewrk.com", ".trycloudflare.com"] },
  build: { outDir: "dist", sourcemap: false, target: "es2022", rollupOptions: { input: { main: resolve(__dirname, "index.html"), colony: resolve(__dirname, "colony.html") } } },
});
