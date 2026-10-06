# beebots 🐝

[![Watch the video: I built AI trading bees with Jev](docs/video.jpg)](https://www.youtube.com/watch?v=8ijN8LGljKg)

Three AI trading bees race each other on OKX perpetual futures. Every decision comes from **Jev** (TypeSafe AI's
decision model), and every order goes through a risk layer written in plain code. A live dashboard shows each
decision, order, fee and funding payment as it happens.

**It runs on paper by default.** The bees use real market prices and simulated money. Nothing touches an exchange
account unless you change the settings yourself, on purpose.

![The beebots dashboard: three named bees trading on paper](docs/screenshots/dashboard.jpg)

> **Not financial advice.** beebots is an experiment and a piece of open-source software. It is not a trading product,
> and nothing it does is a recommendation to buy or sell anything. Leveraged crypto trading can lose everything you
> put in. The software comes with no warranty (see [LICENSE](LICENSE)). If you ever switch it to real money, that
> is your decision and your risk.

> **This fork** ([bluej0e/beebots](https://github.com/bluej0e/beebots)) also runs on a Windows PC with no Docker
> and no Zapier: Claude designs the bees and runs the Beekeeper, and a Cloudflare tunnel shares the dashboard. See
> [Run it locally on Windows](#run-it-locally-on-windows). The Docker route below still works as before.

## Run it locally on Windows

Everything runs on your own PC: the engine, the dashboard, the Beekeeper, and optionally a Cloudflare tunnel so other
people can watch. It starts by itself when you log in.

**What you need:**

- **Node.js 22.13 or newer**
- **[Claude Code](https://claude.com/claude-code)**, signed in. Claude designs your bees on Setup and writes the
  Beekeeper's new rules, through the `claude` command on your Claude plan. No Anthropic API key needed.
- **A Jev key** from [console.typesafe.ai/keys](https://console.typesafe.ai/keys)
- **An OpenAI key**, for the bee portraits only (a few cents in total)
- **cloudflared** and a domain on Cloudflare, only if you want to share the dashboard

### 1. Install

```sh
git clone https://github.com/bluej0e/beebots.git
cd beebots
npx pnpm@10.34.5 install
cd dashboard && npx pnpm@10.34.5 install && cd ..
```

### 2. Settings

Create `.env` in the `beebots` folder (it is git-ignored, never commit it):

```sh
# Claude designs the bees on Setup; OpenAI still paints the portraits.
DESIGNER=claude
CLAUDE_DESIGN_MODEL=claude-opus-5-5
# Full path to the claude CLI, so it is found when beebots starts at logon (`where claude` shows it).
CLAUDE_BIN=D:/npm-global/claude.cmd

# The Beekeeper runs on this PC (beekeeper/local.ts) instead of a Zap.
BEEKEEPER_WEBHOOK_URL=http://127.0.0.1:8787/hook
PUBLIC_URL=http://127.0.0.1:8080
CLAUDE_KEEPER_MODEL=claude-opus-5-5

# How often each bee decides, in ms. 30000 = at most 6 Jev calls a minute for three bees.
TICK_MS=30000
```

Every other setting is in [`.env.example`](.env.example).

### 3. Start it

```sh
node scripts/start-all.mjs
```

This builds the dashboard and starts every part, restarting any part that stops (the engine stops on purpose after
Setup):

| part | address | what it is |
|---|---|---|
| engine | `127.0.0.1:8080` | the bees, the risk layer and the database |
| Beekeeper | `127.0.0.1:8787` | the coach ([`beekeeper/local.ts`](beekeeper/local.ts)) |
| site | **http://127.0.0.1:4173** | the dashboard; open this one |
| tunnel | your domain | only if `~/.cloudflared/beebots.yml` exists (step 5) |

Open http://127.0.0.1:4173 and go through **Setup** (see [Setup](#setup) below; the
2-hour Setup window applies here too). When you press **Start paper trading**, the engine restarts with your bees.

Logs are in `data/logs/` (one file per part, plus `start-all.log`). Stop everything with:

```sh
node scripts/stop-all.mjs
```

**Run Setup again:** stop it, delete `data/settings.json`, start it again.

### 4. Start with Windows

Register a scheduled task that runs [`scripts/beebots-hidden.vbs`](scripts/beebots-hidden.vbs) (it starts
`start-all.mjs` with no window) when you log in. In PowerShell, from the `beebots` folder:

```powershell
$vbs = "$PWD\scripts\beebots-hidden.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory "$PWD"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT30S"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "beebots" -Action $action -Trigger $trigger -Settings $settings
```

`beebots-hidden.vbs` expects Node at `C:\Program Files\nodejs\node.exe`; edit it if yours is elsewhere. Start it now
without logging out with `schtasks /run /tn beebots`. Running a second copy is safe: it sees the first one and exits.

It runs while you are logged in. If the PC sleeps or you sign out, the bees pause. To keep them running around the
clock, run the engines on a small server instead: see [deploy/vps/README.md](deploy/vps/README.md).

### 5. Share it on your own domain (optional)

A named Cloudflare tunnel gives the dashboard a fixed HTTPS address. Only the site is shared; the Beekeeper's
delivery route (`/lab`) and the engine stay private, and owner actions still need your password.

```sh
cloudflared tunnel login
cloudflared tunnel create beebots
cloudflared tunnel route dns <tunnel-id> beebots.example.com
```

Use the tunnel's **id** in `route dns`, not its name: if you already have a `~/.cloudflared/config.yml` for another
tunnel, cloudflared reads it and points the name at that tunnel instead. Then write `~/.cloudflared/beebots.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
no-autoupdate: true

ingress:
  - hostname: beebots.example.com
    service: http://127.0.0.1:4173
  - service: http_status:404
```

Add your hostname to `preview.allowedHosts` in [`dashboard/vite.config.ts`](dashboard/vite.config.ts), then restart
beebots. `start-all.mjs` runs the tunnel whenever `beebots.yml` exists (`CLOUDFLARED_BIN` and
`BEEBOTS_TUNNEL_CONFIG` override where it looks).

For a quick throwaway link instead, `cloudflared tunnel --url http://127.0.0.1:4173` prints a random
`*.trycloudflare.com` address that changes every time it starts. If you have a `~/.cloudflared/config.yml`, add
`--config` with an empty file, or the quick tunnel picks up that file's rules and answers 404.

## Run it on a server with Docker

Any machine with Docker works:

```sh
curl -fsSLO https://raw.githubusercontent.com/imikerussell/beebots/main/docker-compose.yml
docker compose up -d
```

This runs the original author's published images, without this fork's changes (no Claude designer, no local
Beekeeper). Then:

1. Open `http://<your-server-ip>/` in a browser. You'll see the **Setup** page. Do this soon: Setup stays open for
   2 hours after the server starts (see [Setup safety](#setup-safety)).
2. Go through Setup (below).

### Setup

1. On Setup:
   - tick the three risk statements
   - pick an **owner password** (8+ characters). Your dashboard is public; the password is what lets *you* change
     things from it later, like joining or leaving the Hive. Write it down.
   - paste your **Jev key** (from [console.typesafe.ai/keys](https://console.typesafe.ai/keys))
   - paste an **OpenAI key** (required: it designs your bees and paints them; a few cents in total. On the
     [local setup](#run-it-locally-on-windows) with `DESIGNER=claude`, Claude designs them and OpenAI only paints)
   - design your three bees. For each one, answer **How do you want this bee to trade?** in a sentence ("a Trump bee
     that only ever trades TRUMP", "a sleepy bee that only buys bitcoin dips"), press **Create my bee**, and OpenAI
     invents its name, tagline, trading rules and the coins it may trade. Rename it if you like, then press
     **Generate your bee's portrait**. You can carry on once all three bees have their portraits.
   - choose whether to join **the Hive** (see below). "Not now" is fine; you can join later.
2. Press **Start paper trading**. The engine restarts, and the dashboard goes live.

| Agree to the rules | Pick an owner password | Design your bees |
|---|---|---|
| ![Risk statements](docs/screenshots/setup-rules.jpg) | ![Owner password](docs/screenshots/setup-password.jpg) | ![Design your bees](docs/screenshots/setup-bees.jpg) |

### Setup safety

Setup has no code to find: the page is open to whoever reaches the server first. So:

- **First come, first served.** Once you press Start, Setup closes for good. Nobody else can change your keys or bees.
- **A setup window.** If nobody finishes Setup within 2 hours of the engine starting (`SETUP_WINDOW_MIN`, default
  120), it locks, and the page says so. Restart the engine to open it again: `docker compose restart engine`, or
  `node scripts/stop-all.mjs` then `node scripts/start-all.mjs` on the [local setup](#run-it-locally-on-windows).
- **Caps** on the calls that cost money (designs and portraits), in total and per visitor.

Set up right after deploying, and use a domain with HTTPS if you can (`PUBLIC_DOMAIN`, below) so your keys don't
travel over plain HTTP.

Each bee gets its own portrait, painted in the same style as the originals:

<img src="docs/screenshots/generated-bee.jpg" alt="A generated bee portrait" width="256">

**Copy a winning bee.** Every bee on [beebots.tech](https://beebots.tech) shows its rules with a **Copy** button. Copy
a winner's rules and paste them into **How do you want this bee to trade?** to start from its playbook.

Each bee starts with $333 of paper money. Jev spending is capped at $2 a day by default.

### Updating

New versions are published as [releases](https://github.com/imikerussell/beebots/releases). When one is out, your
dashboard shows **Update available** next to the trading mode, linking to what's new. Nothing updates by itself.

To update, pull the new images and restart. Your bees, settings and history live in Docker volumes and are kept:

```sh
docker compose pull
docker compose up -d
```

Run it over SSH in the folder that holds your `docker-compose.yml`
(`docker compose ls` shows where it is). To turn the check off, set `UPDATE_CHECK=false`.

## The Hive

The Hive is a public leaderboard at [beebots.tech](https://beebots.tech) where everyone's bees race each other. It is
**opt-in**: nothing is sent unless you join. What you agree to when you join:

> You're about to share your bees' names, styles and paper-trading results on the public leaderboard at beebots.tech. The board shows % gain/loss only. No keys, no exchange account details, no IP address. Paper trading only. Not financial advice. You can leave any time.

- **What is shared:** your bees' names, taglines and styles, their trade counts, their paper equity and funding, and
  each paper fill (coin, side, size, price, time, fee). The board shows the % gain or loss, not dollars; the equity and fills are
  there so it can replay every trade against OKX's public prices and mark the bee **verified**. Also a random hive id
  and key made when you join, so later reports can be matched to your install.
- **Never shared:** your Jev, OpenAI or OKX keys, any exchange account data, your server's address, or anything else.
- **Paper only.** The engine refuses to report in `MODE=live`, and the board rejects live reports.
- **Join or leave:** tick it on Setup, or use **Join the Hive** in the dashboard header. Joining and leaving from the
  dashboard need your **owner password** (the one you picked on Setup; 8 wrong tries lock it for 15 minutes). Leaving
  removes your bees and their history from the board. Running Setup
  again and answering **Not now** also leaves the Hive, on the next engine start.

The Hive is a game, not a signal service. **Not financial advice.**

## The Beekeeper (optional)

The Beekeeper is an outside coach for your bees. Every few hours he looks at all three, and if one keeps losing
because its rules are wrong, he writes it new rules. Jev picks the bee, and Claude Opus 5.5 writes the rules.

- **On your own PC, no Zapier:** [`beekeeper/local.ts`](beekeeper/local.ts) runs the same round as the Zap: it reads
  the scorecard, asks Jev the same three questions, has Claude write the rules with the Zap's own prompt
  ([`beekeeper/opus-prompt.txt`](beekeeper/opus-prompt.txt)), then signs and delivers them. It uses the `claude` CLI
  on your Claude plan. [Run it locally on Windows](#run-it-locally-on-windows) starts it for you; the
  `BEEKEEPER_WEBHOOK_URL` and `PUBLIC_URL` lines in `.env` connect it, so there is nothing to paste on the dashboard.
  Each round is logged to `data/beekeeper-diary.jsonl`. A plain `http://` hook is allowed only on this machine
  (`127.0.0.1`, `localhost`); anywhere else it must be `https://`.
- **On Zapier:** copy the Zap from [mrc.fm/beekeeper](https://mrc.fm/beekeeper), then paste its hook URL into
  **Connect the Beekeeper** on your dashboard. The full walk-through is in [docs/BEEKEEPER.md](docs/BEEKEEPER.md).
- **Watch it being built:** [youtube.com/watch?v=cTUnM9trqfs](https://www.youtube.com/watch?v=cTUnM9trqfs)
- **What he can change:** a bee's rules text and its coin list. Never leverage, stops, caps or real money settings.
  One rewrite per bee every 20 hours.
- **You stay in charge:** every rewrite shows on the dashboard with an **Undo** next to it. Undo, Connect and
  the On/Off switch need your owner password.
- **Works on paper.** No exchange account needed.

## How your bees trade

Your sentence becomes two things the engine enforces, and one it passes on:

- **Coins.** If your bee names coins, it only ever trades those. They must be crypto perpetuals listed on OKX EEA right
  now (Setup checks the live list and asks you to rephrase if none match).
- **The engine it runs on.** Every bee runs on one of three built-in trading styles below. A bee limited to BTC and/or
  ETH can run on Trend; one limited to BTC, ETH, SOL or HYPE can run on Breakout; everything else runs on Momentum,
  which works on any coin.
- **Rules.** Its rules go to Jev with every decision, and Jev follows them when picking among the moves the style
  offers. They steer the choice; they can't invent moves the style doesn't have, and the risk layer below still applies.

A coin still has to pass the same gates as any other (at least $1M of 24h volume, a tight spread). If your bee's coin
doesn't, the bee just waits until it does.

## The three trading styles

| style | the original bee | what it does |
|---|---|---|
| **Breakout** | Bizzy, the grinder | One volatility breakout a day on BTC, ETH, SOL or HYPE, ridden to the daily close. |
| **Trend** | Breezy, the calculated one | Trend following on BTC and ETH only. Few trades, rides winners, sized by volatility. |
| **Momentum** | Boozy, the degen | Chases the strongest 7-day mover across every liquid coin, and adds to winners. |

Bizzy, Breezy and Boozy are the official bees (they run on [beebots.tech](https://beebots.tech)), so their names and art
are theirs; your bees get their own. Two of your bees can share a style. The full rules are in [`strategies/`](strategies/), and the rules every bee
shares (caps, stops, "never flat for long") are in [`strategies/DRAMA_RULES.md`](strategies/DRAMA_RULES.md).

## How a decision is made

Every tick, for every bee:

1. **Look.** Live OKX market data: tickers, candles, RSI, MACD, ATR, Bollinger, Donchian, funding, open interest.
2. **Summarise.** A small numeric snapshot of the market and the bee's own position.
3. **Ask Jev.** Jev picks one move from a menu of moves that are actually valid right now, with probabilities.
4. **Check.** Plain code can veto, shrink or force the move: max 2x leverage, per-bee stops, a daily loss stop,
   trade caps, a fee budget, cooldowns, and a hard daily cap on Jev spending.
5. **Record, then act.** The decision is written to SQLite before anything happens.
6. **Broadcast.** The dashboard streams it live.

Jev is stateless and never sees an order endpoint. If Jev is down or slow, the bees hold and open nothing.

## Settings

Most people need none: Setup covers the keys. To change anything else, create a `.env` next to
`docker-compose.yml` (or in the `beebots` folder on the [local setup](#run-it-locally-on-windows)) and restart. Every setting is documented
in [`.env.example`](.env.example). The common ones:

| setting | default | what it does |
|---|---|---|
| `PUBLIC_DOMAIN` | blank | A domain pointed at your server. Caddy then gets an HTTPS certificate on its own. **Recommended**: without it, the Setup page and your keys travel over plain HTTP. |
| `TICK_MS` | `10000` | How often each bee asks Jev. Faster is more exciting and costs more (see [docs/COSTS.md](docs/COSTS.md)). |
| `JEV_DAILY_USD_CAP` | `2` | Hard daily cap on Jev spend. When it's hit, every bee holds until 00:00 UTC. |
| `BEE_START_EQUITY_USD` | `333` | Paper money per bee. |

**Run Setup again** (new names, new keys, or a forgotten owner password):

```sh
docker compose exec engine rm /data/settings.json
docker compose restart engine
```

Run these on the server, then open the site and go through Setup again. The
setup window starts over with the restart.

**Owner password:** it's stored only as a salted hash in `/data/settings.json`, so nobody (including you) can read it
back. If you forget it, run Setup again as above. Installs from before the owner password existed can set
`OWNER_PASSWORD` in `.env` (8+ characters) instead.

**Something wrong?** The engine's log says what it's doing: `docker compose logs engine`, or `data/logs/engine.log`
on the local setup.

**Backups:** a sidecar writes a nightly copy of each database to `/data/backups` inside the `bees-data` volume and
keeps 7 days. That copy lives on the same server, so take an off-server copy yourself if you care about the history.

## Real money (read this twice)

beebots can trade OKX demo accounts or real money, but only if you set it up by hand. It is **not** part of Setup, and
there is no button for it.

- Real money needs **all** of: `DRY_RUN=false`, `MODE=live`, three OKX **EEA** sub-account API keys
  (`BEE1_OKX_API_KEY` etc., Read + Trade only, **never Withdraw or Transfer**, IP-bound to your server), and
  `LIVE_ACK=I-ACCEPT-REAL-MONEY-RISK`. With any one of them missing, the engine refuses to start.
- The first hours of live trading run at reduced size (`LIVE_SIZE_MULTIPLIER`, `LIVE_RAMP_HOURS`).
- The bot can never withdraw. Moving money off the exchange is always done by you, by hand.
- Try `MODE=demo` first, with OKX **demo** keys (`BEE1_OKX_DEMO_API_KEY` etc.).
- The engine talks to OKX's EEA site (`eea.okx.com`). Check that OKX's derivatives are available where you live
  before you go anywhere near real money.

**Ending a live run:** `docker compose exec engine touch /data/close-live`. The engine stops asking Jev, closes every
position with reduce-only market orders, and stays up so the dashboard keeps the final result.

Again: this is not financial advice, and you can lose everything.

## Develop

```sh
pnpm install
pnpm test            # risk layer (every cap, gate and forced move, both directions), setup, redaction, indicators, ledger
pnpm universe        # the tradable coin list from live public data (no keys)
pnpm snapshot        # each style's menu and snapshot from live data (no Jev call)
pnpm e2e:fake-jev    # the whole engine on paper with a random fake Jev (no spend)
pnpm dev             # the real engine on paper, with real Jev calls (Setup runs if there is no key)

cd dashboard && pnpm install && pnpm dev    # http://127.0.0.1:5173, proxied to the engine
```

On Windows, `pnpm dev` fails: its script sets a variable the Unix way. Run the engine directly instead (the default
database path is the same):

```sh
node node_modules/tsx/dist/cli.mjs --env-file-if-exists=.env src/index.ts
```

Three tests check Unix file permissions (`0600` for the settings, Hive and Beekeeper files) and fail on Windows, which
has no such permissions. They pass on Linux and in Docker.

Build the images yourself instead of pulling them:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Everything on OKX is built on OKX's own open-source [Agent Trade Kit](https://github.com/okx/agent-trade-kit) (MIT).
Public market data (instruments, tickers, candles, open interest, funding) runs in-process on the kit's own public REST
client and rate limiter, vendored in `src/okx/kit/` with its licence, so there is no child process per call; `pnpm parity`
checks it returns the same data as the CLI. Signed calls (orders, positions, fills, leverage, news) go through the kit's
CLI. Keys never touch disk inside the container except in the Setup file (`/data/settings.json`, owner-only). The
logger and the event stream redact anything that looks like a key, an IP address or an email.

## Credits

Built by Mike on the Creator Magic YouTube channel, in the video "I gave three AI bees $1,000".
Decisions by [Jev](https://typesafe.ai).

MIT licence. No warranty. Not financial advice.
