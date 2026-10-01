import {
  type Tile,
  type Seat,
  SEAT_NAMES,
  seatWindTile,
  isHonor,
  suitOf,
  tileFace,
  tileMark,
  tileClass,
  tileName,
  toCounts,
} from './tiles.js';
import { setTiles } from './meld.js';
import {
  type Claim,
  type GameState,
  type SelfAction,
  nameOf,
  HUMAN,
  tilesLeft,
  handOf,
  selfActions,
} from './game.js';
import { shanten, waits } from './shanten.js';
import { avatarSvg } from './avatar.js';
import type { Engine } from './engine.js';
import { ACCENTS, accent, setAccent, theme, toggleTheme, hints, setHints } from './prefs.js';
import { rateDiscards } from './bot.js';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

interface TileOpts {
  small?: boolean;
  back?: boolean;
  recent?: boolean;
  dim?: boolean;
  /** Stable identity across renders, so the tile can be animated from where it was. */
  key?: string;
  /** Seat the tile belongs to, so a flight can start from that seat's hand. */
  seat?: Seat;
  onClick?: () => void;
}

function tileEl(t: Tile, o: TileOpts = {}): HTMLElement {
  const node = o.onClick ? el('button') : el('div');
  node.className = ['tile', o.small ? 'sm' : '', o.back ? 'back' : tileClass(t)]
    .filter(Boolean)
    .join(' ');
  if (o.key) {
    node.dataset.k = o.key;
    node.dataset.t = String(t);
    node.dataset.s = String(o.seat ?? HUMAN);
  }
  if (o.back) {
    return node;
  }
  if (isHonor(t)) node.classList.add('honor');
  if (o.recent) node.classList.add('recent');
  if (o.dim) node.classList.add('dim');
  node.append(el('span', 'face', tileFace(t)));
  if (!isHonor(t) && suitOf(t) !== 2) {
    // Dots and bams are drawn as shapes: their text marks are too thin to tell apart at tile size.
    const m = el('span', `mark ${suitOf(t) === 0 ? 'm-dot' : 'm-bam'}`);
    m.setAttribute('aria-hidden', 'true');
    node.append(m);
  } else {
    const mark = tileMark(t);
    if (mark) node.append(el('span', 'mark', mark));
  }
  node.setAttribute('title', tileName(t));
  if (o.onClick) {
    node.classList.add('pick');
    node.addEventListener('click', o.onClick);
  }
  return node;
}

/** A seat's own wind, counted from the dealer (0 = East). */
const seatWind = (g: GameState, seat: Seat): number => (seat - g.dealer + 4) % 4;

/** Fill `n` with a wind as it appears on its tile (東 南 西 北), named on hover. */
const showWind = <T extends HTMLElement>(n: T, wind: number): T => {
  n.textContent = tileFace(seatWindTile(wind as Seat));
  n.title = SEAT_NAMES[wind];
  return n;
};

/** Seat whose move the table is waiting on, or null between hands. */
function activeSeat(g: GameState, engine: Engine): Seat | null {
  if (g.phase === 'over') return null;
  if (engine.pending?.kind === 'claim') return HUMAN;
  // Between turns the discarder keeps the light, so it passes straight to the next seat
  // instead of blinking off while claims are weighed.
  if (g.robbable) return g.robbable.from;
  if (g.phase === 'claim') return g.lastDiscard?.from ?? null;
  return g.turn;
}

/** Touch screens discard on a second tap so a stray touch on a small tile is harmless. */
const twoTap = (): boolean => window.matchMedia('(pointer: coarse)').matches;

// Which hand slot is raised awaiting a confirming tap: an index into the hand, or 'drawn'.
let selected: number | 'drawn' | null = null;
let rerender: () => void = () => {};

function seatHead(g: GameState, engine: Engine, seat: Seat, name: string): HTMLElement {
  const head = el('div', 'seat-head');
  head.append(showWind(el('span', 'wind'), seatWind(g, seat)));
  if (seat !== HUMAN) {
    const face = el('span', 'avatar');
    face.innerHTML = avatarSvg(name);
    head.append(face);
  }
  head.append(el('span', 'who', name));
  if (seat === g.dealer) head.append(el('span', 'dealer', 'dealer'));
  if (activeSeat(g, engine) === seat) {
    const label =
      engine.pending?.kind === 'claim'
        ? 'claim?'
        : g.phase === 'claim' || g.robbable
          ? 'discarded'
          : seat === HUMAN
            ? 'your turn'
            : 'to play';
    head.append(el('span', 'turn-badge', label));
  }
  head.append(el('span', 'pts', fmt(g.players[seat].score)));
  return head;
}

