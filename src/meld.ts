import { type Tile, TILE_KINDS, canStartChow } from './tiles.js';

export type SetKind = 'chow' | 'pung' | 'kong';

/** A completed set. `tile` is the lowest tile for a chow, the tile itself otherwise. */
export interface MSet {
  kind: SetKind;
  tile: Tile;
  /** True for a set never exposed to other players (incl. a concealed kong). */
  concealed: boolean;
}

/** A meld on the table, plus who it was claimed from (null for a concealed kong). */
export interface Meld extends MSet {
  from: number | null;
}

export const setTiles = (s: MSet): Tile[] =>
  s.kind === 'chow'
    ? [s.tile, s.tile + 1, s.tile + 2]
    : s.kind === 'pung'
      ? [s.tile, s.tile, s.tile]
      : [s.tile, s.tile, s.tile, s.tile];

/** A winning shape: exactly four sets and one pair. */
export interface Decomp {
  sets: MSet[];
  pair: Tile;
}

/**
 * Every way to split `counts` (the concealed tiles, excluding melds) into
 * `need` sets plus one pair. Returns [] if there is no such split.
 */
export function decompose(counts: number[], need: number): Decomp[] {
  const out: Decomp[] = [];
  const c = counts.slice();
  const sets: MSet[] = [];
  const seen = new Set<string>();

  const key = (pair: Tile): string =>
    pair +
    '|' +
    sets
      .map((s) => `${s.kind}${s.tile}`)
      .sort()
      .join(',');

  const rec = (start: number, pair: Tile | null): void => {
    if (sets.length === need) {
      if (pair === null) {
        // Pair still to be found among the leftovers.
        for (let t = 0; t < TILE_KINDS; t++) {
          if (c[t] === 2) {
            let rest = 0;
            for (let u = 0; u < TILE_KINDS; u++) if (u !== t) rest += c[u];
            if (rest === 0) {
              const k = key(t);
              if (!seen.has(k)) {
                seen.add(k);
                out.push({ sets: sets.map((s) => ({ ...s })), pair: t });
              }
            }
          }
        }
      } else {
        let rest = 0;
        for (let u = 0; u < TILE_KINDS; u++) rest += c[u];
        if (rest === 0) {
          const k = key(pair);
          if (!seen.has(k)) {
            seen.add(k);
            out.push({ sets: sets.map((s) => ({ ...s })), pair });
          }
        }
      }
      return;
    }

    for (let t = start; t < TILE_KINDS; t++) {
      if (c[t] === 0) continue;
      if (c[t] >= 3) {
        c[t] -= 3;
        sets.push({ kind: 'pung', tile: t, concealed: true });
        rec(t, pair);
        sets.pop();
        c[t] += 3;
      }
      if (canStartChow(t) && c[t + 1] > 0 && c[t + 2] > 0) {
        c[t]--;
        c[t + 1]--;
        c[t + 2]--;
        sets.push({ kind: 'chow', tile: t, concealed: true });
        rec(t, pair);
        sets.pop();
        c[t]++;
        c[t + 1]++;
        c[t + 2]++;
      }
      if (pair === null && c[t] >= 2) {
        c[t] -= 2;
        rec(start, t);
        c[t] += 2;
      }
      // Tile `t` cannot be left over in a winning hand, so stop descending here.
      return;
    }
  };

  rec(0, null);
  return out;
}

/** True if the concealed counts plus `meldCount` melds form a standard win. */
export function isStandardWin(counts: number[], meldCount: number): boolean {
  return decompose(counts, 4 - meldCount).length > 0;
}

export function isSevenPairs(counts: number[]): boolean {
  let pairs = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] === 0) continue;
    if (counts[t] !== 2) return false;
    pairs++;
  }
  return pairs === 7;
}

const ORPHANS: Tile[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function isThirteenOrphans(counts: number[]): boolean {
  let total = 0;
  let pair = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] === 0) continue;
    if (!ORPHANS.includes(t)) return false;
    total += counts[t];
    if (counts[t] === 2) pair++;
    else if (counts[t] !== 1) return false;
  }
  return total === 14 && pair === 1 && ORPHANS.every((t) => counts[t] > 0);
}

export { ORPHANS };
