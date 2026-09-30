import type { GameState } from './game.js';

// Bump the version whenever GameState changes shape, so an old save is ignored rather than
// loaded into code that no longer understands it.
const KEY = 'mahjong:game:v1';

/** The saved game, or null if there is none or it can't be read. */
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GameState;
    const ok =
      Array.isArray(g?.wall) &&
      Array.isArray(g.players) &&
      g.players.length === 4 &&
      typeof g.handNo === 'number' &&
      (g.phase === 'turn' || g.phase === 'claim' || g.phase === 'over');
    return ok ? g : null;
  } catch {
    return null;
  }
}

export function saveGame(g: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // Storage can be full or blocked (private mode); the game still plays, it just won't resume.
  }
}
