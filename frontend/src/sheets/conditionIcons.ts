// The 24 condition icons, drawn for CITY_NET (4e1b; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09). Ours to use under the project's own license: drawn here rather than taken from an icon
// set, and the four whose first sketches came too close to Feather's (the eye, the music note, the bolt
// and the anchor) redrawn in shapes of their own.
//
// Each is a list of path data on a 24 x 24 grid, stroked 2 wide in currentColor and never filled, so
// it takes the theme's color in all seven themes (ConditionIcon draws them). The ids are the server's
// (backend/systemBuilder/conditions.js ICONS), held equal by a test.

/** A circle as path data, so every icon is paths alone. */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** A rectangle with rounded corners as path data. */
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export const CONDITION_ICONS = {
  // An almond eye, struck through.
  blind: ['M3 12c2.5-4 5.5-6 9-6s6.5 2 9 6c-2.5 4-5.5 6-9 6s-6.5-2-9-6z', circle(12, 12, 2.5), 'M5 19L19 5'],
  drop: ['M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z'],
  skull: ['M5 11a7 7 0 1 1 14 0v3l-2 2v3H7v-3l-2-2z', circle(9.5, 11.5, 1.5), circle(14.5, 11.5, 1.5)],
  down: ['M4 20h16', 'M8 15l4 4 4-4', 'M12 4v15'],
  star: ['M12 3l2.5 5.5 6 .7-4.5 4 1.3 6L12 16l-5.3 3.2 1.3-6-4.5-4 6-.7z'],
  hand: ['M7 11V5a2 2 0 0 1 4 0v5', 'M11 10V4a2 2 0 0 1 4 0v6', 'M15 10V6a2 2 0 0 1 4 0v7a7 7 0 0 1-14 0v-2a2 2 0 0 1 4 0'],
  ghost: ['M6 20V10a6 6 0 0 1 12 0v10l-2-2-2 2-2-2-2 2-2-2z', circle(10, 10, 1), circle(14, 10, 1)],
  zzz: ['M4 6h6l-6 6h6', 'M13 12h5l-5 6h5'],
  chain: [rect(3, 9, 9, 6, 3), rect(12, 9, 9, 6, 3)],
  battery: [rect(3, 8, 16, 8, 1), 'M21 11v2', 'M6 11h3'],
  flame: ['M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-2 0-4 0-6z'],
  // A bolt with a blunt top and a long tail, its own zigzag.
  bolt: ['M15 2H9l-3 10h5l-2 10 9-13h-5z'],
  spiral: ['M12 12a1 1 0 1 1 1-1 3 3 0 1 1-3-3 5 5 0 1 1-5 5 7 7 0 1 1 7 7'],
  snow: ['M12 2v20', 'M4 7l16 10', 'M4 17L20 7'],
  bio: [circle(12, 12, 2), 'M12 10a4 4 0 0 1 0-8', 'M10.3 13a4 4 0 0 1-7 3.9', 'M13.7 13a4 4 0 0 0 7 3.9'],
  closed: ['M3 11c3 4 15 4 18 0', 'M6 14l-1 2', 'M12 15v2', 'M18 14l1 2'],
  signal: ['M2 9a14 14 0 0 1 20 0', 'M5 12.5a9 9 0 0 1 14 0', 'M8.5 16a4 4 0 0 1 7 0', 'M3 3l18 18'],
  mask: ['M3 8c3-2 15-2 18 0 0 6-4 9-9 9S3 14 3 8z', circle(8.5, 10.5, 1.5), circle(15.5, 10.5, 1.5)],
  // An anchor with a square shank cap and hooked flukes.
  anchor: [rect(10, 2, 4, 3, 1), 'M12 5v16', 'M8 9h8', 'M4 13c0 5 4 8 8 8s8-3 8-8', 'M4 13l-1.5 2.5', 'M20 13l1.5 2.5'],
  target: [circle(12, 12, 8), circle(12, 12, 4), circle(12, 12, 1)],
  heart: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z', 'M12 7.5l-1.5 4 3 1-1.5 4'],
  shield: ['M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z', 'M12 7l-1 5 2 1-1 4'],
  // A single eighth note with its flag.
  music: ['M10 17V4l7 3-7 3', circle(7, 17, 3)],
  pill: [rect(3, 8.5, 18, 7, 3.5), 'M12 8.5v7'],
} as const satisfies Record<string, readonly string[]>;

export type ConditionIconId = keyof typeof CONDITION_ICONS;

/** Every drawn icon's id, in the server's order. */
export const CONDITION_ICON_IDS = Object.keys(CONDITION_ICONS) as ConditionIconId[];

/** An uploaded condition icon's address (POST /api/systems/condition-icons). */
const UPLOADED = /^\/uploads\/condition_icons\/[0-9a-f]{64}\.(png|webp|svg)$/;
export const isUploadedIcon = (icon: unknown): icon is string => typeof icon === 'string' && UPLOADED.test(icon);
export const isDrawnIcon = (icon: unknown): icon is ConditionIconId => typeof icon === 'string' && Object.prototype.hasOwnProperty.call(CONDITION_ICONS, icon);
