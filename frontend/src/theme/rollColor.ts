import type { ThemeColors } from './themes';

/** The contrast text needs against what is behind it to be read (WCAG's 4.5 to 1). */
export const MIN_CONTRAST = 4.5;

type Rgb = [number, number, number];

/** #rgb or #rrggbb as its three channels, or null for anything else. */
const channels = (color: string): Rgb | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};

const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** How far apart two colors are to the eye, from 1 (the same) to 21 (black on white). */
export const contrast = (a: string, b: string): number => {
  const x = channels(a);
  const y = channels(b);
  if (!x || !y) return 21;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * `color`, lightened just enough to read on `background`: mixed toward white a step at a time
 * until it has MIN_CONTRAST, so a dark blue token stays that player's blue, only clearer. A color
 * that already reads, or one that isn't a hex color, is left as it is.
 */
export const readableOn = (color: string, background: string): string => {
  const c = channels(color);
  if (!c || !channels(background) || contrast(color, background) >= MIN_CONTRAST) return color;
  for (let t = 0.05; t < 1; t += 0.05) {
    const mixed = `#${c.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
    if (contrast(mixed, background) >= MIN_CONTRAST) return mixed;
  }
  return '#ffffff';
};

/**
 * A roll's color as DICE_TRAY.EXE shows it, in the theme the viewer picked. The server sends the
 * roller's token color, and colors of its own for some outcomes. A token's color when none was
 * chosen, and the server's success, are both #00ff00, Classic's green: those follow the theme's
 * primary, as everything else in the window does. The server's failure red (#ff3333) follows the
 * theme's danger. A color someone picked for their token is theirs and stays (decided with the
 * user, 2026-10-23), lifted where it is too dark to read on the theme's background. A theme's
 * own colors are its design, the same everywhere in it, and are never changed here.
 */
export const themedRollColor = (color: string | null | undefined, theme: ThemeColors): string => {
  const c = (color ?? '').trim().toLowerCase();
  if (!c || c === '#00ff00' || c === '#0f0') return theme.primary;
  if (c === '#ff3333' || c === '#f33') return theme.danger;
  return readableOn(color as string, theme.background);
};
