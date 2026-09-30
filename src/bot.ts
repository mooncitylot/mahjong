// Greedy bot: pick the discard with the best (shanten, waits, potential fan)
// and only claim a tile when it does not make the hand harder to finish.

import {
  type Tile,
  TILE_KINDS,
  isHonor,
  isDragon,
  isTerminalOrHonor,
  suitOf,
  rankOf,
  toCounts,
  WIND_E,
} from './tiles.js';
import { shanten, waits } from './shanten.js';
import {
  type Claim,
  type GameState,
  type SelfAction,
  type Player,
  handOf,
  selfActions,
  claimsFor,
  winCheck,
} from './game.js';
import { MIN_POINTS } from './score.js';

/**
 * Rough read of how much the hand is worth if it comes together. The bot uses
 * it as a tiebreak so it drifts toward hands that can clear the 8-point floor
 * instead of cheap all-chow hands it could never declare.
 */
function potential(counts: number[], p: Player, seatWind: number, prevalentWind: number): number {
  let v = 0;
  const suitCount = [0, 0, 0];
  let honors = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    const n = counts[t];
    if (n === 0) continue;
    if (isHonor(t)) honors += n;
    else suitCount[suitOf(t)] += n;
  }
  for (const m of p.melds) {
    const t = m.tile;
    const n = m.kind === 'chow' ? 3 : 3;
    if (isHonor(t)) honors += n;
    else suitCount[suitOf(t)] += n;
  }

  // Flush shapes are the most reliable way to reach 8 points.
  const top = Math.max(...suitCount);
  const suited = suitCount[0] + suitCount[1] + suitCount[2];
  if (suited > 0 && top === suited) v += honors > 0 ? 6 : 12;
  else if (suited - top <= 2) v += 3;

  // Honour pungs: dragons and the two useful winds.
  for (let t = 27; t < TILE_KINDS; t++) {
    const n = counts[t] + p.melds.filter((m) => m.tile === t).length * 3;
    if (n < 2) continue;
    if (isDragon(t)) v += n >= 3 ? 4 : 2;
    else if (t === WIND_E + seatWind || t === WIND_E + prevalentWind) v += n >= 3 ? 3 : 1.5;
  }

  // Pung-heavy and terminal-heavy shapes.
  let trips = p.melds.filter((m) => m.kind !== 'chow').length;
  for (let t = 0; t < TILE_KINDS; t++) if (counts[t] >= 3) trips++;
  if (trips >= 3) v += 5;
  else if (trips === 2) v += 2;

  let outside = 0;
  for (let t = 0; t < TILE_KINDS; t++) if (isTerminalOrHonor(t)) outside += counts[t];
  if (outside >= 10) v += 4;

  return v;
}

/** Tiles left that the bot cannot see, for weighting how live a wait is. */
function liveCount(g: GameState, seat: number, tile: Tile): number {
  let seen = 0;
  for (const p of g.players) {
    for (const t of p.discards) if (t === tile) seen++;
    for (const m of p.melds) {
      if (m.kind === 'chow') {
        if (tile >= m.tile && tile <= m.tile + 2) seen++;
      } else if (m.tile === tile) seen += m.kind === 'kong' ? 4 : 3;
    }
  }
  for (const t of g.players[seat].hand) if (t === tile) seen++;
  return Math.max(0, 4 - seen);
}

function isolation(counts: number[], t: Tile): number {
  if (isHonor(t)) return counts[t] >= 2 ? 0 : 3;
  const r = rankOf(t);
  let near = 0;
  for (let d = -2; d <= 2; d++) {
    if (d === 0) continue;
    const rr = r + d;
    if (rr < 1 || rr > 9) continue;
    near += counts[t + d] * (Math.abs(d) === 1 ? 2 : 1);
  }
  near += (counts[t] - 1) * 2;
  return near === 0 ? 2 : 0;
}

export function botTurn(g: GameState, seat: number): SelfAction {
  const actions = selfActions(g, seat as 0 | 1 | 2 | 3);
  const win = actions.find((a) => a.kind === 'win');
  if (win) return win;

  const p = g.players[seat];
  const full = handOf(g, seat as 0 | 1 | 2 | 3);
  const counts = toCounts(full);
  const fixed = p.melds.length;
  const seatWind = (seat - g.dealer + 4) % 4;

  // A concealed kong is nearly free value when the tile is dead weight anyway.
  for (const a of actions) {
    if (a.kind !== 'concealed-kong') continue;
    const before = shanten(counts, fixed);
    const after = counts.slice();
    after[a.tile] -= 4;
    if (shanten(after, fixed + 1) <= before) return a;
  }
  for (const a of actions) {
    if (a.kind !== 'added-kong') continue;
    const after = counts.slice();
    after[a.tile] -= 1;
    if (shanten(after, fixed) <= shanten(counts, fixed)) return a;
  }

  let best: SelfAction | null = null;
  let bestKey = -Infinity;
  for (const a of actions) {
    if (a.kind !== 'discard') continue;
    const c = counts.slice();
    c[a.tile]--;
    const sh = shanten(c, fixed);
    const w = waits(c, fixed);
    const live = w.reduce((s, t) => s + liveCount(g, seat, t), 0);
    const pot = potential(c, p, seatWind, g.prevalentWind);
    const safety = isolation(counts, a.tile);
    const key = -sh * 1000 + live * 12 + pot * 8 + safety * 2 + w.length;
    if (key > bestKey) {
      bestKey = key;
      best = a;
    }
  }
  return best ?? actions.find((a) => a.kind === 'discard')!;
}

/** Null means pass. */
export function botClaim(g: GameState, seat: number): Claim | null {
  const options = claimsFor(g, seat as 0 | 1 | 2 | 3);
  if (options.length === 0) return null;

  const win = options.find((c) => c.kind === 'win');
  if (win) return win;

  const p = g.players[seat];
  const fixed = p.melds.length;
  const counts = toCounts(p.hand);
  const before = shanten(counts, fixed);
  const tile = g.lastDiscard!.tile;

  let best: Claim | null = null;
  let bestKey = 0;
  for (const c of options) {
    const after = counts.slice();
    if (c.kind === 'chow') {
      for (const t of [c.tile, c.tile + 1, c.tile + 2]) if (t !== tile) after[t]--;
    } else if (c.kind === 'pung') after[tile] -= 2;
    else after[tile] -= 3;

    const sh = shanten(after, fixed + 1);
    if (sh > before) continue; // claiming would set the hand back

    // Exposing the hand kills concealed-hand fans, so require some payoff.
    const pot = potential(after, p, (seat - g.dealer + 4) % 4, g.prevalentWind);
    let key = (before - sh) * 100 + pot * 5;
    if (c.kind === 'kong') key += 20;
    if (c.kind === 'pung' && (isDragon(tile) || tile === WIND_E + ((seat - g.dealer + 4) % 4)))
      key += 40;
    if (c.kind === 'chow') key -= 25; // chows rarely pay for the exposure
    if (sh <= 1) key += 60;
    if (pot < 4 && sh > 0) key -= 80; // an unfinishable cheap hand is worse than passing

    if (key > bestKey) {
      bestKey = key;
      best = c;
    }
  }
  return best;
}

/** Whether a bot should declare a win it is allowed to declare. Always yes. */
export function botWantsWin(g: GameState, seat: number, tile: Tile, selfDrawn: boolean): boolean {
  return winCheck(g, seat as 0 | 1 | 2 | 3, tile, selfDrawn).total >= MIN_POINTS;
}
