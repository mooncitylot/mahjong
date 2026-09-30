import { Engine } from './engine.js';
import { render } from './ui.js';
import { loadGame, saveGame } from './save.js';

const root = document.getElementById('app')!;
// Pick up where the last visit left off; the engine re-derives any pending prompt from the state.
const engine = new Engine(loadGame() ?? undefined);
// The engine can update several times in one tick (a discard, then its claim window);
// drawing once per frame keeps a tile's flight from being restarted mid-air.
let queued = false;
engine.onUpdate = () => {
  saveGame(engine.state);
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render(engine, root);
  });
};

render(engine, root);
void engine.run();
