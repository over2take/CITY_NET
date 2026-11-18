// A gear line's DAMAGE or DICE as typed under ✎, said in words (8a3c2; approved mockup docs/mockups/gear-compact.html,
// decision 4): what it reads on this character ("ON THIS CHARACTER: 1d8 + Might mod (2): 3 to 10"), worked out by the
// server as ROLL would (backend gearRolls.js readGearDice), or what is wrong with it, a name the system hasn't got said
// as typed rather than skipped at the roll. And the box's eˣ: SHAPE, a common one written for you, and INSERT, the
// system's names. Pure; GearTypeTables draws it.

/** What the server read (sockets readGearDice). */
export type GearDiceRead =
  | { ok: true; blank: true; names: DiceName[] }
  | { ok: true; blank?: undefined; low: number; high: number; used: { token: string; label: string; value: number }[]; names: DiceName[] }
  | { ok: false; error: string; names?: DiceName[] };
export interface DiceName { token: string; label: string }

/** The box's line under it: what it reads on this character, or what is wrong; blank, what an empty box means. */
export const diceWords = (text: string, read: GearDiceRead | null, column: string): { words: string; bad: boolean } => {
  if (!text.trim()) return { words: `NONE: THIS LINE HAS NO ${column.toUpperCase()}`, bad: false };
  if (!read) return { words: 'READING IT…', bad: false };
  if (!read.ok) return { words: `${read.error.toUpperCase()}: IT WON'T ROLL`, bad: true };
  if ('blank' in read && read.blank) return { words: `NONE: THIS LINE HAS NO ${column.toUpperCase()}`, bad: false };
  const r = read as Extract<GearDiceRead, { low: number }>;
  // Each name said by its label, with what it is on this character: "@might_mod" as "Might mod (2)".
  let named = text.trim();
  for (const u of r.used) named = named.split(u.token).join(`${u.label} (${u.value})`);
  const range = r.low === r.high ? `${r.low}` : `${r.low} to ${r.high}`;
  return { words: `ON THIS CHARACTER: ${named}: ${range}`, bad: false };
};

/** The shapes the box's eˣ writes, as the mockup has them. */
export const SHAPES = ['A NUMBER', 'DICE', 'DICE AND A STAT'] as const;
export type Shape = typeof SHAPES[number];

/** A shape written out: a number, a die, or a die and the system's first name. */
export const shapeText = (shape: Shape, names: DiceName[]): string =>
  shape === 'A NUMBER' ? '3' : shape === 'DICE' ? '1d6' : `1d8 + ${names[0]?.token ?? '@level'}`;

/** A name put in at the cursor, joined with " + " to what is there; the text and where the cursor goes after it. */
export const insertName = (text: string, at: number, token: string): { text: string; cursor: number } => {
  const before = text.slice(0, at).replace(/\s+$/, '');
  const after = text.slice(at).replace(/^\s+/, '');
  const join = before ? (/[+\-*/(]$/.test(before) ? ' ' : ' + ') : '';
  const put = `${before}${join}${token}`;
  return { text: `${put}${after ? ` ${after}` : ''}`, cursor: put.length };
};
