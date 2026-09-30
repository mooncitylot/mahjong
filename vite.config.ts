import { defineConfig } from 'vite';

// GitHub Pages serves this project from /mahjong/, so assets need that prefix.
// The dev server still runs at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mahjong/' : '/',
}));
