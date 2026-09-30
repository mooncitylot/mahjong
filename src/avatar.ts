// Face avatars seeded by name: the "beam" style from Boring Avatars
// (https://github.com/boringdesigners/boring-avatars, MIT, © 2021 boringdesigners),
// ported to a plain SVG string so the app needs neither React nor a network call.

/** Muted tones picked to sit beside the tile colours in both themes. */
const COLORS = ['#c47a12', '#3f7350', '#3a5a8c', '#b23a33', '#e8dcc4'];
const SIZE = 36;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const digit = (n: number, place: number): number => Math.floor((n / 10 ** place) % 10);
const even = (n: number, place: number): boolean => digit(n, place) % 2 === 0;
const unit = (n: number, range: number, place?: number): number => {
  const v = n % range;
  return place && digit(n, place) % 2 === 0 ? -v : v;
};
const pick = (n: number): string => COLORS[n % COLORS.length];

/** Black or white, whichever reads better on `hex`. */
function contrast(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#000000' : '#FFFFFF';
}

// Every inline SVG shares one id namespace, so each mask needs its own id.
let nextId = 0;

/** An SVG face for `name`; the same name always gives the same face. */
export function avatarSvg(name: string): string {
  const n = hash(name);
  const wrap = pick(n);
  const face = contrast(wrap);
  const bg = pick(n + 13);
  const pre = (v: number): number => (v < 5 ? v + SIZE / 9 : v);
  const tx = pre(unit(n, 10, 1));
  const ty = pre(unit(n, 10, 2));
  const rotate = unit(n, 360);
  const scale = 1 + unit(n, SIZE / 12) / 10;
  const mouthOpen = even(n, 2);
  const circle = even(n, 1);
  const eyeSpread = unit(n, 5);
  const mouthSpread = unit(n, 3);
  const faceRotate = unit(n, 10, 3);
  const fx = tx > SIZE / 6 ? tx / 2 : unit(n, 8, 1);
  const fy = ty > SIZE / 6 ? ty / 2 : unit(n, 7, 2);
  const mid = SIZE / 2;
  const id = `av${nextId++}`;

  const mouth = mouthOpen
    ? `<path d="M15 ${19 + mouthSpread}c2 1 4 1 6 0" stroke="${face}" fill="none" stroke-linecap="round"/>`
    : `<path d="M13,${19 + mouthSpread} a1,0.75 0 0,0 10,0" fill="${face}"/>`;

  return (
    `<svg viewBox="0 0 ${SIZE} ${SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 2}" fill="#FFFFFF"/></mask>` +
    `<g mask="url(#${id})">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>` +
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${wrap}" rx="${circle ? SIZE : SIZE / 6}" ` +
    `transform="translate(${tx} ${ty}) rotate(${rotate} ${mid} ${mid}) scale(${scale})"/>` +
    `<g transform="translate(${fx} ${fy}) rotate(${faceRotate} ${mid} ${mid})">` +
    mouth +
    `<rect x="${14 - eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${face}"/>` +
    `<rect x="${20 + eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${face}"/>` +
    `</g></g></svg>`
  );
}
