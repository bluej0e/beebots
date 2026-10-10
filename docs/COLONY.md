# The Colony

One engine runs a whole hive on paper: three **royals** that trade on the colony's best DNA, and a grid of
**workers** that evolve. Workers are rated, the best earn stars, the worst earn X's. Five stars and a bee lays an egg
(a mutated child). Five X's and it dies. A **beekeeper** looks at the workers once a day and gives a royal a
worker's DNA when that worker clearly beat it.

Live at https://beebots.covewrk.com. Dashboard: `colony.html` (same Vite app as the three-bee dashboard). Engine:
`src/colony/main.ts`. The DNA radar folds the 26 genes into 9 traits; each bee's avatar is the same shape in miniature.

## Who is in the hive

| Bee | How many | Decides | Can die | DNA |
|---|---|---|---|---|
| King | 1 | every tick | no | the anchor: a worker's DNA only if it beat him by 5 points over 7 days AND won at least 5 of the 7 single days |
| Queen | 1 | every tick | no | the champion: the best worker over 3 days, if it beat her by 2 points |
| Prince | 1 | every tick | no | the beekeeper's apprentice: trades the keeper's blend of what is working, retaught every day |
| Workers | 12 | their gene (1-15 min) | yes, every one | mutate, breed, die |

The royals keep their own books through a change of DNA: only the brain changes, not the account. That is the account
that would hold real money one day. The colony entrypoint refuses anything but `MODE=dry` until that has been built
and tested on its own.

Generation 0: the King runs Orakelia (the labs' rules), the Queen the two lab leaders combined (6 h hold, 2x stop), the
Prince 12 h with a 4x stop until the keeper has something to teach him. Workers: plain Orakelia, the six lab variants
(6 h / 12 h hold, 2x / 4x stop, large caps, mid/small caps) and five random immigrants.

## A rating round

Every 4 hours (`COLONY_RATE_EVERY_HOURS`):

1. Every worker at least 24 hours old (`COLONY_MIN_AGE_HOURS`) is scored on its last 24 hours
   (`COLONY_RATE_WINDOW_HOURS`): **return % minus half its worst drawdown %** in that window.
2. The best gets a ★, the worst a ✕.
3. 5 ✕ → dies. Its position is closed through the normal ledger, then it leaves the engine.
4. 5 ★ → lays an egg: a copy of its DNA with about 10% of genes nudged (the beekeeper tilts which ones and which way).
   The parent's stars reset and it earns a `+1` tag per egg.
5. Eggs wait in the **nursery** and hatch into the first free cell. An egg that has waited 24 h
   (`COLONY_EGG_WAIT_HOURS`), or a nursery with more than 3 eggs (`COLONY_MAX_NURSERY`), terminates the worst grown
   worker (most X's, then lowest score) to make room.
6. Cells still empty refill: 20% random immigrants (`COLONY_IMMIGRANT_RATE`), the rest split between bees the
   beekeeper breeds from his notes, crosses of the two best bees, and mutated children of the best.

## The beekeeper

He learns from every rating in the last 7 days (`COLONY_LEARN_WINDOW_HOURS`), dead bees included: for each gene,
do the bees with more of it score better? Number genes by correlation with score, yes/no and choice genes by the
average score of each value. Where the link is clear he writes down the value the winners lean towards. Together
those values are his **blend**. He then:

- **tilts every mutation**: genes he has a lesson on are picked up to 2x as often, and their random step leans towards
  the winners' value. It is a tilt, not an order: steps still go the other way some of the time.
- **breeds some refills** from his blend
- **teaches the Prince** his blend once a day, and writes a diary entry
- with `COLONY_KEEPER_CLAUDE=1` (only where the `claude` CLI is installed), asks Claude for the diary, a quip and up
  to 3 extra gene ideas for the Prince, each checked against the gene's range. The VPS has no `claude` CLI, so there
  he writes his own plain diary.

Every round, egg, birth, death and promotion is in the hive log (`colony_log` table) and on the dashboard.

## The genes

Every Momentum constant is a gene (`src/colony/genome.ts`). Nothing in the genome can touch leverage past
`MAX_LEVERAGE`, the daily loss stop, retirement, or the mode: those stay in `config.ts` and the risk layer.

| Group | Genes |
|---|---|
| What to buy | coin universe (any / large caps / mid-small caps), score weights for 7d / 24h / 1h return and attention, needs a green 24h, may short the weakest coins, shortlist size |
| How much | entry size, pyramid add size (0 = never adds), add every N ATR |
| How long | minimum hold, hourly ranks before rotating, may flip short, may wait flat, max minutes flat |
| How it gets out | stop distance in ATR(1h), two profit-lock rungs (at %, keeps %) |
| Pace and budget | trades per day, cooldown, spread gate |
| The brain | asks Jev or pure rules (zero tokens), decides every N minutes |

`asks Jev = no` is the cheapest experiment in the hive: it tells you whether Jev adds anything over the rules.

## Read the results with care

The A/B/C labs ran the same Orakelia rules in three places. After about 4 days those three identical bees were at
+20.9%, +17.3% and −3.9%: a 25-point spread from timing alone. Early stars will mostly be luck, and so will the
beekeeper's first lessons. Trust a lineage that keeps earning stars across generations, and a lesson that holds for
a week. That is why the King waits for a week and 5 winning days.

Most workers also hold the same coin at once (the "any coin" momentum leader). While they do, their scores differ
only by their exit genes. Universe and score-weight mutations are what spread them out.

## Run it

```sh
# Paper only. Borrows the Jev key from a Setup file (or set TYPESAFE_API_KEY).
ENGINE_PORT=8099 COLONY_DB=./data/colony/colony-{mode}.sqlite SETTINGS_PATH=./data/settings.json \
  node dist/colony/main.js
```

Then the dashboard: `ENGINE_URL=http://127.0.0.1:8099 pnpm --dir dashboard dev` and open `/colony.html`.
In production, serve `dist/colony.html` at the site root and proxy `/colony/`, `/equity` and `/events` to the engine.

API: `GET /colony/state` (everything the page shows), plus the classic `/equity`, `/events`, `/history`, `/health`.

## Cost

Each bee costs about what one lab bee costs: a few cents of Jev a day, less for rules-only bees and slow deciders.
15 bees share one market feed, so the colony makes the same OKX market-data calls as one engine.