function seatBox(g: GameState, engine: Engine, seat: Seat): HTMLElement {
  const box = el('div', `seat seat-${seat}`);
  box.dataset.box = String(seat);
  if (activeSeat(g, engine) === seat) box.classList.add('active');
  return box;
}

function meldRow(g: GameState, seat: Seat, small: boolean): HTMLElement {
  const wrap = el('div', 'row');
  for (const [j, m] of g.players[seat].melds.entries()) {
    const grp = el('div', 'group');
    const tiles = setTiles(m);
    tiles.forEach((t, i) => {
      // A concealed kong shows its two outer tiles face down.
      const hidden = m.from === null && m.kind === 'kong' && (i === 0 || i === 3);
      grp.append(tileEl(t, { small, back: hidden, seat, key: `m${g.handNo}-${seat}-${j}-${i}` }));
    });
    wrap.append(grp);
  }
  return wrap;
}

function discardPile(g: GameState, seat: Seat): HTMLElement {
  const pile = el('div', 'pile');
  const last = g.lastDiscard;
  const ds = g.players[seat].discards;
  ds.forEach((t, i) =>
    pile.append(
      tileEl(t, {
        small: true,
        seat,
        key: `d${g.handNo}-${seat}-${i}`,
        recent: last !== null && last.from === seat && i === ds.length - 1,
      }),
    ),
  );
  return pile;
}

function opponentSeat(g: GameState, engine: Engine, seat: Seat): HTMLElement {
  const p = g.players[seat];
  const box = seatBox(g, engine, seat);
  box.append(seatHead(g, engine, seat, nameOf(g, seat)));

  const row = el('div', 'row');
  const conc = el('div', 'group backs');
  // Face-down tiles are keyed by position; -1 keeps them from matching any real tile.
  const back = (k: string): HTMLElement => tileEl(-1, { small: true, back: true, seat, key: k });
  for (let i = 0; i < p.hand.length; i++) conc.append(back(`b${g.handNo}-${seat}-${i}`));
  if (g.turn === seat && g.drawn !== null && g.phase === 'turn') {
    const d = back(`b${g.handNo}-${seat}-drawn`);
    d.classList.add('drawn');
    conc.append(d);
  }
  row.append(conc);
  // Stands in for the face-down tiles on narrow screens.
  row.append(el('span', 'count', `${handOf(g, seat).length} tiles`));
  const melds = meldRow(g, seat, true);
  if (melds.childElementCount) row.append(...Array.from(melds.children));
  box.append(row);

  if (p.discards.length) {
    box.append(el('div', 'label', 'discards'));
    box.append(discardPile(g, seat));
  }
  return box;
}

const fmt = (n: number): string => (n > 0 ? `+${n}` : String(n));

function chowLabel(start: Tile): string {
  return `Chow ${tileFace(start)}${tileFace(start + 1)}${tileFace(start + 2)}${tileMark(start)}`;
}

type Hint = 'discard' | 'keep';

/**
 * Hint per tile kind for the human's turn: the bot's top-rated discard(s) are 'discard',
 * and tiles whose loss would set the hand back a step are 'keep'.
 */
function handHints(g: GameState, actions: SelfAction[]): Map<Tile, Hint> {
  const out = new Map<Tile, Hint>();
  if (!hints() || !actions.some((a) => a.kind === 'discard')) return out;
  const rated = rateDiscards(g, HUMAN);
  if (rated.length < 2) return out;
  const bestKey = Math.max(...rated.map((r) => r.key));
  const bestSh = Math.min(...rated.map((r) => r.shanten));
  for (const r of rated) {
    if (r.key === bestKey) out.set(r.tile, 'discard');
    else if (r.shanten > bestSh) out.set(r.tile, 'keep');
  }
  return out;
}

function addHint(n: HTMLElement, h: Hint | undefined): void {
  if (!h) return;
  n.classList.add(`hint-${h}`);
  const dot = el('span', 'hint-dot');
  dot.setAttribute('aria-hidden', 'true');
  n.append(dot);
  n.title += h === 'discard' ? ' · hint: discard' : ' · hint: keep';
}

