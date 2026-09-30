// Mahjong Competition Rules scoring.
//
// A practical subset: ~55 of the 81 patterns, covering every point tier.
// Omitted are the knitted-tile and honours-and-knitted families, Flowers
// (no flower tiles in this build), and a handful of rare 88/64 hands.

import {
  type Tile,
  TILE_KINDS,
  isHonor,
  isWind,
  isDragon,
  isTerminal,
  isSimple,
  isTerminalOrHonor,
  rankOf,
  suitOf,
  suitBase,
  DRAGON_G,
  WIND_E,
} from './tiles.js';
import {
  type Decomp,
  type MSet,
  type Meld,
  setTiles,
  decompose,
  isSevenPairs,
  isThirteenOrphans,
  ORPHANS,
} from './meld.js';

export interface Fan {
  name: string;
  points: number;
}

export interface WinContext {
  /** Concealed tiles including the winning tile. */
  concealed: Tile[];
  melds: Meld[];
  winTile: Tile;
  selfDrawn: boolean;
  seatWind: number; // 0..3
  prevalentWind: number; // 0..3
  /** Won on the very last tile of the wall (self-draw) or last discard. */
  lastTile: boolean;
  /** Won on the replacement tile after declaring a kong. */
  afterKong: boolean;
  /** Won by robbing the tile someone added to a melded pung. */
  robbingKong: boolean;
  /** Only copy of the winning tile left visible — scores Last Tile. */
  lastOfKind: boolean;
  /**
   * Whether the hand had exactly one winning tile, required for the wait
   * patterns. A thunk because working it out costs a full wait search, and
   * most calls here are legality checks that never reach a wait pattern.
   */
  soleWait: () => boolean;
}

export interface ScoreResult {
  fans: Fan[];
  total: number;
  /** null when the hand is not a legal winning shape at all. */
  shape: 'standard' | 'seven-pairs' | 'thirteen-orphans' | null;
}

// ---------------------------------------------------------------------------
// helpers over a decomposition
// ---------------------------------------------------------------------------

const isPungLike = (s: MSet): boolean => s.kind === 'pung' || s.kind === 'kong';

function allTilesOf(d: Decomp, pair: Tile): Tile[] {
  const out: Tile[] = [];
  for (const s of d.sets) out.push(...setTiles(s));
  out.push(pair, pair);
  return out;
}

/** Tiles ignoring the fourth copy in a kong — the "14 tile" view of the hand. */
function shapeTiles(d: Decomp): Tile[] {
  const out: Tile[] = [];
  for (const s of d.sets) {
    if (s.kind === 'chow') out.push(s.tile, s.tile + 1, s.tile + 2);
    else out.push(s.tile, s.tile, s.tile);
  }
  out.push(d.pair, d.pair);
  return out;
}

const chows = (d: Decomp): MSet[] => d.sets.filter((s) => s.kind === 'chow');
const pungs = (d: Decomp): MSet[] => d.sets.filter(isPungLike);
const kongs = (d: Decomp): MSet[] => d.sets.filter((s) => s.kind === 'kong');

function suitsUsed(tiles: Tile[]): { suits: Set<number>; honors: boolean } {
  const suits = new Set<number>();
  let honors = false;
  for (const t of tiles) {
    if (isHonor(t)) honors = true;
    else suits.add(suitOf(t));
  }
  return { suits, honors };
}

/** Sorted ranks of chows within one suit, for the shifted/triple families. */
function chowGroupsBySuit(cs: MSet[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const c of cs) {
    const s = suitOf(c.tile);
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(rankOf(c.tile));
  }
  for (const v of m.values()) v.sort((a, b) => a - b);
  return m;
}

// ---------------------------------------------------------------------------
// the pattern table
// ---------------------------------------------------------------------------

interface Ctx extends WinContext {
  d: Decomp;
  tiles: Tile[]; // 14-tile shape view
  all: Tile[]; // every physical tile, kongs counted as four
  counts: number[]; // counts of `all`
  concealedSets: MSet[];
  concealedPungCount: number;
  meldedCount: number; // melds exposed to the table (concealed kongs excluded)
}

type Rule = { name: string; points: number; test: (c: Ctx) => boolean };

