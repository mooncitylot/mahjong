import { TILE_KINDS, canStartChow } from './tiles.js';
import { ORPHANS } from './meld.js';

/**
 * Shanten for the standard 4-sets-and-a-pair shape.
 * `fixed` is the number of melds already on the table.
 * 0 means tenpai, -1 means the hand is already complete.
 */
export function standardShanten(counts: number[], fixed: number): number {
  const c = counts.slice();
  let best = 99;

  const finish = (sets: number, parts: number, pair: boolean): void => {
    const s = sets + fixed;
    let p = parts;
    const pairBlock = pair ? 1 : 0;
    if (s + p + pairBlock > 5) p = Math.max(0, 5 - s - pairBlock);
    const sh = 8 - 2 * s - p - pairBlock;
    if (sh < best) best = sh;
  };

  const rec = (i: number, sets: number, parts: number, pair: boolean): void => {
    if (i >= TILE_KINDS) {
      finish(sets, parts, pair);
      return;
    }
    if (c[i] === 0) {
      rec(i + 1, sets, parts, pair);
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      rec(i, sets + 1, parts, pair);
      c[i] += 3;
    }
    if (canStartChow(i) && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      rec(i, sets + 1, parts, pair);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
    if (c[i] >= 2) {
      if (!pair) {
        c[i] -= 2;
        rec(i, sets, parts, true);
        c[i] += 2;
      }
      c[i] -= 2;
      rec(i, sets, parts + 1, pair);
      c[i] += 2;
    }
    if (i < 27 && i % 9 <= 7 && c[i + 1] > 0) {
      c[i]--;
      c[i + 1]--;
      rec(i, sets, parts + 1, pair);
      c[i]++;
      c[i + 1]++;
    }
    if (canStartChow(i) && c[i + 2] > 0) {
      c[i]--;
      c[i + 2]--;
      rec(i, sets, parts + 1, pair);
      c[i]++;
      c[i + 2]++;
    }
    // Discard this copy and move on.
    c[i]--;
    rec(i, sets, parts, pair);
    c[i]++;
  };

  rec(0, 0, 0, false);
  return best;
}

export function sevenPairsShanten(counts: number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] > 0) kinds++;
    if (counts[t] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function thirteenOrphansShanten(counts: number[]): number {
  let kinds = 0;
  let hasPair = false;
  for (const t of ORPHANS) {
    if (counts[t] > 0) kinds++;
    if (counts[t] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

// The bot asks for the same shapes over and over while scanning discards, and
// the standard search is the expensive part of a turn.
const cache = new Map<string, number>();

/** Best shanten across all three shapes. Special hands need a fully concealed hand. */
export function shanten(counts: number[], fixed: number): number {
  const key = `${fixed}|${counts.join('')}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let best = standardShanten(counts, fixed);
  if (fixed === 0) {
    best = Math.min(best, sevenPairsShanten(counts), thirteenOrphansShanten(counts));
  }
  if (cache.size > 200_000) cache.clear();
  cache.set(key, best);
  return best;
}

/** Tiles that would reduce shanten if drawn. Assumes a 13-tile (mod 3) hand. */
export function waits(counts: number[], fixed: number): number[] {
  const base = shanten(counts, fixed);
  const out: number[] = [];
  const c = counts.slice();
  for (let t = 0; t < TILE_KINDS; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (shanten(c, fixed) < base) out.push(t);
    c[t]--;
  }
  return out;
}