function humanSeat(engine: Engine): HTMLElement {
  const g = engine.state;
  const p = g.players[HUMAN];
  const box = seatBox(g, engine, HUMAN);
  box.classList.add('me');
  box.append(seatHead(g, engine, HUMAN, 'You'));

  const canAct = engine.pending?.kind === 'act';
  const actions = canAct ? selfActions(g, HUMAN) : [];
  const drawn = g.turn === HUMAN ? g.drawn : null;
  const stale =
    (selected === 'drawn' && drawn === null) ||
    (typeof selected === 'number' && selected >= p.hand.length);
  if (!canAct || stale) selected = null;
  const hinted = handHints(g, actions);

  const pick = (slot: number | 'drawn', t: Tile) => (): void => {
    if (engine.pending?.kind !== 'act') return;
    if (twoTap() && selected !== slot) {
      selected = slot;
      rerender();
      return;
    }
    selected = null;
    engine.act({ kind: 'discard', tile: t });
  };

  const row = el('div', 'row');
  const line = el('div', 'hand');
  const conc = el('div', 'group');
  // Keyed by value and copy number, so a tile keeps its identity as the hand re-sorts.
  const copies = new Map<Tile, number>();
  const handKey = (t: Tile): string => {
    const n = copies.get(t) ?? 0;
    copies.set(t, n + 1);
    return `h${g.handNo}-${t}#${n}`;
  };
  p.hand.forEach((t, i) => {
    const n = tileEl(t, { key: handKey(t), onClick: canAct ? pick(i, t) : undefined });
    addHint(n, hinted.get(t));
    if (selected === i) n.classList.add('selected');
    conc.append(n);
  });
  line.append(conc);
  if (drawn !== null) {
    const d = tileEl(drawn, {
      key: handKey(drawn),
      onClick: canAct ? pick('drawn', drawn) : undefined,
    });
    d.classList.add('drawn');
    addHint(d, hinted.get(drawn));
    if (selected === 'drawn') d.classList.add('selected');
    line.append(d);
  }
  row.append(line);
  const melds = meldRow(g, HUMAN, false);
  if (melds.childElementCount) row.append(...Array.from(melds.children));
  box.append(row);

  box.append(actionBar(engine, actions));

  if (p.discards.length) {
    box.append(el('div', 'label', 'discards'));
    box.append(discardPile(g, HUMAN));
  }
  return box;
}

function actionBar(engine: Engine, actions: SelfAction[]): HTMLElement {
  const g = engine.state;
  const bar = el('div', 'bar');
  const pending = engine.pending;

  const add = (label: string, cls: string, fn: () => void): void => {
    const b = el('button', `act ${cls}`, label);
    b.addEventListener('click', fn);
    bar.append(b);
  };

  if (pending?.kind === 'act') {
    if (selected !== null) {
      const t = selected === 'drawn' ? g.drawn! : g.players[HUMAN].hand[selected];
      add(`Discard ${tileName(t)}`, 'primary', () => {
        selected = null;
        engine.act({ kind: 'discard', tile: t });
      });
    }
    for (const a of actions) {
      if (a.kind === 'win') add('Win', 'primary', () => engine.act(a));
      else if (a.kind === 'concealed-kong')
        add(`Kong ${tileName(a.tile)}`, '', () => engine.act(a));
      else if (a.kind === 'added-kong') add(`Add ${tileName(a.tile)}`, '', () => engine.act(a));
    }
    if (!bar.childElementCount)
      bar.append(
        el('span', 'hint', twoTap() ? 'Tap a tile, tap again to discard.' : 'Click a tile to discard.'),
      );
  } else if (pending?.kind === 'claim') {
    const order: Record<Claim['kind'], number> = { win: 0, kong: 1, pung: 2, chow: 3 };
    const opts = [...pending.options].sort((a, b) => order[a.kind] - order[b.kind]);
    for (const c of opts) {
      const label =
        c.kind === 'chow'
          ? chowLabel(c.tile)
          : c.kind === 'win'
            ? 'Win'
            : `${c.kind[0].toUpperCase()}${c.kind.slice(1)}`;
      add(label, c.kind === 'win' ? 'primary' : '', () => engine.answerClaim(c));
    }
    add('Pass', 'ghost', () => engine.answerClaim(null));
  }

  bar.append(handHint(g));
  return bar;
}

function handHint(g: GameState): HTMLElement {
  const p = g.players[HUMAN];
  const tiles = handOf(g, HUMAN);
  const hint = el('span', 'hint');
  if (tiles.length % 3 === 2) {
    hint.textContent = `${13 - p.hand.length + p.melds.length * 3} tiles · your move`;
    return hint;
  }
  const counts = toCounts(tiles);
  const sh = shanten(counts, p.melds.length);
  if (sh <= 0) {
    const w = waits(counts, p.melds.length);
    hint.append(document.createTextNode('ready · waits '));
    const span = el('span', 'wait', w.map(tileName).join(', ') || '—');
    hint.append(span);
  } else {
    hint.textContent = `${sh} away from ready`;
  }
  return hint;
}

