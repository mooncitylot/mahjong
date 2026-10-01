// Look-and-feel choices, kept apart from the game save so a new game never resets them.
// index.html applies the saved values before first paint; this module changes them.

export const ACCENTS = ['amber', 'jade', 'blue', 'violet', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];
export type Theme = 'light' | 'dark';

const KEY = 'mahjong:prefs';

interface Prefs {
  accent?: Accent;
  /** Unset means follow the OS. */
  theme?: Theme;
  /** Mark which tiles in your hand to discard and which to keep. */
  hints?: boolean;
}

function read(): Prefs {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Prefs) ?? {};
  } catch {
    return {};
  }
}

function write(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Blocked storage: the choice holds for this visit only.
  }
}

export function accent(): Accent {
  const a = read().accent;
  return a && ACCENTS.includes(a) ? a : 'amber';
}

export function setAccent(a: Accent): void {
  write({ ...read(), accent: a });
  document.documentElement.dataset.accent = a;
}

/** The theme on screen now, whether chosen or inherited from the OS. */
export function theme(): Theme {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme(): void {
  const t: Theme = theme() === 'dark' ? 'light' : 'dark';
  write({ ...read(), theme: t });
  document.documentElement.dataset.theme = t;
}

export function hints(): boolean {
  return read().hints === true;
}

export function setHints(on: boolean): void {
  write({ ...read(), hints: on });
}
