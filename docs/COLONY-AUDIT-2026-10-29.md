# Colony audit, 2026-10-29

Nineteen days of the Colony (founded 2026-10-10 03:09 UTC, VPS `beebots.covewrk.com`), read from the live
`colony-dry.sqlite`: 155,899 decisions, 1,760 fills, 855,225 equity snapshots, 109 rating rounds, 1,264 ratings,
38 bees born, 22 dead. The question was not "who is winning" but "does the machine read, judge, learn and adjust
the way it was meant to". Short answer: the plumbing is sound, the judging and learning are not.

## 1. Reading the market: sound

- Engine up since 10-11 20:57 with 0 restarts, longest gap between the King's 10 s equity snapshots 1.1 min.
- Every market field the bees see is populated: 2,000 recent Jev snapshots, zero nulls in `r1h/r24h/r7d/attn/oi/spread/vol`.
  7d return comes from 200 x 1h candles, 24h from the same series, 1h from 15m candles; the universe gate ran at 29
  coins. Spreads and volumes in the snapshots match the exchange.
- Jev: 61,545 calls, $1.99 total, 113 errors (110 of them 2 s timeouts, 0.2%). Rules-only bees never call it.
- Orders: 1,760, all `filled`, 0 reconciliation mismatches. Stops are checked every 30 s tick even for slow bees.
- Decision rhythm follows the `decides every` gene for workers; royals decide every tick by design.
- One oddity: three "Mayhem" bees "flew in from The Hive" on 10-11 20:57. That text is in no build; they were seeded by
  hand into the database at the last restart. Not a bug, but they were not born by the colony's rules.

## 2. Judging the workers: broken

**The same day is scored six times.** A round runs every 4 h and scores the last 24 h, so each 24 h window is rated
up to six times with 20 h of overlap. Of 1,264 ratings, 256 are *exactly* the score the bee got the round before,
and most of the rest differ by noise. Consequences in the log:

- Nurse II got 5 stars in a row at exactly +2.50 (12-07:11 to 12-23:11) and laid an egg: one trade, judged five times.
- Amber got X's at -24.25 four times in a row and died 16 h after the first mark: one trade, death.
- Dizzy earned 10 stars and 2 eggs from a single +50% PEPE day (23-03:15 to 24-07:15), then 4 X's the next two days.
- Waxy: 19 stars, 0 X's, mean score -0.90, mean return -0.17%. It trades once a day on large caps and its equity
  barely moves. In a down tape "least bad" is "best", so it is the colony's champion and its DNA went to the King.

`starsToBreed = 5` and `xsToDie = 5` were meant as five independent judgements. With this cadence they are one.

**A star does not need a gain, an X does not need a loss.** Every score in the latest round was negative; the star
went to -1.01. 307 of 1,264 ratings were positive. Selection pressure has been "lose least", not "make money".

**The whole hive trades one coin.** Opens by day: 10-11 40 of 51 were STRK, 10-13 41 of 67 STRK, 10-24 16 of 34 PEPE.
On 10-12 02:56 twelve bees hit the 8% daily loss stop in the same minute, on 10-14 11:13 six more. When everyone
holds the same coin, the ratings measure that coin's luck, not the DNA.

## 3. Learning: noise dressed as lessons

The keeper's `learn()` takes every (bee, round) rating in 7 days as one sample: ~460 "samples" that are really 12-16
bees each counted ~40 times. Then it runs a Pearson correlation for each of 26 genes and calls anything over 0.15 a
lesson. Evidence it is fitting noise:

- The verdicts contradict their own numbers: "lower min hold is winning: top half 13.4, bottom half 12" (the top
  half holds *longer*); "higher shortlist is winning: top half 2.76, bottom half 3.36" (the top half has a *smaller*
  shortlist). The correlation sign and the half-split disagree, which is what noise looks like.
- The lessons flip: 10-20 to 10-23 "asks Jev = no", "coins = large", "may wait = no"; 10-27 onwards "coins = any",
  "asks Jev = yes". Each flip retaught the Prince.
- The Prince's blend is built on top of the Prince's *current* DNA, so every day's noise is kept and the next day's
  added: 11 "retaught" entries, most of them cosmetic (entry size 0.53 -> 0.54 -> 0.53 -> 0.52).

Where it should have been strong, it was weak: the one real signal in the data (volatile small caps with full-size
positions destroy equity) never became a lesson, because sizing is not a gene.

## 4. Adjusting: the royals

- **Queen**: 16 DNA swaps in 19 days, nearly one a day. Her rule compares *her* last 3 days to the best worker's last
  3 days, but she has only run her current DNA for 1 day, so she is judged on a mix of three genomes and always loses.
  She took Stinger's DNA (shorts losers) on 10-24, Dizzy's on 10-25, Stinger's again on 10-26. Down 28.8%.
- **King**: one swap (Waxy, 10-17: -3.16 vs -28.39 "won 5 of 7 days"). Rule works, but it accepted a donor that
  was itself losing. Down 13.9%; BTC -2.0% since the swap.
- **Prince**: retaught 11 times from noise (see 3). Down 35.1%, 84% of the time in the market, 51 round trips, 11
  winners. Worst trades: STRK -32.8, STRK -31.0, APR -20.8.
- All three were pushed back in at 00:00 UTC every day ("forced in after 1 min flat", 178 times hive-wide) because
  Orakelia's `may wait = no` and `max flat = 0`. That is a gene; evolution may keep or drop it.

## 5. Sizing: the stop is wider than the loss stop

Positions are `entry size x 2x equity` whatever the coin. On STRK a 3 x ATR(1h) stop sits 9-12% away, so the first
thing that fires is the 8% *daily* loss stop: the royals' worst 8 trades were each -8.9% to -13.4% of equity, all
STRK/APR, all ended by `loss_stop`, not the trail. 57 loss-stop days in 285 bee-days (20%). Fees were not the
problem: $48.58 of a $219.66 realised loss.

## What changes (and resets the test)

| # | Change | Where |
|---|---|---|
| 1 | A round scores only the time since the last round: window = cadence, 8 h. Five stars now means five different 8 h stretches. | `colony.ts`, `DEFAULT_OPTS` |
| 2 | A star needs a positive score, an X a negative one. No star for losing least, no X for gaining least. | `colony.ts` `rate()` |
| 3 | The keeper learns one sample per bee (its mean score over the window), needs 8 bees, calls a lesson clear only at effect >= 0.3 *and* when the top/bottom halves agree with the correlation. The Prince's blend is Orakelia plus the clear lessons, never yesterday's Prince. | `keeper.ts`, `colony.ts` |
| 4 | King and Queen take DNA only from a worker that was in profit over the horizon, and the Queen keeps each DNA for a full 3 days before comparing. | `colony.ts` |
| 5 | Risk per trade is a hard rule: a position is sized so the initial stop costs at most `MAX_RISK_PER_TRADE_PCT` (2%) of equity. Volatile coins get small positions. Not a gene. | `risk.ts`, `config.ts` |
| 6 | The hive spreads its bets: a colony bee does not open a coin that more than a third of the hive already holds. | `engine.ts`, `brain.ts` |

The old database is backed up to `data/backup-colony-2026-10-29/` on the PC and the colony restarts from generation 0.