// -- 88 ---------------------------------------------------------------------

const GREEN: Tile[] = [10, 11, 12, 14, 16, DRAGON_G]; // b2 b3 b4 b6 b8 + green

const R88: Rule[] = [
  {
    name: 'Big Four Winds',
    points: 88,
    test: (c) => pungs(c.d).filter((s) => isWind(s.tile)).length === 4,
  },
  {
    name: 'Big Three Dragons',
    points: 88,
    test: (c) => pungs(c.d).filter((s) => isDragon(s.tile)).length === 3,
  },
  { name: 'All Green', points: 88, test: (c) => c.tiles.every((t) => GREEN.includes(t)) },
  {
    name: 'Nine Gates',
    points: 88,
    test: (c) => {
      if (c.meldedCount > 0) return false;
      const { suits, honors } = suitsUsed(c.tiles);
      if (honors || suits.size !== 1) return false;
      const base = suitBase(c.tiles[0]);
      const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      const got = need.map((_, i) => c.counts[base + i]);
      let extra = 0;
      for (let i = 0; i < 9; i++) {
        if (got[i] < need[i]) return false;
        extra += got[i] - need[i];
      }
      return extra === 1;
    },
  },
  { name: 'Four Kongs', points: 88, test: (c) => kongs(c.d).length === 4 },
];

// -- 64 ---------------------------------------------------------------------

const R64: Rule[] = [
  { name: 'All Terminals', points: 64, test: (c) => c.tiles.every(isTerminal) },
  {
    name: 'Little Four Winds',
    points: 64,
    test: (c) => pungs(c.d).filter((s) => isWind(s.tile)).length === 3 && isWind(c.d.pair),
  },
  {
    name: 'Little Three Dragons',
    points: 64,
    test: (c) => pungs(c.d).filter((s) => isDragon(s.tile)).length === 2 && isDragon(c.d.pair),
  },
  { name: 'All Honors', points: 64, test: (c) => c.tiles.every(isHonor) },
  { name: 'Four Concealed Pungs', points: 64, test: (c) => c.concealedPungCount === 4 },
  {
    name: 'Pure Terminal Chows',
    points: 64,
    test: (c) => {
      const cs = chows(c.d);
      if (cs.length !== 4) return false;
      const { suits, honors } = suitsUsed(c.tiles);
      if (honors || suits.size !== 1) return false;
      const rs = cs.map((s) => rankOf(s.tile)).sort((a, b) => a - b);
      return rs[0] === 1 && rs[1] === 1 && rs[2] === 7 && rs[3] === 7 && rankOf(c.d.pair) === 5;
    },
  },
];

// -- 48 ---------------------------------------------------------------------

const R48: Rule[] = [
  {
    name: 'Quadruple Chow',
    points: 48,
    test: (c) => {
      const cs = chows(c.d);
      return cs.length === 4 && cs.every((s) => s.tile === cs[0].tile);
    },
  },
  {
    name: 'Four Pure Shifted Pungs',
    points: 48,
    test: (c) => {
      const ps = pungs(c.d);
      if (ps.length !== 4 || ps.some((s) => isHonor(s.tile))) return false;
      if (new Set(ps.map((s) => suitOf(s.tile))).size !== 1) return false;
      const rs = ps.map((s) => rankOf(s.tile)).sort((a, b) => a - b);
      return rs.every((r, i) => r === rs[0] + i);
    },
  },
];

// -- 32 ---------------------------------------------------------------------

const R32: Rule[] = [
  {
    name: 'Four Pure Shifted Chows',
    points: 32,
    test: (c) => {
      const cs = chows(c.d);
      if (cs.length !== 4) return false;
      if (new Set(cs.map((s) => suitOf(s.tile))).size !== 1) return false;
      const rs = cs.map((s) => rankOf(s.tile)).sort((a, b) => a - b);
      const step = rs[1] - rs[0];
      return (step === 1 || step === 2) && rs.every((r, i) => r === rs[0] + step * i);
    },
  },
  { name: 'Three Kongs', points: 32, test: (c) => kongs(c.d).length === 3 },
  {
    name: 'All Terminals and Honors',
    points: 32,
    test: (c) => c.tiles.every(isTerminalOrHonor),
  },
];

