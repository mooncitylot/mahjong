import { Engine } from './engine.js';
import { render } from './ui.js';

const root = document.getElementById('app')!;
const engine = new Engine();
// The engine can update several times in one tick (a discard, then its claim window);
// drawing once per frame keeps a tile's flight from being restarted mid-air.
let queued = false;
engine.onUpdate = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render(engine, root);
  });
};

render(engine, root);
void engine.run();
