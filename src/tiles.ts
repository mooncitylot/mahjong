// Tile model.
//
// A tile is an integer 0..33:
//   0..8   dots      1..9
//   9..17  bamboo    1..9
//   18..26 characters 1..9
//   27..30 winds     E S W N
//   31..33 dragons   red(zhong) green(fa) white(bai)

export type Tile = number;

export const TILE_KINDS = 34;

export const DOTS = 0;
export const BAMBOO = 9;
export const CHARS = 18;
export const WIND_E = 27;
export const WIND_S = 28;
export const WIND_W = 29;
export const WIND_N = 30;
export const DRAGON_R = 31;
export const DRAGON_G = 32;
export const DRAGON_W = 33;

/** 0 dots, 1 bamboo, 2 characters, 3 honors */
export const suitOf = (t: Tile): number => (t < 9 ? 0 : t < 18 ? 1 : t < 27 ? 2 : 3);

/** 1..9 for suited tiles; 1..4 winds; 1..3 dragons */
export const rankOf = (t: Tile): number => (t < 27 ? (t % 9) + 1 : t < 31 ? t - 26 : t - 30);

export const isSuited = (t: Tile): boolean => t < 27;
export const isHonor = (t: Tile): boolean => t >= 27;
export const isWind = (t: Tile): boolean => t >= 27 && t < 31;
export const isDragon = (t: Tile): boolean => t >= 31;
export const isTerminal = (t: Tile): boolean => t < 27 && (t % 9 === 0 || t % 9 === 8);
export const isSimple = (t: Tile): boolean => t < 27 && !isTerminal(t);
export const isTerminalOrHonor = (t: Tile): boolean => isHonor(t) || isTerminal(t);

/** First tile of the suit `t` belongs to. Honors return 27. */
export const suitBase = (t: Tile): number => (t < 27 ? t - (t % 9) : 27);

/** Can a chow start at `t`? (suited, rank 1..7) */
export const canStartChow = (t: Tile): boolean => t < 27 && t % 9 <= 6;

export type Seat = 0 | 1 | 2 | 3; // 0 = East, 1 = South, 2 = West, 3 = North
export const SEAT_NAMES = ['East', 'South', 'West', 'North'] as const;
export const seatWindTile = (s: Seat): Tile => WIND_E + s;

const SUIT_MARK = ['○', '│', '萬']; // ○ │ 萬
const HONOR_GLYPH = ['東', '南', '西', '北', '中', '發', '白']; // 東南西北中發白

/** Big glyph shown on the tile face. */
export function tileFace(t: Tile): string {
  return isHonor(t) ? HONOR_GLYPH[t - 27] : String(rankOf(t));
}

/** Small suit mark under the face. Honors have none. */
export function tileMark(t: Tile): string {
  return isHonor(t) ? '' : SUIT_MARK[suitOf(t)];
}

const SUIT_LABEL = ['dot', 'bam', 'char', 'honor'];

/** Plain text name, for logs and accessibility. */
export function tileName(t: Tile): string {
  if (isHonor(t)) {
    return ['East', 'South', 'West', 'North', 'Red Dragon', 'Green Dragon', 'White Dragon'][t - 27];
  }
  return `${rankOf(t)} ${SUIT_LABEL[suitOf(t)]}`;
}

/** CSS class picking the tile's ink colour. */
export function tileClass(t: Tile): string {
  if (t === DRAGON_R) return 'k-red';
  if (t === DRAGON_G) return 'k-green';
  if (t === DRAGON_W) return 'k-blue';
  if (isWind(t)) return 'k-ink';
  return ['k-blue', 'k-green', 'k-red'][suitOf(t)];
}

/** A full 144-tile wall, shuffled with the given RNG. */
export function buildWall(rng: () => number): Tile[] {
  const wall: Tile[] = [];
  for (let t = 0; t < TILE_KINDS; t++) for (let i = 0; i < 4; i++) wall.push(t);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

export function toCounts(tiles: Tile[]): number[] {
  const c = new Array<number>(TILE_KINDS).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}

export function fromCounts(c: number[]): Tile[] {
  const out: Tile[] = [];
  for (let t = 0; t < TILE_KINDS; t++) for (let i = 0; i < c[t]; i++) out.push(t);
  return out;
}

/** Sort order used everywhere in the UI: by suit then rank. */
export const sortTiles = (tiles: Tile[]): Tile[] => [...tiles].sort((a, b) => a - b);