// -- 24 ---------------------------------------------------------------------

const R24: Rule[] = [
  {
    name: 'All Even Pungs',
    points: 24,
    test: (c) =>
      pungs(c.d).length === 4 &&
      c.tiles.every((t) => !isHonor(t) && rankOf(t) % 2 === 0),
  },
  {
    name: 'Full Flush',
    points: 24,
    test: (c) => {
      const { suits, honors } = suitsUsed(c.tiles);
      return !honors && suits.size === 1;
    },
  },
  {
    name: 'Pure Triple Chow',
    points: 24,
    test: (c) => {
      const cs = chows(c.d);
      for (let i = 0; i < cs.length; i++) {
        if (cs.filter((s) => s.tile === cs[i].tile).length >= 3) return true;
      }
      return false;
    },
  },
  {
    name: 'Pure Shifted Pungs',
    points: 24,
    test: (c) => {
      const ps = pungs(c.d).filter((s) => !isHonor(s.tile));
      for (const g of groupBySuit(ps)) {
        const rs = g.sort((a, b) => a - b);
        for (let i = 0; i + 2 < rs.length; i++) {
          if (rs[i + 1] === rs[i] + 1 && rs[i + 2] === rs[i] + 2) return true;
        }
      }
      return false;
    },
  },
  {
    name: 'Upper Tiles',
    points: 24,
    test: (c) => c.tiles.every((t) => !isHonor(t) && rankOf(t) >= 7),
  },
  {
    name: 'Middle Tiles',
    points: 24,
    test: (c) => c.tiles.every((t) => !isHonor(t) && rankOf(t) >= 4 && rankOf(t) <= 6),
  },
  {
    name: 'Lower Tiles',
    points: 24,
    test: (c) => c.tiles.every((t) => !isHonor(t) && rankOf(t) <= 3),
  },
];

function groupBySuit(sets: MSet[]): number[][] {
  const m = new Map<number, number[]>();
  for (const s of sets) {
    const k = suitOf(s.tile);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(rankOf(s.tile));
  }
  return [...m.values()];
}

// -- 16 ---------------------------------------------------------------------

const R16: Rule[] = [
  {
    name: 'Pure Straight',
    points: 16,
    test: (c) => {
      for (const [, rs] of chowGroupsBySuit(chows(c.d))) {
        if (rs.includes(1) && rs.includes(4) && rs.includes(7)) return true;
      }
      return false;
    },
  },
  {
    name: 'Three-Suited Terminal Chows',
    points: 16,
    test: (c) => {
      const g = chowGroupsBySuit(chows(c.d));
      if (g.size !== 2) return false;
      const pairSuit = isHonor(c.d.pair) ? -1 : suitOf(c.d.pair);
      if (rankOf(c.d.pair) !== 5 || g.has(pairSuit)) return false;
      for (const rs of g.values()) if (!(rs.includes(1) && rs.includes(7))) return false;
      return chows(c.d).length === 4;
    },
  },
  {
    name: 'Pure Shifted Chows',
    points: 16,
    test: (c) => {
      for (const [, rs] of chowGroupsBySuit(chows(c.d))) {
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++)
            for (let k = j + 1; k < rs.length; k++) {
              const step = rs[j] - rs[i];
              if ((step === 1 || step === 2) && rs[k] - rs[j] === step) return true;
            }
      }
      return false;
    },
  },
  {
    name: 'All Fives',
    points: 16,
    test: (c) =>
      c.d.sets.every((s) => setTiles(s).some((t) => !isHonor(t) && rankOf(t) === 5)) &&
      rankOf(c.d.pair) === 5 &&
      !isHonor(c.d.pair),
  },
  {
    name: 'Triple Pung',
    points: 16,
    test: (c) => {
      const ps = pungs(c.d).filter((s) => !isHonor(s.tile));
      for (const r of new Set(ps.map((s) => rankOf(s.tile)))) {
        if (new Set(ps.filter((s) => rankOf(s.tile) === r).map((s) => suitOf(s.tile))).size === 3)
          return true;
      }
      return false;
    },
  },
  { name: 'Three Concealed Pungs', points: 16, test: (c) => c.concealedPungCount === 3 },
];

// -- 12 ---------------------------------------------------------------------