function overlay(engine: Engine): HTMLElement | null {
  const g = engine.state;
  if (g.phase !== 'over') return null;
  const card = el('div', 'card');

  if (g.drawnGame) {
    card.append(el('h2', '', 'Drawn game'));
    card.append(el('div', 'sub', 'The wall ran out. No points change hands.'));
  } else {
    const r = g.result!;
    card.append(el('h2', '', r.winner === HUMAN ? 'You win' : `${nameOf(g, r.winner)} wins`));
    card.append(
      el(
        'div',
        'sub',
        `${tileName(r.tile)} · ${r.from === null ? 'self-drawn' : `discarded by ${nameOf(g, r.from)}`}`,
      ),
    );
    const fans = el('div', 'fans');
    for (const f of r.fans) {
      const line = el('div', 'fan');
      line.append(el('span', '', f.name));
      line.append(el('b', '', String(f.points)));
      fans.append(line);
    }
    const total = el('div', 'fan total');
    total.append(el('span', '', 'Total'));
    total.append(el('b', '', String(r.total)));
    fans.append(total);
    card.append(fans);

    const deltas = el('div', 'deltas');
    for (const s of [0, 1, 2, 3] as Seat[]) {
      const d = el('div');
      d.append(el('span', '', nameOf(g, s)));
      d.append(el('b', '', fmt(r.deltas[s])));
      deltas.append(d);
    }
    card.append(deltas);
  }

  const bar = el('div', 'bar');
  const next = el('button', 'act primary', 'Next hand');
  next.addEventListener('click', () => engine.nextHand());
  bar.append(next);
  const again = el('button', 'act ghost', 'New game');
  again.addEventListener('click', () => engine.restart());
  bar.append(again);
  card.append(bar);

  const log = el('div', 'log');
  for (const line of g.log.slice(-8)) log.append(el('div', '', line));
  card.append(log);

  const wrap = el('div', 'overlay');
  wrap.append(card);
  return wrap;
}

// The display menu's open state lives here, not in the DOM, because every game update
// rebuilds the header.
let prefsOpen = false;

const setPrefsOpen = (open: boolean): void => {
  if (open === prefsOpen) return;
  prefsOpen = open;
  rerender();
};

document.addEventListener('click', (e) => {
  if (prefsOpen && !(e.target as Element).closest('.prefs')) setPrefsOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPrefsOpen(false);
});

const SLIDERS_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M2 4h7M13 4h1M2 12h1M7 12h7"/><circle cx="11" cy="4" r="2"/><circle cx="5" cy="12" r="2"/></svg>';

function prefsMenu(): HTMLElement {
  const wrap = el('div', 'prefs');
  const btn = el('button', `prefs-btn${prefsOpen ? ' on' : ''}`);
  btn.innerHTML = SLIDERS_ICON;
  btn.title = 'Display settings';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-expanded', String(prefsOpen));
  btn.addEventListener('click', () => setPrefsOpen(!prefsOpen));
  wrap.append(btn);
  if (!prefsOpen) return wrap;

  const panel = el('div', 'prefs-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Display settings');

  panel.append(el('div', 'label', 'Accent'));
  const swatches = el('div', 'swatches');
  const current = accent();
  for (const a of ACCENTS) {
    const b = el('button', `swatch${a === current ? ' on' : ''}`);
    b.dataset.accent = a;
    b.title = `${a[0].toUpperCase()}${a.slice(1)}`;
    b.setAttribute('aria-label', `${b.title} accent`);
    b.setAttribute('aria-pressed', String(a === current));
    b.addEventListener('click', () => {
      setAccent(a);
      rerender();
    });
    swatches.append(b);
  }
  panel.append(swatches);

  panel.append(el('div', 'label', 'Theme'));
  const seg = el('div', 'seg');
  const now = theme();
  for (const t of ['light', 'dark'] as const) {
    const b = el('button', t === now ? 'on' : '', t === 'light' ? 'Light' : 'Dark');
    b.setAttribute('aria-pressed', String(t === now));
    b.addEventListener('click', () => {
      if (t !== theme()) toggleTheme();
      rerender();
    });
    seg.append(b);
  }
  panel.append(seg);

  panel.append(el('div', 'label', 'Hints'));
  const hintSeg = el('div', 'seg');
  const hintsOn = hints();
  for (const on of [false, true]) {
    const b = el('button', on === hintsOn ? 'on' : '', on ? 'On' : 'Off');
    b.setAttribute('aria-pressed', String(on === hintsOn));
    b.title = 'Red dot: good discard. Green dot: worth keeping.';
    b.addEventListener('click', () => {
      setHints(on);
      rerender();
    });
    hintSeg.append(b);
  }
  panel.append(hintSeg);

  wrap.append(panel);
  return wrap;
}

const LAST_TILES = 12;

/**
 * The wall as a row of two-high stacks. Draws eat it from the left and kong replacements
 * from the right, the same ends the engine takes them from.
 */

