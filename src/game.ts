import {
  type Tile,
  type Seat,
  SEAT_NAMES as WIND_NAMES,
  buildWall,
  sortTiles,
  tileName,
  canStartChow,
  suitOf,
} from './tiles.js';
import type { Meld } from './meld.js';
import { type WinContext, scoreHand, MIN_POINTS } from './score.js';
import { waits } from './shanten.js';

export type ClaimKind = 'win' | 'kong' | 'pung' | 'chow';

export interface Claim {
  kind: ClaimKind;
  seat: Seat;
  /** For a chow: the lowest tile of the run. Otherwise the claimed tile. */
  tile: Tile;
}

export type SelfAction =
  | { kind: 'discard'; tile: Tile }
  | { kind: 'concealed-kong'; tile: Tile }
  | { kind: 'added-kong'; tile: Tile }
  | { kind: 'win' };

export interface Player {
  seat: Seat;
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  score: number;
}

export type Phase = 'turn' | 'claim' | 'over';

export interface WinSummary {
  winner: Seat;
  from: Seat | null;
  tile: Tile;
  fans: { name: string; points: number }[];
  total: number;
  deltas: number[];
}

export interface GameState {
  wall: Tile[];
  head: number; // next tile drawn from the front
  tail: number; // next kong replacement drawn from the back
  players: Player[];
  dealer: Seat;
  prevalentWind: number;
  turn: Seat;
  phase: Phase;
  /** The tile just drawn by `turn`, still logically part of their hand. */
  drawn: Tile | null;
  drawnAfterKong: boolean;
  lastDiscard: { tile: Tile; from: Seat } | null;
  /** Set while an added kong is exposed and can still be robbed. */
  robbable: { tile: Tile; from: Seat } | null;
  log: string[];
  result: WinSummary | null;
  drawnGame: boolean;
  handNo: number;
  /** Display name per seat; the human is always 'You'. Kept for the whole game. */
  names: string[];
}

const BOT_NAMES = [
  'Mei', 'Hiro', 'Ana', 'Wei', 'Lena', 'Omar', 'Yuki', 'Ravi', 'Sofia', 'Jin',
  'Nadia', 'Kofi', 'Ines', 'Theo', 'Priya', 'Lars', 'Amara', 'Diego', 'Hana', 'Felix',
];