const R12: Rule[] = [
  {
    name: 'Upper Four',
    points: 12,
    test: (c) => c.tiles.every((t) => !isHonor(t) && rankOf(t) >= 6),
  },
  {
    name: 'Lower Four',
    points: 12,
    test: (c) => c.tiles.every((t) => !isHonor(t) && rankOf(t) <= 4),
  },
  {
    name: 'Big Three Winds',
    points: 12,
    test: (c) => pungs(c.d).filter((s) => isWind(s.tile)).length === 3,
  },
];

// -- 8 ----------------------------------------------------------------------

// Dots 1-5,8,9 / bamboo 2,4,5,6,8,9 / white dragon — the tiles that look the
// same upside down.
const REVERSIBLE: Tile[] = [0, 1, 2, 3, 4, 7, 8, 10, 12, 13, 14, 16, 17, 33];
const REVERSIBLE_SET = new Set<Tile>(REVERSIBLE);

const R8: Rule[] = [
  {
    name: 'Mixed Straight',
    points: 8,
    test: (c) => {
      const cs = chows(c.d);
      for (const a of cs)
        for (const b of cs)
          for (const d of cs) {
            if (rankOf(a.tile) !== 1 || rankOf(b.tile) !== 4 || rankOf(d.tile) !== 7) continue;
            if (new Set([suitOf(a.tile), suitOf(b.tile), suitOf(d.tile)]).size === 3) return true;
          }
      return false;
    },
  },
  {
    name: 'Reversible Tiles',
    points: 8,
    test: (c) => c.tiles.every((t) => REVERSIBLE_SET.has(t)),
  },
  {
    name: 'Mixed Triple Chow',
    points: 8,
    test: (c) => {
      const cs = chows(c.d);
      for (const r of new Set(cs.map((s) => rankOf(s.tile)))) {
        if (new Set(cs.filter((s) => rankOf(s.tile) === r).map((s) => suitOf(s.tile))).size === 3)
          return true;
      }
      return false;
    },
  },
  {
    name: 'Mixed Shifted Pungs',
    points: 8,
    test: (c) => {
      const ps = pungs(c.d).filter((s) => !isHonor(s.tile));
      for (let i = 0; i < ps.length; i++)
        for (let j = 0; j < ps.length; j++)
          for (let k = 0; k < ps.length; k++) {
            if (i === j || j === k || i === k) continue;
            const su = [suitOf(ps[i].tile), suitOf(ps[j].tile), suitOf(ps[k].tile)];
            if (new Set(su).size !== 3) continue;
            const rs = [rankOf(ps[i].tile), rankOf(ps[j].tile), rankOf(ps[k].tile)];
            if (rs[1] === rs[0] + 1 && rs[2] === rs[1] + 1) return true;
          }
      return false;
    },
  },
  { name: 'Last Tile Draw', points: 8, test: (c) => c.lastTile && c.selfDrawn },
  { name: 'Last Tile Claim', points: 8, test: (c) => c.lastTile && !c.selfDrawn },
  { name: 'Out with Replacement Tile', points: 8, test: (c) => c.afterKong },
  { name: 'Robbing the Kong', points: 8, test: (c) => c.robbingKong },
  {
    name: 'Two Concealed Kongs',
    points: 8,
    test: (c) => kongs(c.d).filter((s) => s.concealed).length === 2,
  },
];

// -- 6 ----------------------------------------------------------------------