function wallStrip(g: GameState): HTMLElement {
  const left = Math.max(0, tilesLeft(g));
  const strip = el('div', 'wall');
  strip.title = `${left} tiles left in the wall`;
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', strip.title);
  for (let i = 0; i < g.wall.length; i += 2) {
    const stack = el('span', 'stack');
    for (const j of [i, i + 1]) {
      // The last dozen tiles still to come are tinted, so the end of the hand shows ahead of time.
      const cls = j < g.head || j > g.tail ? '' : j > g.tail - LAST_TILES ? 'in end' : 'in';
      stack.append(el('i', cls));
    }
    strip.append(stack);
  }
  return strip;
}

export function render(engine: Engine, root: HTMLElement): void {
  const g = engine.state;
  rerender = () => render(engine, root);
  const before = snapshot(root);
  root.textContent = '';

  const top = el('div', 'top');
  const brand = el('div', 'brand', '麻将');
  brand.lang = 'zh-Hans';
  brand.title = 'Mahjong';
  top.append(brand);
  const meta = el('div', 'meta');
  const item = (k: string, v: string): HTMLElement => {
    const s = el('span', '', `${k} `);
    s.append(el('b', '', v));
    return s;
  };
  meta.append(item('Hand', String(g.handNo)));
  // The prevalent wind as it appears on its tile, e.g. 東.
  const round = item('Round', tileFace(seatWindTile(g.prevalentWind as Seat)));
  round.title = `${SEAT_NAMES[g.prevalentWind]} round`;
  meta.append(round);
  top.append(meta, prefsMenu(), wallStrip(g));
  root.append(top);

  const table = el('div', 'table');
  const opps = el('div', 'opps');
  // DOM order is play order after you; wide screens rearrange it into a compass.
  opps.append(opponentSeat(g, engine, 1), opponentSeat(g, engine, 2), opponentSeat(g, engine, 3));
  table.append(opps);
  // Turn order and your hand travel together so both stay in view on a phone.
  const dock = el('div', 'dock');
  dock.append(turnBar(g, engine), humanSeat(engine));
  table.append(dock);
  root.append(table);

  const ov = overlay(engine);
  if (ov) root.append(ov);

  animate(root, g, engine, before);
}

// ---------- motion ----------
//
// Every update rebuilds the DOM, so nothing would ever transition on its own. Instead each
// render remembers where keyed tiles sat, then plays the difference: tiles that moved slide
// (FLIP), tiles that changed hands arc over from their old spot, and new tiles ease in.
// Animations still running when the next render lands are carried over to the new nodes,
// so a quick second update never cuts a flight short.

interface Carry {
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
  time: number;
  /** Where the node settles, so a carry only resumes if the layout did not move it. */
  to: DOMRect;
}

interface Snap {
  rect: DOMRect;
  t: string;
  s: string;
  carry?: Carry;
}

interface BoxSnap {
  h: number;
  carry?: { frames: Keyframe[]; timing: KeyframeAnimationOptions; time: number; to: number };
}

interface Before {
  tiles: Map<string, Snap>;
  boxes: Map<string, BoxSnap>;
  glide: DOMRect | null;
  overlay: HTMLElement | null;
}

const EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
/** Settles with a small overshoot, for things the player should feel land. */
const SPRING = 'cubic-bezier(0.3, 1.35, 0.5, 1)';

let lastHandNo = -1;
let lastActive: Seat | null = null;
let lastStatus = '';
let lastPhase = '';
let lastMelds: string[] = [];
let lastButtons = '';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const running = new WeakMap<Element, { anim: Animation; frames: Keyframe[]; timing: KeyframeAnimationOptions; to: unknown }>();

function play<T>(n: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions, to: T, time = 0): Animation {
  const anim = n.animate(frames, timing);
  if (time) anim.currentTime = time;
  running.set(n, { anim, frames, timing, to });
  return anim;
}

function carryOf(n: Element): { frames: Keyframe[]; timing: KeyframeAnimationOptions; time: number; to: unknown } | undefined {
  const r = running.get(n);
  if (!r || r.anim.playState !== 'running') return undefined;
  return { frames: r.frames, timing: r.timing, time: Number(r.anim.currentTime ?? 0), to: r.to };
}

function snapshot(root: HTMLElement): Before {
  const tiles = new Map<string, Snap>();
  const boxes = new Map<string, BoxSnap>();
  const g = root.querySelector('.glide');
  const before: Before = {
    tiles,
    boxes,
    glide: g && g.classList.contains('on') ? g.getBoundingClientRect() : null,
    overlay: root.querySelector<HTMLElement>('.overlay'),
  };
  if (reducedMotion()) return before;
  for (const n of root.querySelectorAll<HTMLElement>('[data-k]'))
    tiles.set(n.dataset.k!, {
      rect: n.getBoundingClientRect(),
      t: n.dataset.t!,
      s: n.dataset.s!,
      carry: carryOf(n) as Carry | undefined,
    });
  for (const n of root.querySelectorAll<HTMLElement>('[data-box]'))
    boxes.set(n.dataset.box!, {
      h: n.getBoundingClientRect().height,
      carry: carryOf(n) as BoxSnap['carry'],
    });
  return before;
}

