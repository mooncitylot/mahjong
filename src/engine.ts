import type { Seat } from './tiles.js';
import {
  type Claim,
  type GameState,
  type SelfAction,
  HUMAN,
  newGame,
  applySelf,
  applyClaim,
  passClaims,
  claimsFor,
  bestClaim,
  finishRobbableKong,
} from './game.js';
import { botTurn, botClaim } from './bot.js';

export type Pending =
  | { kind: 'act' }
  | { kind: 'claim'; options: Claim[]; others: Claim[] }
  | null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Vary a delay by ±30% so bots don't move in a mechanical rhythm. */
const jitter = (ms: number): number => ms * (0.7 + Math.random() * 0.6);

export class Engine {
  state: GameState;
  pending: Pending = null;
  speed = 1000;
  onUpdate: () => void = () => {};
  private running = false;

  constructor() {
    this.state = newGame();
  }

  nextHand(): void {
    const g = this.state;
    const dealerWon = g.result?.winner === g.dealer;
    const dealer = (dealerWon || g.drawnGame ? g.dealer : (g.dealer + 1) % 4) as Seat;
    const handNo = g.handNo + 1;
    const wind = dealer === 0 && handNo > 1 && !dealerWon && !g.drawnGame
      ? (g.prevalentWind + 1) % 4
      : g.prevalentWind;
    this.state = newGame(
      dealer,
      wind,
      handNo,
      g.players.map((p) => p.score),
    );
    this.pending = null;
    void this.run();
  }

  restart(): void {
    this.state = newGame();
    this.pending = null;
    void this.run();
  }

  /** The human plays a move on their own turn. */
  act(action: SelfAction): void {
    if (this.pending?.kind !== 'act') return;
    this.pending = null;
    applySelf(this.state, action);
    // Show the move at once rather than after the claim window's pause.
    this.emit();
    void this.run();
  }

  /** The human answers an open claim window. `null` passes. */
  answerClaim(choice: Claim | null): void {
    const p = this.pending;
    if (p?.kind !== 'claim') return;
    this.pending = null;
    const all = choice ? [...p.others, choice] : p.others;
    this.settle(all);
    void this.run();
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const g = this.state;
        if (g.phase === 'over') {
          this.emit();
          return;
        }

        if (g.robbable) {
          const claims = this.gatherClaims(g.robbable.from);
          if (claims.human.length > 0) {
            this.pending = { kind: 'claim', options: claims.human, others: claims.bots };
            this.emit();
            return;
          }
          this.settle(claims.bots);
          this.emit();
          await sleep(jitter(this.speed));
          continue;
        }

        if (g.phase === 'claim') {
          const claims = this.gatherClaims(g.lastDiscard!.from);
          if (claims.human.length > 0) {
            this.emit();
            await sleep(jitter(this.speed / 2));
            this.pending = { kind: 'claim', options: claims.human, others: claims.bots };
            this.emit();
            return;
          }
          await sleep(jitter(this.speed / 2));
          this.settle(claims.bots);
          this.emit();
          continue;
        }

        // phase === 'turn'
        if (g.turn === HUMAN) {
          this.pending = { kind: 'act' };
          this.emit();
          return;
        }
        this.emit();
        await sleep(jitter(this.speed));
        applySelf(g, botTurn(g, g.turn));
        this.emit();
      }
    } finally {
      this.running = false;
    }
  }

  private gatherClaims(from: Seat): { human: Claim[]; bots: Claim[] } {
    const g = this.state;
    const human: Claim[] = [];
    const bots: Claim[] = [];
    for (const s of [0, 1, 2, 3] as Seat[]) {
      if (s === from) continue;
      if (s === HUMAN) human.push(...claimsFor(g, s));
      else {
        const c = botClaim(g, s);
        if (c) bots.push(c);
      }
    }
    return { human, bots };
  }

  private settle(claims: Claim[]): void {
    const g = this.state;
    const from = g.robbable ? g.robbable.from : g.lastDiscard!.from;
    const winner = bestClaim(claims, from);
    if (winner) {
      applyClaim(g, winner);
      return;
    }
    if (g.robbable) finishRobbableKong(g);
    else passClaims(g);
  }

  private emit(): void {
    this.onUpdate();
  }
}