const R6: Rule[] = [
  { name: 'All Pungs', points: 6, test: (c) => pungs(c.d).length === 4 },
  {
    name: 'Half Flush',
    points: 6,
    test: (c) => {
      const { suits, honors } = suitsUsed(c.tiles);
      return honors && suits.size === 1;
    },
  },
  {
    name: 'Mixed Shifted Chows',
    points: 6,
    test: (c) => {
      const cs = chows(c.d);
      for (let i = 0; i < cs.length; i++)
        for (let j = 0; j < cs.length; j++)
          for (let k = 0; k < cs.length; k++) {
            if (i === j || j === k || i === k) continue;
            const su = [suitOf(cs[i].tile), suitOf(cs[j].tile), suitOf(cs[k].tile)];
            if (new Set(su).size !== 3) continue;
            const rs = [rankOf(cs[i].tile), rankOf(cs[j].tile), rankOf(cs[k].tile)];
            if (rs[1] === rs[0] + 1 && rs[2] === rs[1] + 1) return true;
          }
      return false;
    },
  },
  {
    name: 'All Types',
    points: 6,
    test: (c) => {
      const s = new Set<number>();
      let wind = false;
      let dragon = false;
      for (const t of c.tiles) {
        if (isWind(t)) wind = true;
        else if (isDragon(t)) dragon = true;
        else s.add(suitOf(t));
      }
      return s.size === 3 && wind && dragon;
    },
  },
  {
    name: 'Melded Hand',
    points: 6,
    test: (c) => c.melds.length === 4 && !c.selfDrawn,
  },
  {
    name: 'Two Melded Kongs',
    points: 6,
    test: (c) => {
      const ks = kongs(c.d);
      return ks.length === 2 && ks.some((s) => !s.concealed);
    },
  },
];

// -- 4 ----------------------------------------------------------------------

const R4: Rule[] = [
  {
    name: 'Outside Hand',
    points: 4,
    test: (c) =>
      c.d.sets.every((s) => setTiles(s).some(isTerminalOrHonor)) && isTerminalOrHonor(c.d.pair),
  },
  {
    name: 'Fully Concealed Hand',
    points: 4,
    test: (c) => c.meldedCount === 0 && c.selfDrawn,
  },
  { name: 'Last Tile', points: 4, test: (c) => c.lastOfKind },
];

// -- 2 ----------------------------------------------------------------------

const R2: Rule[] = [
  {
    name: 'Dragon Pung',
    points: 2,
    test: (c) => pungs(c.d).some((s) => isDragon(s.tile)),
  },
  {
    name: 'Prevalent Wind',
    points: 2,
    test: (c) => pungs(c.d).some((s) => s.tile === WIND_E + c.prevalentWind),
  },
  {
    name: 'Seat Wind',
    points: 2,
    test: (c) => pungs(c.d).some((s) => s.tile === WIND_E + c.seatWind),
  },
  {
    name: 'Concealed Hand',
    points: 2,
    test: (c) => c.meldedCount === 0 && !c.selfDrawn,
  },
  {
    name: 'All Chows',
    points: 2,
    test: (c) => chows(c.d).length === 4 && !isHonor(c.d.pair),
  },
  {
    name: 'Tile Hog',
    points: 2,
    test: (c) => {
      for (let t = 0; t < TILE_KINDS; t++) {
        if (c.counts[t] === 4 && !kongs(c.d).some((s) => s.tile === t)) return true;
      }
      return false;
    },
  },
  {
    name: 'Double Pung',
    points: 2,
    test: (c) => {
      const ps = pungs(c.d).filter((s) => !isHonor(s.tile));
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++)
          if (rankOf(ps[i].tile) === rankOf(ps[j].tile)) return true;
      return false;
    },
  },
  { name: 'Two Concealed Pungs', points: 2, test: (c) => c.concealedPungCount === 2 },
  {
    name: 'Concealed Kong',
    points: 2,
    test: (c) => kongs(c.d).filter((s) => s.concealed).length === 1,
  },
  { name: 'All Simples', points: 2, test: (c) => c.tiles.every(isSimple) },
];

// -- 1 ----------------------------------------------------------------------

