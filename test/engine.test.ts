// Drives the Engine the way the UI does, with a bot standing in for the human,
// to catch deadlocks in the pending/claim handshake.

import { Engine } from '../src/engine.js';
import { HUMAN } from '../src/game.js';
import { botTurn, botClaim } from '../src/bot.js';

const HANDS = Number(process.argv[2] ?? 12);

const engine = new Engine();
engine.speed = 0;

let hands = 0;
let wins = 0;
let draws = 0;
let humanWins = 0;
let ticks = 0;
let counted = -1;

engine.onUpdate = () => {
  if (++ticks > 500_000) throw new Error('engine spun without finishing');
  const g = engine.state;
  const p = engine.pending;

  if (g.phase === 'over' && p === null) {
    if (g.handNo === counted) return; // the final state emits more than once
    counted = g.handNo;
    hands++;
    if (g.drawnGame) draws++;
    else {
      wins++;
      if (g.result!.winner === HUMAN) humanWins++;
      if (g.result!.total < 8) throw new Error(`engine allowed a ${g.result!.total}-point win`);
    }
    if (hands < HANDS) setTimeout(() => engine.nextHand(), 0);
    return;
  }

  if (p?.kind === 'act') {
    setTimeout(() => engine.act(botTurn(g, HUMAN)), 0);
  } else if (p?.kind === 'claim') {
    // Re-use the bot's judgement for the human seat.
    const choice = botClaim(g, HUMAN) ?? null;
    const valid =
      choice &&
      p.options.some((o) => o.kind === choice.kind && o.tile === choice.tile)
        ? choice
        : null;
    setTimeout(() => engine.answerClaim(valid), 0);
  }
};

void engine.run();

process.on('exit', () => {
  if (hands < HANDS) {
    console.error(`FAIL  stalled after ${hands}/${HANDS} hands (pending=${engine.pending?.kind})`);
    process.exitCode = 1;
    return;
  }
  console.log(`engine drove ${hands} hands: ${wins} wins (${humanWins} by the human seat), ${draws} draws`);
});
