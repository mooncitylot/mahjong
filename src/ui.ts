import {
  type Tile,
  type Seat,
  SEAT_NAMES,
  isHonor,
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
  PLAYER_NAMES,
  HUMAN,
  tilesLeft,
  handOf,
  selfActions,
} from './game.js';
import { shanten, waits } from './shanten.js';
import type { Engine } from './engine.js';

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
  onClick?: () => void;
}

function tileEl(t: Tile, o: TileOpts = {}): HTMLElement {
  const node = o.onClick ? el('button') : el('div');
  node.className = ['tile', o.small ? 'sm' : '', o.back ? 'back' : tileClass(t)]
    .filter(Boolean)
    .join(' ');
  if (o.back) {
    return node;
  }
  if (isHonor(t)) node.classList.add('honor');
  if (o.recent) node.classList.add('recent');
  if (o.dim) node.classList.add('dim');
  node.append(el('span', 'face', tileFace(t)));
  const mark = tileMark(t);
  if (mark) node.append(el('span', 'mark', mark));
  node.setAttribute('title', tileName(t));
  if (o.onClick) {
    node.classList.add('pick');
    node.addEventListener('click', o.onClick);
  }
  return node;
}

const windOf = (g: GameState, seat: Seat): string => SEAT_NAMES[(seat - g.dealer + 4) % 4];

/** Seat whose move the table is waiting on, or null between hands. */
function activeSeat(g: GameState, engine: Engine): Seat | null {
  if (g.phase === 'over') return null;
  if (engine.pending?.kind === 'claim') return HUMAN;
  if (g.phase === 'claim' || g.robbable) return null;
  return g.turn;
}

/** Touch screens discard on a second tap so a stray touch on a small tile is harmless. */
const twoTap = (): boolean => window.matchMedia('(pointer: coarse)').matches;

// Which hand slot is raised awaiting a confirming tap: an index into the hand, or 'drawn'.
let selected: number | 'drawn' | null = null;
let rerender: () => void = () => {};

function seatHead(g: GameState, engine: Engine, seat: Seat, name: string): HTMLElement {
  const head = el('div', 'seat-head');
  head.append(el('span', 'wind', windOf(g, seat)[0]));
  head.append(el('span', 'who', name));
  if (seat === g.dealer) head.append(el('span', 'dealer', 'dealer'));
  if (activeSeat(g, engine) === seat) {
    const label =
      engine.pending?.kind === 'claim' ? 'claim?' : seat === HUMAN ? 'your turn' : 'to play';
    head.append(el('span', 'turn-badge', label));
  }
  head.append(el('span', 'pts', fmt(g.players[seat].score)));
  return head;
}

function seatBox(g: GameState, engine: Engine, seat: Seat): HTMLElement {
  const box = el('div', `seat seat-${seat}`);
  if (activeSeat(g, engine) === seat) box.classList.add('active');
  return box;
}

function meldRow(g: GameState, seat: Seat, small: boolean): HTMLElement {
  const wrap = el('div', 'row');
  for (const m of g.players[seat].melds) {
    const grp = el('div', 'group');
    const tiles = setTiles(m);
    tiles.forEach((t, i) => {
      // A concealed kong shows its two outer tiles face down.
      const hidden = m.from === null && m.kind === 'kong' && (i === 0 || i === 3);
      grp.append(tileEl(t, { small, back: hidden }));
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
        recent: last !== null && last.from === seat && i === ds.length - 1,
      }),
    ),
  );
  return pile;
}

function opponentSeat(g: GameState, engine: Engine, seat: Seat): HTMLElement {
  const p = g.players[seat];
  const box = seatBox(g, engine, seat);
  box.append(seatHead(g, engine, seat, PLAYER_NAMES[seat]));

  const row = el('div', 'row');
  const conc = el('div', 'group backs');
  for (let i = 0; i < p.hand.length; i++) conc.append(tileEl(0, { small: true, back: true }));
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
  p.hand.forEach((t, i) => {
    const n = tileEl(t, { onClick: canAct ? pick(i, t) : undefined });
    if (selected === i) n.classList.add('selected');
    conc.append(n);
  });
  line.append(conc);
  if (drawn !== null) {
    const d = tileEl(drawn, { onClick: canAct ? pick('drawn', drawn) : undefined });
    d.classList.add('drawn');
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
    card.append(el('h2', '', r.winner === HUMAN ? 'You win' : `${PLAYER_NAMES[r.winner]} wins`));
    card.append(
      el(
        'div',
        'sub',
        `${tileName(r.tile)} · ${r.from === null ? 'self-drawn' : `discarded by ${PLAYER_NAMES[r.from]}`}`,
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
      d.append(el('span', '', PLAYER_NAMES[s]));
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

export function render(engine: Engine, root: HTMLElement): void {
  const g = engine.state;
  rerender = () => render(engine, root);
  root.textContent = '';

  const top = el('div', 'top');
  top.append(el('div', 'brand', 'Mahjong · MCR'));
  const meta = el('div', 'meta');
  const item = (k: string, v: string): HTMLElement => {
    const s = el('span', '', `${k} `);
    s.append(el('b', '', v));
    return s;
  };
  meta.append(item('Hand', String(g.handNo)));
  meta.append(item('Round', SEAT_NAMES[g.prevalentWind]));
  meta.append(item('Wall', String(Math.max(0, tilesLeft(g)))));
  meta.append(item('Min', '8 pts'));
  top.append(meta);
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
}

/** The four seats in play order from the dealer, with the one on the move lit up. */
function turnBar(g: GameState, engine: Engine): HTMLElement {
  const bar = el('div', 'center');
  const active = activeSeat(g, engine);
  const order = el('div', 'order');
  for (let i = 0; i < 4; i++) {
    const seat = ((g.dealer + i) % 4) as Seat;
    const chip = el('span', `chip${seat === active ? ' on' : ''}${seat === HUMAN ? ' me' : ''}`);
    chip.append(el('b', '', SEAT_NAMES[i][0]));
    chip.append(document.createTextNode(PLAYER_NAMES[seat]));
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
  if (g.robbable) return `${PLAYER_NAMES[g.robbable.from]} is extending a pung…`;
  if (g.phase === 'claim') return 'Waiting on claims…';
  if (g.turn === HUMAN) return 'Your turn — discard a tile.';
  return `${PLAYER_NAMES[g.turn]} is thinking…`;
}