const R1: Rule[] = [
  {
    name: 'Pure Double Chow',
    points: 1,
    test: (c) => {
      const cs = chows(c.d);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) if (cs[i].tile === cs[j].tile) return true;
      return false;
    },
  },
  {
    name: 'Mixed Double Chow',
    points: 1,
    test: (c) => {
      const cs = chows(c.d);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++)
          if (rankOf(cs[i].tile) === rankOf(cs[j].tile) && suitOf(cs[i].tile) !== suitOf(cs[j].tile))
            return true;
      return false;
    },
  },
  {
    name: 'Short Straight',
    points: 1,
    test: (c) => {
      for (const [, rs] of chowGroupsBySuit(chows(c.d))) {
        for (let i = 0; i < rs.length; i++)
          for (let j = 0; j < rs.length; j++) if (rs[j] === rs[i] + 3) return true;
      }
      return false;
    },
  },
  {
    name: 'Two Terminal Chows',
    points: 1,
    test: (c) => {
      for (const [, rs] of chowGroupsBySuit(chows(c.d))) {
        if (rs.includes(1) && rs.includes(7)) return true;
      }
      return false;
    },
  },
  {
    name: 'Pung of Terminals or Honors',
    points: 1,
    test: (c) =>
      pungs(c.d).some((s) => isTerminal(s.tile) || (isHonor(s.tile) && !isDragon(s.tile))),
  },
  {
    name: 'Melded Kong',
    points: 1,
    test: (c) => kongs(c.d).some((s) => !s.concealed),
  },
  {
    name: 'One Voided Suit',
    points: 1,
    test: (c) => suitsUsed(c.tiles).suits.size === 2,
  },
  { name: 'No Honors', points: 1, test: (c) => c.tiles.every((t) => !isHonor(t)) },
  { name: 'Edge Wait', points: 1, test: (c) => waitShape(c) === 'edge' },
  { name: 'Closed Wait', points: 1, test: (c) => waitShape(c) === 'closed' },
  { name: 'Single Wait', points: 1, test: (c) => waitShape(c) === 'single' },
  { name: 'Self-Drawn', points: 1, test: (c) => c.selfDrawn },
];

/**
 * How the winning tile completed the hand. Only meaningful when exactly one
 * set (or the pair) could have been waiting on it.
 */
function waitShape(c: Ctx): 'edge' | 'closed' | 'single' | null {
  if (!c.soleWait()) return null;
  if (c.d.pair === c.winTile) {
    // Single wait only if no set in the decomposition also used the win tile.
    const used = c.d.sets.some((s) => setTiles(s).includes(c.winTile) && s.concealed);
    if (!used) return 'single';
  }
  const cands = c.d.sets.filter(
    (s) => s.concealed && s.kind === 'chow' && setTiles(s).includes(c.winTile),
  );
  if (cands.length !== 1 || c.d.pair === c.winTile) return null;
  const s = cands[0];
  const r = rankOf(c.winTile);
  const low = rankOf(s.tile);
  if (r === low + 1) return 'closed';
  if ((low === 1 && r === 3) || (low === 7 && r === 7)) return 'edge';
  return null;
}

const ALL_RULES: Rule[] = [
  ...R88,
  ...R64,
  ...R48,
  ...R32,
  ...R24,
  ...R16,
  ...R12,
  ...R8,
  ...R6,
  ...R4,
  ...R2,
  ...R1,
];

/**
 * Non-repeat: a scored pattern removes the lesser patterns it already implies.
 * Not the full official table, but it covers the cases that come up in play.
 */