const near = (a: DOMRect, b: DOMRect): boolean =>
  Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5;

const baseOf = (n: HTMLElement): string => {
  const b = getComputedStyle(n).transform;
  return b === 'none' ? '' : ` ${b}`;
};

/** Offset `n` so it appears at `from`, then let it settle where the layout put it. */
function slide(n: HTMLElement, from: DOMRect, to: DOMRect, duration: number, easing = EASE): void {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sc = from.width / to.width;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sc - 1) < 0.01) return;
  const base = baseOf(n);
  play(
    n,
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sc})${base}` }, { transform: base || 'none' }],
    { duration, easing, fill: 'backwards' },
    to,
  );
}

/** Like `slide`, but the tile is tossed: it lifts in an arc, tilts, and lands with a bump. */
function toss(n: HTMLElement, from: DOMRect, to: DOMRect, duration: number, delay = 0): void {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sc = from.width / to.width;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5 && Math.abs(sc - 1) < 0.01) return;
  const arc = Math.min(48, dist * 0.22);
  const tilt = dx > 0 ? -7 : 7;
  const mid = ((sc + 1) / 2) * 1.08;
  const base = baseOf(n);
  play(
    n,
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sc})${base}`, easing: 'ease-out' },
      {
        offset: 0.45,
        transform: `translate(${dx * 0.45}px, ${dy * 0.45 - arc}px) scale(${mid}) rotate(${tilt}deg)${base}`,
        easing: 'ease-in',
      },
      { offset: 0.8, transform: `translate(0px, 0px) scale(1.1, 0.92)${base}`, easing: 'ease-out' },
      { transform: base || 'none' },
    ],
    { duration, delay, fill: 'backwards' },
    to,
  );
}

/** Where a seat's concealed hand sits on screen: its face-down row, or its tile count. */
function handSpot(root: HTMLElement, seat: string): DOMRect | null {
  const box = root.querySelector(`.seat-${seat}`);
  if (!box) return null;
  for (const sel of ['.backs .tile:last-child', '.count', '.seat-head']) {
    const r = box.querySelector(sel)?.getBoundingClientRect();
    if (r && r.width > 0) return r;
  }
  return null;
}

let fxLayer: HTMLElement | null = null;
function fx(): HTMLElement {
  if (!fxLayer) {
    fxLayer = el('div', 'fx');
    document.body.append(fxLayer);
  }
  return fxLayer;
}

/** A word that pops up over a seat — "Pung!" — and drifts away. */
function callout(root: HTMLElement, seat: Seat, text: string, big = false): void {
  const box = root.querySelector(`.seat-${seat}`);
  if (!box) return;
  const r = box.getBoundingClientRect();
  const c = el('div', `callout${big ? ' big' : ''}`, text);
  c.style.left = `${r.left + r.width / 2}px`;
  c.style.top = `${Math.max(40, Math.min(window.innerHeight - 40, r.top + Math.min(r.height / 2, 60)))}px`;
  fx().append(c);
  const anim = c.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.5)' },
      { offset: 0.14, opacity: 1, transform: 'translate(-50%, -50%) scale(1.12)' },
      { offset: 0.24, transform: 'translate(-50%, -50%) scale(1)' },
      { offset: 0.75, opacity: 1, transform: 'translate(-50%, -75%) scale(1)' },
      { opacity: 0, transform: 'translate(-50%, -110%) scale(0.96)' },
    ],
    { duration: big ? 1300 : 1000, easing: 'ease-out' },
  );
  anim.finished.then(() => c.remove(), () => c.remove());
}

const CALL: Record<string, string> = { chow: 'Chow!', pung: 'Pung!', kong: 'Kong!' };

/** Slide the turn-order highlight under whichever chip is lit. */
function placeGlide(root: HTMLElement): void {
  const glide = root.querySelector<HTMLElement>('.glide');
  const chip = root.querySelector<HTMLElement>('.chip.on');
  if (!glide) return;
  glide.classList.toggle('on', chip !== null);
  if (!chip) return;
  glide.style.left = `${chip.offsetLeft}px`;
  glide.style.top = `${chip.offsetTop}px`;
  glide.style.width = `${chip.offsetWidth}px`;
  glide.style.height = `${chip.offsetHeight}px`;
}