/** 'You' plus three different bot names, drawn at random. */
export function randomNames(rand: () => number = Math.random): string[] {
  const pool = BOT_NAMES.slice();
  const out = ['You'];
  for (let i = 0; i < 3; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export const nameOf = (g: GameState, seat: Seat): string => g.names[seat];

export const HUMAN: Seat = 0;

const next = (s: Seat): Seat => ((s + 1) % 4) as Seat;
const leftOf = (s: Seat): Seat => ((s + 3) % 4) as Seat;

export const tilesLeft = (g: GameState): number => g.tail - g.head + 1;

/** The whole of a player's tiles including the tile they just drew. */
export function handOf(g: GameState, seat: Seat): Tile[] {
  const p = g.players[seat];
  return g.turn === seat && g.drawn !== null ? sortTiles([...p.hand, g.drawn]) : p.hand;
}

function countInMelds(g: GameState, tile: Tile): number {
  let n = 0;
  for (const p of g.players) {
    for (const m of p.melds) {
      if (m.kind === 'chow') {
        if (tile >= m.tile && tile <= m.tile + 2) n++;
      } else if (m.tile === tile) n += m.kind === 'kong' ? 4 : 3;
    }
  }
  return n;
}

function countInDiscards(g: GameState, tile: Tile): number {
  let n = 0;
  for (const p of g.players) for (const t of p.discards) if (t === tile) n++;
  return n;
}

export function newGame(
  dealer: Seat = 0,
  prevalentWind = 0,
  handNo = 1,
  scores = [0, 0, 0, 0],
  names = randomNames(),
): GameState {
  const wall = buildWall(Math.random);
  const players: Player[] = ([0, 1, 2, 3] as Seat[]).map((seat) => ({
    seat,
    hand: [],
    melds: [],
    discards: [],
    score: scores[seat],
  }));
  let head = 0;
  for (let round = 0; round < 13; round++) {
    for (let i = 0; i < 4; i++) {
      const seat = ((dealer + i) % 4) as Seat;
      players[seat].hand.push(wall[head++]);
    }
  }
  for (const p of players) p.hand = sortTiles(p.hand);

  const g: GameState = {
    wall,
    head,
    tail: wall.length - 1,
    players,
    dealer,
    prevalentWind,
    turn: dealer,
    phase: 'turn',
    drawn: null,
    drawnAfterKong: false,
    lastDiscard: null,
    robbable: null,
    log: [`Hand ${handNo} — ${WIND_NAMES[prevalentWind]} round, ${names[dealer]} deals.`],
    result: null,
    drawnGame: false,
    handNo,
    names,
  };
  draw(g);
  return g;
}

export function draw(g: GameState, fromTail = false): void {
  if (tilesLeft(g) <= 0) {
    g.phase = 'over';
    g.drawnGame = true;
    g.log.push('Wall exhausted — drawn game.');
    return;
  }
  g.drawn = fromTail ? g.wall[g.tail--] : g.wall[g.head++];
  g.drawnAfterKong = fromTail;
}

// ---------------------------------------------------------------------------
// win checking
// ---------------------------------------------------------------------------

export function winContext(
  g: GameState,
  seat: Seat,
  winTile: Tile,
  selfDrawn: boolean,
  robbing = false,
): WinContext {
  const p = g.players[seat];
  // Last Tile asks whether the other three copies are visible to everyone, so
  // only melds and discards count. The winning tile itself sits in the discard
  // pile while the claim is open; don't count it against itself.
  const discardPileHoldsIt =
    !selfDrawn && !robbing && g.lastDiscard !== null && g.lastDiscard.tile === winTile;
  const othersSeen =
    countInMelds(g, winTile) + countInDiscards(g, winTile) - (discardPileHoldsIt ? 1 : 0);

  // Edge, Closed and Single Wait only score when the hand had exactly one
  // winning tile. Worked out on demand and cached — the search is expensive
  // and almost every call here is a legality check that never needs it.
  let sole: boolean | null = null;
  const soleWait = (): boolean => {
    if (sole === null) {
      const counts = new Array<number>(34).fill(0);
      for (const t of p.hand) counts[t]++;
      sole = waits(counts, p.melds.length).length === 1;
    }
    return sole;
  };

  return {
    soleWait,
    concealed: sortTiles([...p.hand, winTile]),
    melds: p.melds,
    winTile,
    selfDrawn,
    seatWind: (seat - g.dealer + 4) % 4,
    prevalentWind: g.prevalentWind,
    lastTile: tilesLeft(g) === 0,
    afterKong: selfDrawn && g.drawnAfterKong,
    robbingKong: robbing,
    lastOfKind: othersSeen === 3,
  };
}

export function winCheck(
  g: GameState,
  seat: Seat,
  winTile: Tile,
  selfDrawn: boolean,
  robbing = false,
): { ok: boolean; ctx: WinContext; fans: { name: string; points: number }[]; total: number } {
  const ctx = winContext(g, seat, winTile, selfDrawn, robbing);
  const r = scoreHand(ctx);
  return { ok: r.shape !== null && r.total >= MIN_POINTS, ctx, fans: r.fans, total: r.total };
}

// ---------------------------------------------------------------------------
// legal moves
// ---------------------------------------------------------------------------

/**
 * What `seat` may do on their own turn. They are holding 14 tiles' worth —
 * either from a draw, or from having just claimed a discard into a meld.
 */
export function selfActions(g: GameState, seat: Seat): SelfAction[] {
  if (g.phase !== 'turn' || g.turn !== seat || g.robbable) return [];
  const p = g.players[seat];
  const full = handOf(g, seat);
  if (full.length !== 14 - p.melds.length * 3) return [];

  const out: SelfAction[] = [];
  // Only a freshly drawn tile can complete a self-drawn win; a tile claimed
  // into a meld was already offered as a win claim.
  if (g.drawn !== null && winCheck(g, seat, g.drawn, true).ok) out.push({ kind: 'win' });

  const counts = new Map<Tile, number>();
  for (const t of full) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [t, n] of counts) if (n === 4) out.push({ kind: 'concealed-kong', tile: t });
  for (const m of p.melds) {
    if (m.kind === 'pung' && full.includes(m.tile)) out.push({ kind: 'added-kong', tile: m.tile });
  }
  for (const t of new Set(full)) out.push({ kind: 'discard', tile: t });
  return out;
}

/** What `seat` may claim from the tile just discarded (or a robbable kong). */
export function claimsFor(g: GameState, seat: Seat): Claim[] {
  const out: Claim[] = [];
  if (g.robbable && g.robbable.from !== seat) {
    if (winCheck(g, seat, g.robbable.tile, false, true).ok) {
      out.push({ kind: 'win', seat, tile: g.robbable.tile });
    }
    return out;
  }
  if (g.phase !== 'claim' || !g.lastDiscard || g.lastDiscard.from === seat) return out;
  const { tile, from } = g.lastDiscard;
  const hand = g.players[seat].hand;
  const n = hand.filter((t) => t === tile).length;

  if (winCheck(g, seat, tile, false).ok) out.push({ kind: 'win', seat, tile });
  if (n >= 3) out.push({ kind: 'kong', seat, tile });
  if (n >= 2) out.push({ kind: 'pung', seat, tile });
  if (from === leftOf(seat) && suitOf(tile) < 3) {
    for (const start of [tile - 2, tile - 1, tile]) {
      if (!canStartChow(start)) continue;
      const needed = [start, start + 1, start + 2].filter((t) => t !== tile);
      if (needed.every((t) => hand.includes(t)) && suitOf(start) === suitOf(tile)) {
        out.push({ kind: 'chow', seat, tile: start });
      }
    }
  }
  return out;
}

const PRIORITY: Record<ClaimKind, number> = { win: 3, kong: 2, pung: 2, chow: 1 };

/** Highest-priority claim; ties break by seat order after the discarder. */
export function bestClaim(claims: Claim[], from: Seat): Claim | null {
  let best: Claim | null = null;
  let bestKey = -1;
  for (const c of claims) {
    const dist = (c.seat - from + 4) % 4;
    const key = PRIORITY[c.kind] * 10 + (4 - dist);
    if (key > bestKey) {
      bestKey = key;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------

function take(hand: Tile[], tile: Tile, n = 1): void {
  for (let i = 0; i < n; i++) {
    const idx = hand.indexOf(tile);
    if (idx >= 0) hand.splice(idx, 1);
  }
}

/** Fold the drawn tile back into the hand so the hand is a plain 14 tiles. */
function absorb(g: GameState): void {
  if (g.drawn === null) return;
  g.players[g.turn].hand = sortTiles([...g.players[g.turn].hand, g.drawn]);
  g.drawn = null;
}

export function applySelf(g: GameState, action: SelfAction): void {
  const seat = g.turn;
  const p = g.players[seat];

  if (action.kind === 'win') {
    const tile = g.drawn!;
    finishWin(g, seat, null, tile, true, false);
    return;
  }

  if (action.kind === 'concealed-kong') {
    absorb(g);
    take(p.hand, action.tile, 4);
    p.melds.push({ kind: 'kong', tile: action.tile, concealed: true, from: null });
    g.log.push(`${nameOf(g, seat)} declares a concealed kong of ${tileName(action.tile)}.`);
    draw(g, true);
    return;
  }

  if (action.kind === 'added-kong') {
    absorb(g);
    take(p.hand, action.tile, 1);
    const m = p.melds.find((x) => x.kind === 'pung' && x.tile === action.tile)!;
    m.kind = 'kong';
    g.log.push(`${nameOf(g, seat)} adds to the pung of ${tileName(action.tile)}.`);
    g.robbable = { tile: action.tile, from: seat };
    return; // the caller resolves robbing before the replacement draw
  }

  // discard
  absorb(g);
  take(p.hand, action.tile, 1);
  p.discards.push(action.tile);
  g.lastDiscard = { tile: action.tile, from: seat };
  g.phase = 'claim';
}

export function finishRobbableKong(g: GameState): void {
  g.robbable = null;
  draw(g, true);
}

export function applyClaim(g: GameState, claim: Claim): void {
  const from = g.robbable ? g.robbable.from : g.lastDiscard!.from;
  const tile = g.robbable ? g.robbable.tile : g.lastDiscard!.tile;
  const p = g.players[claim.seat];

  if (claim.kind === 'win') {
    const robbing = g.robbable !== null;
    if (robbing) {
      const m = g.players[from].melds.find((x) => x.tile === tile && x.kind === 'kong')!;
      m.kind = 'pung';
      g.robbable = null;
    }
    finishWin(g, claim.seat, from, tile, false, robbing);
    return;
  }

  // The claimed tile leaves the discard pile.
  g.players[from].discards.pop();
  g.lastDiscard = null;

  if (claim.kind === 'chow') {
    for (const t of [claim.tile, claim.tile + 1, claim.tile + 2]) if (t !== tile) take(p.hand, t);
    p.melds.push({ kind: 'chow', tile: claim.tile, concealed: false, from });
    g.log.push(`${nameOf(g, claim.seat)} chows ${tileName(tile)}.`);
  } else if (claim.kind === 'pung') {
    take(p.hand, tile, 2);
    p.melds.push({ kind: 'pung', tile, concealed: false, from });
    g.log.push(`${nameOf(g, claim.seat)} pungs ${tileName(tile)}.`);
  } else {
    take(p.hand, tile, 3);
    p.melds.push({ kind: 'kong', tile, concealed: false, from });
    g.log.push(`${nameOf(g, claim.seat)} kongs ${tileName(tile)}.`);
  }

  g.turn = claim.seat;
  g.phase = 'turn';
  g.drawn = null;
  g.drawnAfterKong = false;
  if (claim.kind === 'kong') draw(g, true);
}

export function passClaims(g: GameState): void {
  g.lastDiscard = null;
  g.turn = next(g.turn);
  g.phase = 'turn';
  draw(g);
}

function finishWin(
  g: GameState,
  winner: Seat,
  from: Seat | null,
  tile: Tile,
  selfDrawn: boolean,
  robbing: boolean,
): void {
  const r = winCheck(g, winner, tile, selfDrawn, robbing);
  const deltas = [0, 0, 0, 0];
  if (selfDrawn) {
    for (let s = 0; s < 4; s++) {
      if (s === winner) continue;
      deltas[s] -= r.total + 8;
      deltas[winner] += r.total + 8;
    }
  } else {
    for (let s = 0; s < 4; s++) {
      if (s === winner) continue;
      const pay = s === from ? r.total + 8 : 8;
      deltas[s] -= pay;
      deltas[winner] += pay;
    }
  }
  for (let s = 0; s < 4; s++) g.players[s].score += deltas[s];
  g.result = { winner, from, tile, fans: r.fans, total: r.total, deltas };
  g.phase = 'over';
  g.log.push(
    `${nameOf(g, winner)} wins on ${tileName(tile)} for ${r.total} points${
      from === null ? ' (self-drawn)' : ` off ${nameOf(g, from)}`
    }.`,
  );
}