const EXCLUDES: Record<string, string[]> = {
  'Big Four Winds': ['Big Three Winds', 'Little Four Winds', 'All Pungs', 'Pung of Terminals or Honors', 'Prevalent Wind', 'Seat Wind'],
  'Big Three Dragons': ['Little Three Dragons', 'Dragon Pung'],
  'All Green': ['Half Flush', 'One Voided Suit'],
  'Nine Gates': ['Full Flush', 'Pure Double Chow', 'Pure Shifted Chows', 'Concealed Hand', 'No Honors', 'One Voided Suit', 'Pung of Terminals or Honors'],
  'Four Kongs': ['Three Kongs', 'Two Melded Kongs', 'Two Concealed Kongs', 'Melded Kong', 'Concealed Kong', 'All Pungs', 'Single Wait'],
  'All Terminals': ['All Terminals and Honors', 'Outside Hand', 'All Pungs', 'No Honors', 'Pung of Terminals or Honors', 'Double Pung'],
  'Little Four Winds': ['Big Three Winds', 'Prevalent Wind', 'Seat Wind', 'Pung of Terminals or Honors'],
  'Little Three Dragons': ['Dragon Pung'],
  'All Honors': ['All Terminals and Honors', 'Outside Hand', 'All Pungs', 'Pung of Terminals or Honors'],
  'Four Concealed Pungs': ['Three Concealed Pungs', 'Two Concealed Pungs', 'All Pungs', 'Concealed Hand', 'Fully Concealed Hand'],
  'Pure Terminal Chows': ['Full Flush', 'All Chows', 'Pure Double Chow', 'Two Terminal Chows', 'No Honors', 'One Voided Suit'],
  'Quadruple Chow': ['Pure Triple Chow', 'Pure Double Chow', 'Tile Hog', 'Pure Shifted Chows'],
  'Four Pure Shifted Pungs': ['Pure Shifted Pungs', 'All Pungs'],
  'Four Pure Shifted Chows': ['Pure Shifted Chows', 'All Chows'],
  'Three Kongs': ['Two Melded Kongs', 'Two Concealed Kongs', 'Melded Kong', 'Concealed Kong'],
  'All Terminals and Honors': ['Outside Hand', 'All Pungs', 'Pung of Terminals or Honors'],
  'All Even Pungs': ['All Pungs', 'All Simples', 'No Honors'],
  'Full Flush': ['One Voided Suit', 'No Honors'],
  'Pure Triple Chow': ['Pure Double Chow'],
  'Pure Shifted Pungs': [],
  'Upper Tiles': ['Upper Four', 'No Honors'],
  'Middle Tiles': ['All Simples', 'No Honors'],
  'Lower Tiles': ['Lower Four', 'No Honors'],
  'Pure Straight': ['Short Straight', 'Two Terminal Chows'],
  'Three-Suited Terminal Chows': ['Mixed Double Chow', 'Two Terminal Chows', 'All Chows', 'No Honors'],
  'All Fives': ['All Simples', 'No Honors'],
  'Three Concealed Pungs': ['Two Concealed Pungs'],
  'Upper Four': ['No Honors'],
  'Lower Four': ['No Honors'],
  'Big Three Winds': ['Pung of Terminals or Honors'],
  'Mixed Straight': ['Short Straight'],
  'Reversible Tiles': ['One Voided Suit'],
  'Mixed Triple Chow': ['Mixed Double Chow'],
  'Mixed Shifted Pungs': [],
  'Two Concealed Kongs': ['Concealed Kong', 'Two Concealed Pungs'],
  'All Pungs': [],
  'Half Flush': ['One Voided Suit'],
  'Melded Hand': ['Concealed Hand'],
  'Two Melded Kongs': ['Melded Kong'],
  'Fully Concealed Hand': ['Self-Drawn', 'Concealed Hand'],
  'Two Concealed Pungs': [],
  'Seven Pairs': ['Concealed Hand', 'Single Wait'],
  'Seven Shifted Pairs': ['Seven Pairs', 'Full Flush', 'Concealed Hand', 'Single Wait', 'No Honors', 'One Voided Suit'],
  'Thirteen Orphans': ['All Types', 'Concealed Hand', 'Single Wait'],
};

