# Running the Colony on a small VPS

How this fork runs the Colony ([docs/COLONY.md](../../docs/COLONY.md)) around the clock on an Oracle Cloud Always
Free VM (`VM.Standard.E2.1.Micro`: 1 GB RAM, x86, Ubuntu 24.04). One engine for every bee, the dashboard, and the
Cloudflare tunnel.

## Layout on the server

| What | Where |
|---|---|
| Compiled engine (`pnpm build`), `package.json`, prod `node_modules` | `/opt/beebots` (no `.env`) |
| Colony data: `engine.env`, `settings.json` (only for the Jev key), `colony-dry.sqlite` | `/opt/beebots/data/colony` |
| Engine, port 8080, 127.0.0.1 only | systemd `beebots-colony` ([`beebots-colony.service`](beebots-colony.service)) |
| The dashboard (`dashboard/dist`), colony page at `/` | Caddy on :4170, [`Caddyfile`](Caddyfile) at `/etc/caddy/Caddyfile`, files in `/srv/dashboard` |
| beebots.covewrk.com | cloudflared service, [`cloudflared.yml`](cloudflared.yml) at `/etc/cloudflared/config.yml` |

Only SSH is open to the internet. Everything public goes out through the tunnel. Run **one** connector for the tunnel.

`/opt/beebots/data/colony/engine.env`:

```
MODE=dry
TICK_MS=30000
SETTINGS_PATH=./data/colony/settings.json
COLONY_DB=./data/colony/colony-{mode}.sqlite
ENGINE_PORT=8080
```

## Deploy an update

```sh
pnpm build && pnpm --dir dashboard build
scp -r dist package.json pnpm-lock.yaml ubuntu@<vps>:/opt/beebots/
scp -r dashboard/dist/* ubuntu@<vps>:/srv/dashboard/
ssh ubuntu@<vps> 'sudo systemctl restart beebots-colony'
```

Run `npx pnpm install --prod --frozen-lockfile --ignore-scripts` in `/opt/beebots` when dependencies change.

## Notes

Caddy site addresses must be port-only (`http://:4170`) with `bind 127.0.0.1`. An address like
`http://127.0.0.1:4170` only matches requests whose Host is `127.0.0.1`, so tunnel traffic gets an empty 200.

For a new hostname, route it with the tunnel's own config:
`cloudflared --config <tunnel config> tunnel route dns <tunnel id> <hostname>`. Without `--config`, the default
`config.yml` (another tunnel) wins.

The three A/B/C lab engines that ran here from 2026-10-06 to 2026-10-10 were retired when the Colony replaced them.
Their final databases are in `data/backup-labs-final-2026-10-10/` on the PC.
