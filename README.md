# Mahjong

Single-player mahjong against three bots, under Mahjong Competition Rules.
Vanilla TypeScript, no runtime dependencies, ~35 kB of JavaScript.

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