function applyExclusions(fans: Fan[]): Fan[] {
  const dead = new Set<string>();
  for (const f of fans) for (const x of EXCLUDES[f.name] ?? []) dead.add(x);
  return fans.filter((f) => !dead.has(f.name));
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function scoreDecomp(ctx: WinContext, d: Decomp, meldedCount: number): Fan[] {
  const all = allTilesOf(d, d.pair);
  const counts = new Array<number>(TILE_KINDS).fill(0);
  for (const t of all) counts[t]++;
  const concealedSets = d.sets.filter((s) => s.concealed);
  const c: Ctx = {
    ...ctx,
    d,
    tiles: shapeTiles(d),
    all,
    counts,
    concealedSets,
    concealedPungCount: concealedSets.filter(isPungLike).length,
    meldedCount,
  };
  const fans: Fan[] = [];
  for (const r of ALL_RULES) if (r.test(c)) fans.push({ name: r.name, points: r.points });
  return applyExclusions(fans);
}

const sum = (fans: Fan[]): number => fans.reduce((a, f) => a + f.points, 0);

export function scoreHand(ctx: WinContext): ScoreResult {
  const counts = new Array<number>(TILE_KINDS).fill(0);
  for (const t of ctx.concealed) counts[t]++;

  // Concealed pungs stay concealed only when completed by a draw; a pung
  // finished by the winning discard counts as melded for Concealed Pung fans.
  const meldedCount = ctx.melds.filter((m) => m.from !== null).length;

  if (meldedCount === 0 && isThirteenOrphans(counts)) {
    const fans = applyExclusions([
      { name: 'Thirteen Orphans', points: 88 },
      ...(ctx.selfDrawn ? [{ name: 'Self-Drawn', points: 1 }] : []),
      { name: 'All Types', points: 6 },
      ...(ctx.lastOfKind ? [{ name: 'Last Tile', points: 4 }] : []),
    ]);
    return { fans, total: sum(fans), shape: 'thirteen-orphans' };
  }

  if (ctx.melds.length === 0 && isSevenPairs(counts)) {
    const ranks: number[] = [];
    const seenSuits = new Set<number>();
    let anyHonor = false;
    for (let t = 0; t < TILE_KINDS; t++) {
      if (counts[t] !== 2) continue;
      if (isHonor(t)) anyHonor = true;
      else seenSuits.add(suitOf(t));
      ranks.push(rankOf(t));
    }
    ranks.sort((a, b) => a - b);
    const shifted = !anyHonor && seenSuits.size === 1 && ranks.every((r, i) => r === ranks[0] + i);
    const base: Fan[] = shifted
      ? [{ name: 'Seven Shifted Pairs', points: 88 }]
      : [{ name: 'Seven Pairs', points: 24 }];
    const extra: Fan[] = [];
    const tiles = ctx.concealed;
    if (tiles.every(isSimple)) extra.push({ name: 'All Simples', points: 2 });
    if (tiles.every(isTerminalOrHonor)) extra.push({ name: 'All Terminals and Honors', points: 32 });
    if (tiles.every((t) => !isHonor(t))) extra.push({ name: 'No Honors', points: 1 });
    const { suits, honors } = suitsUsed(tiles);
    if (!honors && suits.size === 1) extra.push({ name: 'Full Flush', points: 24 });
    else if (honors && suits.size === 1) extra.push({ name: 'Half Flush', points: 6 });
    else if (suits.size === 2) extra.push({ name: 'One Voided Suit', points: 1 });
    if (ctx.selfDrawn) extra.push({ name: 'Fully Concealed Hand', points: 4 });
    else extra.push({ name: 'Concealed Hand', points: 2 });
    if (ctx.lastOfKind) extra.push({ name: 'Last Tile', points: 4 });
    if (ctx.afterKong) extra.push({ name: 'Out with Replacement Tile', points: 8 });
    if (ctx.robbingKong) extra.push({ name: 'Robbing the Kong', points: 8 });
    if (ctx.lastTile)
      extra.push({ name: ctx.selfDrawn ? 'Last Tile Draw' : 'Last Tile Claim', points: 8 });
    const fans = applyExclusions([...base, ...extra]);
    return { fans, total: sum(fans), shape: 'seven-pairs' };
  }

  const need = 4 - ctx.melds.length;
  const options = decompose(counts, need);
  if (options.length === 0) return { fans: [], total: 0, shape: null };

  const meldSets: MSet[] = ctx.melds.map((m) => ({
    kind: m.kind,
    tile: m.tile,
    concealed: m.from === null,
  }));

  let best: Fan[] = [];
  let bestTotal = -1;
  for (const opt of options) {
    const d: Decomp = { sets: [...opt.sets, ...meldSets], pair: opt.pair };
    // A pung completed by someone else's discard is not a concealed pung.
    if (!ctx.selfDrawn) {
      for (const s of d.sets) {
        if (s.concealed && isPungLike(s) && s.kind !== 'kong' && s.tile === ctx.winTile) {
          s.concealed = false;
        }
      }
    }
    const fans = scoreDecomp(ctx, d, meldedCount);
    const total = sum(fans);
    if (total > bestTotal) {
      bestTotal = total;
      best = fans;
    }
  }

  if (bestTotal === 0) {
    best = [{ name: 'Chicken Hand', points: 8 }];
    bestTotal = 8;
  }
  best.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return { fans: best, total: bestTotal, shape: 'standard' };
}

export const MIN_POINTS = 8;

/** True when this hand is legal to declare under the 8-point minimum. */
export function canDeclareWin(ctx: WinContext): boolean {
  const r = scoreHand(ctx);
  return r.shape !== null && r.total >= MIN_POINTS;
}

export { ORPHANS, REVERSIBLE };
