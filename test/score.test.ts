import { scoreHand, type WinContext } from '../src/score.js';
import { decompose, isSevenPairs, isThirteenOrphans } from '../src/meld.js';
import { shanten } from '../src/shanten.js';
import { toCounts, buildWall, type Tile } from '../src/tiles.js';
import type { Meld } from '../src/meld.js';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const ctx = (o: Partial<WinContext> & { concealed: Tile[]; winTile: Tile }): WinContext => ({
  melds: [],
  selfDrawn: false,
  seatWind: 0,
  prevalentWind: 0,
  lastTile: false,
  afterKong: false,
  robbingKong: false,
  lastOfKind: false,
  soleWait: () => true,
  ...o,
});

// tile helpers: d(n) dots, b(n) bamboo, c(n) characters
const d = (n: number): Tile => n - 1;
const b = (n: number): Tile => 8 + n;
const c = (n: number): Tile => 17 + n;
const E = 27;
const S = 28;
const W = 29;
const N = 30;
const RED = 31;
const GREEN = 32;
const WHITE = 33;

function fanNames(r: ReturnType<typeof scoreHand>): string[] {
  return r.fans.map((f) => f.name);
}

// --- decomposition ---------------------------------------------------------
{
  const h = [d(1), d(2), d(3), d(4), d(5), d(6), d(7), d(8), d(9), b(1), b(1), b(1), c(2), c(2)];
  check('pure straight decomposes', decompose(toCounts(h), 4).length > 0);
}
{
  const h = [d(1), d(1), d(2), d(2), d(3), d(3), d(4), d(4), d(5), d(5), d(6), d(6), d(7), d(7)];
  check('seven shifted pairs is seven pairs', isSevenPairs(toCounts(h)));
}
{
  const h = [d(1), d(9), b(1), b(9), c(1), c(9), E, S, W, N, RED, GREEN, WHITE, WHITE];
  check('thirteen orphans', isThirteenOrphans(toCounts(h)));
}

// --- shanten ---------------------------------------------------------------
{
  const h = [d(1), d(2), d(3), d(4), d(5), d(6), d(7), d(8), d(9), b(1), b(1), b(1), c(2)];
  check('tenpai reads 0', shanten(toCounts(h), 0) === 0, String(shanten(toCounts(h), 0)));
}
{
  const h = [d(1), d(2), d(3), d(4), d(5), d(6), d(7), d(8), d(9), b(1), b(1), b(1), c(2), c(2)];
  check('complete hand reads -1', shanten(toCounts(h), 0) === -1, String(shanten(toCounts(h), 0)));
}

