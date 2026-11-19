// CARRYING on the sheet's GEAR tab, as logic (8a6a; approved mockup docs/mockups/carrying-on-sheet.html, 2026-11-19, the user:
// "I like A and yes to all"): what the server worked out (backend systemBuilder/encumbrance.js carryingOf, under the sheet's
// _worked) read safely; the meter, filled to what is carried, ticked where each band ends, green in the first band, the warning
// color past it and danger past every band; the bands in the sheet's words; and the band's condition, said where it is on.
// Without CAN CARRY, the number alone. Shown, never enforced.

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export interface Band { word: string; upto: number }
export interface Carrying {
  carried: number; capacity: number | null; unit: string;
  band: string | null; says: string | null; condition: string | null; conditionName: string | null;
  bands: Band[]; past: string | null;
}

/** What the server worked out for the sheet, or null where it counts no encumbrance. */
export const carryingOf = (data: Obj | null | undefined): Carrying | null => {
  const w = isObject(data) && isObject(data._worked) ? data._worked : null;
  const c = w && isObject(w.carrying) ? w.carrying : null;
  if (!c || num(c.carried) === null) return null;
  return {
    carried: num(c.carried)!, capacity: num(c.capacity), unit: typeof c.unit === 'string' ? c.unit : '',
    band: text(c.band), says: text(c.says), condition: text(c.condition), conditionName: text(c.conditionName),
    bands: Array.isArray(c.bands) ? c.bands.filter(isObject).filter((b) => typeof b.word === 'string' && num(b.upto) !== null).map((b) => ({ word: b.word as string, upto: b.upto as number })) : [],
    past: text(c.past),
  };
};

/** A number as people say it: 0.15, never 0.15000000000000002. */
export const amount = (n: number): string => String(Math.round(n * 100) / 100);

export type Tone = 'green' | 'warning' | 'danger';
export interface Meter { fill: number; ticks: number[]; tone: Tone }

/**
 * The meter, as shares of its width: filled to what is carried, its full width the last band's end (CAN CARRY with no bands),
 * a tick where each band but the last ends. Green in the first band, the warning color past it, danger past every band (or past
 * CAN CARRY with none). None without CAN CARRY.
 */
export const meterOf = (c: Carrying): Meter | null => {
  if (c.capacity === null) return null;
  const bands = [...c.bands].sort((a, b) => a.upto - b.upto);
  const last = bands.length ? bands[bands.length - 1].upto : 100;
  const full = (c.capacity * last) / 100;
  const share = (n: number) => (full > 0 ? Math.min(100, Math.max(0, (n / full) * 100)) : (n > 0 ? 100 : 0));
  const at = bands.findIndex((b) => b.word === c.band);
  const past = c.bands.length ? at < 0 : c.carried > c.capacity;
  return {
    fill: share(c.carried),
    ticks: c.bands.map((b) => share((c.capacity! * b.upto) / 100)).filter((t) => t < 100),
    tone: past ? 'danger' : at > 0 ? 'warning' : 'green',
  };
};

/** The bands in the sheet's words: LIGHT ≤ 25 · ENCUMBERED ≤ 50 · OVERLOADED. Empty with none. */
export const legendOf = (c: Carrying): string => (c.capacity === null || !c.bands.length ? ''
  : [...c.bands.map((b) => `${b.word} ≤ ${amount((c.capacity! * b.upto) / 100)}`), ...(c.past ? [c.past] : [])].join(' · '));

/**
 * The band's condition as the sheet says it: SLOWED ON WHILE ENCUMBERED where the band has put it on (`bandCondition`, the
 * sheet's _band_condition), "· no token on the map" where there is nothing to put it on; nothing where the band names none, or
 * hasn't put it on (the table switched band conditions off, or the GM had it on already).
 */
export const conditionLine = (c: Carrying, bandCondition: unknown, noToken: boolean): string | null => {
  if (!c.condition) return null;
  const name = (c.conditionName || c.condition).toUpperCase();
  if (noToken) return `${name} · no token on the map`;
  return bandCondition === c.condition ? `${name} ON WHILE ${c.band ?? ''}`.trim() : null;
};
