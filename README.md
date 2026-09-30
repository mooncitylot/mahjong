# Mahjong

Single-player mahjong against three bots, under Mahjong Competition Rules.
Vanilla TypeScript, no runtime dependencies, ~45 kB of JavaScript.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # scoring + engine tests
npm run sim 300  # play 300 hands with four bots and print statistics
```

## Rules as implemented

Standard MCR: 136 tiles (no flowers), 13-tile hands, chow only from the player
to your left, pung and kong from anyone, and the **8-point minimum** — a hand
you cannot score to 8 is not a hand you can declare.

Payment follows MCR. On a discard the discarder pays `points + 8` and the other
two pay 8 each; on a self-draw everyone pays `points + 8`.

### Scoring

`src/score.ts` implements about 55 of the 81 patterns, covering every point
tier from 1 to 88, plus the Chicken Hand fallback. A winning hand is split into
every legal decomposition and the highest-scoring one is kept.

Not implemented: the knitted-tile family (Knitted Straight, Greater/Lesser
Honours and Knitted Tiles), Flowers, and a few rare 88- and 64-point hands.
The non-repeat table in `EXCLUDES` covers the cases that come up in play rather
than the full official exclusion matrix.

### Bots

Greedy, in `src/bot.ts`. Each discard candidate is scored on resulting shanten,
how many of its waiting tiles are still live, and a rough estimate of what the
hand would be worth — so the bots steer toward shapes that can actually clear 8
points instead of cheap all-chow hands they could never declare. They claim a
discard only when it does not push the hand backwards and the exposure pays for
itself.

## Phones

Portrait works; nothing forces landscape. Under 700px wide the opponents stack
top to bottom in play order (Right, Across, Left) with a tile count in place of
their face-down tiles, and your hand plus the turn-order strip stay pinned to
the bottom of the screen. Your hand is sized to fit fourteen tiles across. On
touch screens a tap raises a tile and a second tap (or the Discard button)
throws it, so a stray touch never discards.

The seat on the move is outlined in amber with a pulsing badge, and the
turn-order strip lights the same seat.

## Motion

The UI rebuilds the DOM on every update, so `ui.ts` keys each tile and animates
the difference between renders. Tiles that moved slide into place (your hand
re-sorts with a little spring); a discard is tossed in an arc from the hand —
yours or a bot's face-down row — and lands in the pile with a bump; claimed
tiles arc into the new meld; draws drop in; a new hand deals in with a stagger.
Seats grow and shrink smoothly as piles wrap, so the table never jumps.

Updates are drawn at most once per frame, and animations still running when
the next render lands are carried over, so flights are never cut short. The
turn highlight passes straight from the discarder to the next seat, with a pill
gliding along the turn-order strip. Claims pop a "Pung!"/"Chow!"/"Kong!" over
the seat; a win gets a beat on the table before the scorecard slides in, whose
lines stagger and payments count up. All of it switches off under
`prefers-reduced-motion`.

## Layout

| File | Role |
| --- | --- |
| `src/tiles.ts` | Tile encoding (0–33), wall, display glyphs |
| `src/meld.ts` | Sets, melds, and hand decomposition |
| `src/shanten.ts` | Distance-to-ready for all three hand shapes |
| `src/score.ts` | MCR patterns and the 8-point minimum |
| `src/game.ts` | Rules and state transitions, all synchronous |
| `src/bot.ts` | Opponent decisions |
| `src/engine.ts` | Turn loop, timing, and the human's pending prompts |
| `src/ui.ts` | DOM rendering |