// --- scoring ---------------------------------------------------------------
{
  // Pure straight + full flush, concealed, self-drawn.
  const h = [d(1), d(2), d(3), d(4), d(5), d(6), d(7), d(8), d(9), d(1), d(1), d(1), d(5), d(5)];
  const r = scoreHand(ctx({ concealed: h, winTile: d(5), selfDrawn: true }));
  const names = fanNames(r);
  check('full flush scored', names.includes('Full Flush'), names.join('/'));
  check('pure straight scored', names.includes('Pure Straight'), names.join('/'));
  check('full flush kills no honors', !names.includes('No Honors'), names.join('/'));
  check('full flush kills one voided suit', !names.includes('One Voided Suit'));
  check('total >= 8', r.total >= 8, String(r.total));
}
{
  // Big Three Dragons.
  const h = [RED, RED, RED, GREEN, GREEN, GREEN, WHITE, WHITE, WHITE, d(2), d(3), d(4), d(9), d(9)];
  const r = scoreHand(ctx({ concealed: h, winTile: d(4) }));
  const names = fanNames(r);
  check('big three dragons', names.includes('Big Three Dragons'), names.join('/'));
  check('dragon pung suppressed', !names.includes('Dragon Pung'), names.join('/'));
  check('big three dragons >= 88', r.total >= 88, String(r.total));
}
{
  // All Honors, four wind pungs -> Big Four Winds.
  const h = [E, E, E, S, S, S, W, W, W, N, N, N, RED, RED];
  const r = scoreHand(ctx({ concealed: h, winTile: RED, selfDrawn: true }));
  const names = fanNames(r);
  check('big four winds', names.includes('Big Four Winds'), names.join('/'));
  check('all honors', names.includes('All Honors'), names.join('/'));
  check('big four winds total high', r.total >= 88 + 64, String(r.total));
}
{
  // Seven pairs, mixed.
  const h = [d(2), d(2), d(5), d(5), b(3), b(3), b(7), b(7), c(1), c(1), c(9), c(9), E, E];
  const r = scoreHand(ctx({ concealed: h, winTile: E }));
  check('seven pairs shape', r.shape === 'seven-pairs', String(r.shape));
  check('seven pairs scored', fanNames(r).includes('Seven Pairs'), fanNames(r).join('/'));
}
{
  // Seven shifted pairs.
  const h = [b(1), b(1), b(2), b(2), b(3), b(3), b(4), b(4), b(5), b(5), b(6), b(6), b(7), b(7)];
  const r = scoreHand(ctx({ concealed: h, winTile: b(7), selfDrawn: true }));
  check('seven shifted pairs', fanNames(r).includes('Seven Shifted Pairs'), fanNames(r).join('/'));
  check('shifted pairs suppresses seven pairs', !fanNames(r).includes('Seven Pairs'));
}
{
  // All chows across all three suits: legal, but nowhere near the 8-point floor.
  const melds: Meld[] = [
    { kind: 'chow', tile: d(2), concealed: false, from: 1 },
    { kind: 'chow', tile: b(3), concealed: false, from: 2 },
    { kind: 'chow', tile: c(7), concealed: false, from: 3 },
  ];
  const r = scoreHand(ctx({ concealed: [d(6), d(7), d(8), b(9), b(9)], winTile: d(6), melds }));
  check('cheap hand is a legal shape', r.shape === 'standard');
  check('cheap hand cannot be declared', r.total < 8, `${r.total} (${fanNames(r).join('/')})`);
}
{
  // Melded hand: all pungs with exposed melds.
  const melds: Meld[] = [
    { kind: 'pung', tile: b(2), concealed: false, from: 1 },
    { kind: 'pung', tile: b(5), concealed: false, from: 2 },
    { kind: 'pung', tile: RED, concealed: false, from: 3 },
  ];
  const r = scoreHand(
    ctx({ concealed: [c(3), c(3), c(3), d(8), d(8)], winTile: c(3), melds }),
  );
  const names = fanNames(r);
  check('all pungs with melds', names.includes('All Pungs'), names.join('/'));
  check('dragon pung with melds', names.includes('Dragon Pung'), names.join('/'));
  check('melded all pungs >= 8', r.total >= 8, String(r.total));
}
{
  // Non-winning shape.
  const h = [d(1), d(3), d(5), d(7), d(9), b(1), b(3), b(5), b(7), b(9), c(1), c(3), c(5), E];
  const r = scoreHand(ctx({ concealed: h, winTile: E }));
  check('garbage hand is not a win', r.shape === null);
}
{
  // Wall integrity.
  const w = buildWall(Math.random);
  const cs = toCounts(w);
  check('wall is 136 tiles', w.length === 136);
  check('every kind appears four times', cs.every((n) => n === 4));
}
{
  // Chicken hand: a legal shape that matches no pattern at all.
  const melds: Meld[] = [
    { kind: 'chow', tile: d(2), concealed: false, from: 1 },
    { kind: 'chow', tile: b(3), concealed: false, from: 2 },
    { kind: 'chow', tile: c(7), concealed: false, from: 3 },
  ];
  const r = scoreHand(ctx({ concealed: [d(6), d(7), d(8), S, S], winTile: d(6), melds }));
  check('chicken hand falls back to 8', r.total === 8, `${r.total} (${fanNames(r).join('/')})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
