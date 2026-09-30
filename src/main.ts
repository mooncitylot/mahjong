import { Engine } from './engine.js';
import { render } from './ui.js';

const root = document.getElementById('app')!;
const engine = new Engine();
engine.onUpdate = () => render(engine, root);

render(engine, root);
void engine.run();
