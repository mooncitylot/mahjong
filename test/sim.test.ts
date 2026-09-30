// Plays full hands with four bots to shake out state-machine bugs.

import type { Seat } from '../src/tiles.js';
import {
  type Claim,
  newGame,
  applySelf,
  applyClaim,
  passClaims,
  claimsFor,
  bestClaim,
  finishRobbableKong,
  tilesLeft,
} from '../src/game.js';
import { botTurn, botClaim } from '../src/bot.js';

const HANDS = Number(process.argv[2] ?? 300);

let wins = 0;
let draws = 0;
let totalPoints = 0;
let biggest = 0;
let biggestName = '';
const fanTally = new Map<string, number>();

for (let n = 0; n < HANDS; n++) {
  const g = newGame((n % 4) as Seat, Math.floor(n / 4) % 4, n + 1);
  let steps = 0;

  while (g.phase !== 'over') {
    if (++steps > 4000) throw new Error(`hand ${n}: no progress after 4000 steps`);

    // Invariant: every player holds a legal number of tiles.
    for (const p of g.players) {
      const expect = 13 - p.melds.length * 3;
      const held = p.hand.length + (g.turn === p.seat && g.drawn !== null ? 1 : 0);
      if (held !== expect && held !== expect + 1) {
        throw new Error(
          `hand ${n}: seat ${p.seat} holds ${held} tiles with ${p.melds.length} melds`,
        );
      }
    }
    if (tilesLeft(g) < 0) throw new Error(`hand ${n}: wall went negative`);

    if (g.robbable) {
      const claims: Claim[] = [];
      for (const s of [0, 1, 2, 3] as Seat[]) {
        if (s === g.robbable.from) continue;
        const c = claimsFor(g, s).find((x) => x.kind === 'win');
        if (c) claims.push(c);
      }
      const best = bestClaim(claims, g.robbable.from);
      if (best) applyClaim(g, best);
      else finishRobbableKong(g);
      continue;
    }

    if (g.phase === 'claim') {
      const from = g.lastDiscard!.from;
      const claims: Claim[] = [];
      for (const s of [0, 1, 2, 3] as Seat[]) {
        if (s === from) continue;
        const c = botClaim(g, s);
        if (c) claims.push(c);
      }
      const best = bestClaim(claims, from);
      if (best) applyClaim(g, best);
      else passClaims(g);
      continue;
    }

    applySelf(g, botTurn(g, g.turn));
  }

  if (g.drawnGame) {
    draws++;
  } else {
    const r = g.result!;
    wins++;
    totalPoints += r.total;
    if (r.total > biggest) {
      biggest = r.total;
      biggestName = r.fans.map((f) => `${f.name} ${f.points}`).join(', ');
    }
    for (const f of r.fans) fanTally.set(f.name, (fanTally.get(f.name) ?? 0) + 1);
    const net = r.deltas.reduce((a, b) => a + b, 0);
    if (net !== 0) throw new Error(`hand ${n}: payments do not balance (${net})`);
    if (r.total < 8) throw new Error(`hand ${n}: declared a win worth ${r.total}`);
  }
}

console.log(`${HANDS} hands: ${wins} wins, ${draws} draws (${Math.round((draws / HANDS) * 100)}% drawn)`);
if (wins > 0) {
  console.log(`average winning hand: ${(totalPoints / wins).toFixed(1)} points`);
  console.log(`biggest: ${biggest} — ${biggestName}`);
  const top = [...fanTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('most common patterns: ' + top.map(([k, v]) => `${k} (${v})`).join(', '));
}