function countUp(n: HTMLElement, delay: number): void {
  const target = Number(n.textContent);
  if (!Number.isFinite(target) || target === 0) return;
  const start = performance.now() + delay;
  const dur = 650;
  const tick = (now: number): void => {
    const p = Math.min(1, Math.max(0, (now - start) / dur));
    const v = Math.round(target * (1 - (1 - p) ** 3));
    n.textContent = fmt(v);
    if (p < 1 && n.isConnected) requestAnimationFrame(tick);
  };
  n.textContent = fmt(0);
  requestAnimationFrame(tick);
}

function animate(root: HTMLElement, g: GameState, engine: Engine, before: Before): void {
  const newHand = g.handNo !== lastHandNo;
  lastHandNo = g.handNo;
  const active = activeSeat(g, engine);
  const turnChanged = active !== lastActive;
  const prevActive = lastActive;
  lastActive = active;
  const statusNode = root.querySelector<HTMLElement>('.center .status');
  const status = statusNode?.textContent ?? '';
  const statusChanged = status !== lastStatus;
  lastStatus = status;
  const phaseChanged = g.phase !== lastPhase;
  lastPhase = g.phase;
  const melds = g.players.map((p) => p.melds.map((m) => m.kind).join(','));
  const prevMelds = newHand ? melds : lastMelds;
  lastMelds = melds;
  const buttons = [...root.querySelectorAll('.seat.me .bar button')].map((b) => b.textContent).join('|');
  const buttonsChanged = buttons !== lastButtons;
  lastButtons = buttons;

  placeGlide(root);
  const motion = !reducedMotion();

  // The result card fades out rather than vanishing when the next hand starts.
  const oldOverlay = before.overlay;
  if (oldOverlay && !root.querySelector('.overlay') && motion) {
    fx().append(oldOverlay);
    oldOverlay
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => oldOverlay.remove(), () => oldOverlay.remove());
  }

  if (!motion) return;

  // Seats grow and shrink smoothly, so a new row of discards eases the table down instead
  // of shoving it. Done first: the tile measurements below depend on this layout.
  if (!newHand) {
    for (const b of root.querySelectorAll<HTMLElement>('[data-box]')) {
      const prev = before.boxes.get(b.dataset.box!);
      if (!prev) continue;
      const h = b.getBoundingClientRect().height;
      if (prev.carry && Math.abs(prev.carry.to - h) < 0.5) {
        play(b, prev.carry.frames, prev.carry.timing, h, prev.carry.time);
      } else if (Math.abs(prev.h - h) >= 1) {
        play(b, [{ height: `${prev.h}px` }, { height: `${h}px` }], { duration: 280, easing: EASE }, h);
      }
    }
  }

  // Measure where everything settles before any tile starts moving.
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-k]')];
  const dest = new Map(nodes.map((n) => [n, n.getBoundingClientRect()]));
  const present = new Set(nodes.map((n) => n.dataset.k!));
  // Tiles that left the table since last render, as sources for flights.
  const gone: Snap[] = [];
  if (!newHand) for (const [k, v] of before.tiles) if (!present.has(k)) gone.push(v);
  const take = (pred: (s: Snap) => boolean): Snap | undefined => {
    const i = gone.findIndex(pred);
    return i >= 0 ? gone.splice(i, 1)[0] : undefined;
  };

  let dealt = 0;
  for (const n of nodes) {
    const k = n.dataset.k!;
    const to = dest.get(n)!;
    const prev = before.tiles.get(k);
    if (prev) {
      if (prev.carry && near(prev.carry.to, to))
        play(n, prev.carry.frames, prev.carry.timing, to, prev.carry.time);
      else slide(n, prev.rect, to, 280, k.startsWith('h') ? SPRING : EASE);
      continue;
    }
    // A discard leaving a hand, or a claimed tile joining a meld.
    const byValue = n.dataset.t !== '-1' ? take((s) => s.t === n.dataset.t) : undefined;
    if (byValue) {
      toss(n, byValue.rect, to, 440);
      continue;
    }
    // An opponent's tile, out of their face-down hand.
    if (!newHand && (k.startsWith('d') || k.startsWith('m')) && n.dataset.s !== String(HUMAN)) {
      const back = take((s) => s.t === '-1' && s.s === n.dataset.s);
      const from = back?.rect ?? handSpot(root, n.dataset.s!);
      if (from) {
        toss(n, from, to, 440);
        continue;
      }
    }
    if (newHand && (k.startsWith('h') || k.startsWith('b'))) {
      play(
        n,
        [{ opacity: 0, transform: 'translateY(-18px) rotate(-6deg) scale(0.9)' }, {}],
        { duration: 360, delay: (k.startsWith('h') ? dealt++ : dealt * 0.5) * 32, easing: SPRING, fill: 'backwards' },
        to,
      );
    } else if (k.startsWith('h') || k.startsWith('b')) {
      // Freshly drawn: dropped in from the wall.
      play(
        n,
        [{ opacity: 0, transform: 'translateY(-26px) rotate(4deg)' }, { opacity: 1, offset: 0.4 }, { transform: baseOf(n) || 'none' }],
        { duration: 420, easing: SPRING, fill: 'backwards' },
        to,
      );
    } else {
      play(n, [{ opacity: 0, transform: 'scale(0.6)' }, {}], { duration: 300, easing: SPRING }, to);
    }
  }

  if (!newHand)
    for (const s of [0, 1, 2, 3] as Seat[]) {
      if (melds[s] === prevMelds[s]) continue;
      const kind = g.players[s].melds.at(-1)?.kind;
      const grew = melds[s].split(',').length > prevMelds[s].split(',').length || !prevMelds[s];
      callout(root, s, CALL[grew && kind ? kind : 'kong']);
    }

  if (turnChanged) {
    if (active !== null) {
      root.querySelector(`.seat-${active}`)?.classList.add('turn-in');
      root.querySelector(`.chip[data-seat="${active}"]`)?.classList.add('turn-in');
    }
    if (prevActive !== null && prevActive !== active)
      root.querySelector(`.seat-${prevActive}`)?.classList.add('turn-out');
    const glide = root.querySelector<HTMLElement>('.glide.on');
    if (glide && before.glide) slide(glide, before.glide, glide.getBoundingClientRect(), 380, SPRING);
    else glide?.animate([{ opacity: 0, transform: 'scale(0.8)' }, {}], { duration: 260, easing: SPRING });
  }
  if (statusChanged) statusNode?.classList.add('fade-in');

  if (buttonsChanged)
    root.querySelectorAll<HTMLElement>('.seat.me .bar button').forEach((b, i) =>
      b.animate([{ opacity: 0, transform: 'translateY(6px) scale(0.9)' }, {}], {
        duration: 300,
        delay: i * 45,
        easing: SPRING,
        fill: 'backwards',
      }),
    );

  if (phaseChanged && g.phase === 'over') {
    const ov = root.querySelector<HTMLElement>('.overlay');
    // Give a win its moment on the table before the scorecard covers it.
    const hold = g.result ? 650 : 0;
    if (g.result) callout(root, g.result.winner, g.result.winner === HUMAN ? 'Mahjong!' : 'Mahjong', true);
    if (ov) {
      ov.classList.add('show');
      ov.style.setProperty('--hold', `${hold}ms`);
      const lines = [...ov.querySelectorAll<HTMLElement>('.fan')];
      lines.forEach((l, i) =>
        l.animate([{ opacity: 0, transform: 'translateX(-8px)' }, {}], {
          duration: 260,
          delay: hold + 220 + i * 60,
          easing: EASE,
          fill: 'backwards',
        }),
      );
      const after = hold + 260 + lines.length * 60;
      ov.querySelectorAll<HTMLElement>('.deltas b').forEach((b) => countUp(b, after));
    }
  }
}

