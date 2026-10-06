# Running beebots on a small VPS

How this fork runs its A/B/C labs around the clock on an Oracle Cloud Always Free VM (`VM.Standard.E2.1.Micro`:
1 GB RAM, x86, Ubuntu 24.04). Three engines, the dashboards and the Cloudflare tunnel all fit on it.

## Layout on the server

| What | Where |
|---|---|
| Compiled engine (`pnpm build`), `package.json`, prod `node_modules` | `/opt/beebots` (no `.env` needed) |
| One folder per lab: `settings.json` (no OpenAI key), `bees-dry.sqlite`, `bee-images/`, `engine.env` | `/opt/beebots/data/lab1..3` |
| Engines, ports 8080-8082, 127.0.0.1 only | systemd `beebots@lab1..3` (unit below) |
| Overview (:4170) and lab dashboards (:4173-4175), 127.0.0.1 only | Caddy, [`Caddyfile`](Caddyfile) at `/etc/caddy/Caddyfile` |
| Public hostnames | cloudflared service, [`cloudflared.yml`](cloudflared.yml) at `/etc/cloudflared/config.yml` |

Only SSH is open to the internet. Everything public goes out through the tunnel. Run **one** connector for the tunnel:
a second one (an old PC launcher, say) splits visitors between the two.

Each lab's `engine.env`:

```
MODE=dry
TICK_MS=30000
SETTINGS_PATH=./data/lab1/settings.json
DB_PATH=./data/lab1/bees-{mode}.sqlite
ENGINE_PORT=8080
PUBLIC_URL=http://127.0.0.1:8080
```

`/etc/systemd/system/beebots@.service`:

```ini
[Unit]
Description=beebots engine %i
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/opt/beebots
EnvironmentFile=/opt/beebots/data/%i/engine.env
ExecStart=/usr/bin/node --max-old-space-size=192 dist/index.js
Restart=always
RestartSec=10
MemoryMax=320M

[Install]
WantedBy=multi-user.target
```

## Setup, in order

1. Add 2 GB of swap, install Node 22 (NodeSource), `caddy` (apt) and `cloudflared` (the `.deb` from its GitHub releases).
2. Copy `dist/`, `package.json` and `pnpm-lock.yaml` to `/opt/beebots`, then
   `npx pnpm install --prod --frozen-lockfile --ignore-scripts`.
3. Stop the engines wherever they ran before, then copy each lab folder over (settings, database with its `-wal`/`-shm`,
   images). Bees keep their positions.
4. `systemctl enable --now beebots@lab1 beebots@lab2 beebots@lab3`.
5. Copy the built dashboard to `/srv/dashboard` and `scripts/overview.html` to `/srv/overview/index.html`, install
   the Caddyfile, restart Caddy.
6. Copy the tunnel's credentials JSON to `/etc/cloudflared/` (mode 600), install `cloudflared.yml`, then
   `cloudflared service install`. For new hostnames, route them with the tunnel's own config, for example
   `cloudflared --config <tunnel config> tunnel route dns <tunnel id> <hostname>`. Without `--config`, the default
   `config.yml` (another tunnel) wins.

Caddy site addresses must be port-only (`http://:4173`) with `bind 127.0.0.1`. An address like
`http://127.0.0.1:4173` only matches requests whose Host is `127.0.0.1`, so tunnel traffic gets an empty 200.

On the PC, `scripts/start-all.mjs` is an optional local view: an SSH forward of 8080-8082 plus the same sites on
127.0.0.1.