/** The four seats in play order from the dealer, with the one on the move lit up. */
function turnBar(g: GameState, engine: Engine): HTMLElement {
  const bar = el('div', 'center');
  const active = activeSeat(g, engine);
  const order = el('div', 'order');
  order.append(el('span', 'glide'));
  for (let i = 0; i < 4; i++) {
    const seat = ((g.dealer + i) % 4) as Seat;
    const chip = el('span', `chip${seat === active ? ' on' : ''}${seat === HUMAN ? ' me' : ''}`);
    chip.dataset.seat = String(seat);
    chip.append(showWind(el('b'), i));
    chip.append(document.createTextNode(nameOf(g, seat)));
    order.append(chip);
  }
  bar.append(order);
  const status = el('div', `status${active === HUMAN ? ' mine' : ''}`, statusLine(g, engine));
  bar.append(status);
  return bar;
}

function statusLine(g: GameState, engine: Engine): string {
  if (g.phase === 'over') return '';
  if (engine.pending?.kind === 'claim') return 'Claim the discard, or pass.';
  if (g.robbable) return `${nameOf(g, g.robbable.from)} is extending a pung…`;
  if (g.phase === 'claim' && g.lastDiscard) {
    const { from, tile } = g.lastDiscard;
    return from === HUMAN ? `You discard ${tileName(tile)}.` : `${nameOf(g, from)} discards ${tileName(tile)}.`;
  }
  if (g.turn === HUMAN) return 'Your turn — discard a tile.';
  return `${nameOf(g, g.turn)} is thinking…`;
}
