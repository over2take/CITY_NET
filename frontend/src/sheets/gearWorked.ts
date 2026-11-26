// A line of gear's DAMAGE and DICE worked out on the character (8e1; approved mockup docs/mockups/gear-table.html, answered
// 2026-11-25): the sum already done, as the table says it, and the number the button the roll is. A lone d20 says its
// bonus (+12); other dice keep them with their sum (1d8+7); each part of a DAMAGE that names its types its own, with its
// type. The formula and what each name is on this character behind a "?". Read by the server as ROLL would (backend
// gearRolls.js readGearLines). Pure; GearTypeTables draws it.

import type { GearDiceRead } from './gearDice';

/** A part's dice kept and all else summed (the server's `worked`): "1d8 + @str_mod + 3" as 1d8 and 7. */
export interface WorkedPart { dice: { count: number; sides: number }[]; add: number; type: string | null }

const minus = (n: number) => `−${-n}`;

/** A part as the line shows it: a lone d20 its bonus (+12, −1, +0), other dice with their sum (1d8+7), no dice its number. */
export const partShown = (p: WorkedPart, lone: boolean): string => {
  if (lone && p.dice.length === 1 && p.dice[0].count === 1 && p.dice[0].sides === 20) return p.add < 0 ? minus(p.add) : `+${p.add}`;
  if (!p.dice.length) return p.add < 0 ? minus(p.add) : String(p.add);
  const added = p.add === 0 ? '' : p.add > 0 ? `+${p.add}` : minus(p.add);
  return `${p.dice.map((d) => `${d.count}d${d.sides}`).join('+')}${added}`;
};

/** A part said in full for its "?": "1d20 + 11", "1d6 + 4 PIERCING". */
const partWords = (p: WorkedPart): string => {
  const dice = p.dice.map((d) => `${d.count}d${d.sides}`).join(' + ');
  const added = p.add === 0 ? '' : `${dice ? (p.add > 0 ? ' + ' : ' − ') : (p.add < 0 ? '−' : '')}${Math.abs(p.add)}`;
  return `${dice}${added || (dice ? '' : '0')}${p.type ? ` ${p.type}` : ''}`;
};

/**
 * What a DAMAGE or DICE cell shows on the line, from what the server read of `text`:
 * - `reading` before an answer (or with nobody to ask): as today, its words and ROLL;
 * - `roll`: the worked-out parts, the button, and its "?";
 * - `as typed`: a roll with no plain sum (a die taken away, doubled): its words, ROLL, and its "?";
 * - `wont`: what won't roll (a name the game hasn't): its words, no button, the "?" saying why.
 */
export type CellShown =
  | { kind: 'reading' }
  | { kind: 'roll'; parts: { text: string; type: string | null }[]; hint: string }
  | { kind: 'as typed'; hint: string }
  | { kind: 'wont'; hint: string };

export const cellShown = (text: string, read: GearDiceRead | null | undefined): CellShown => {
  if (!read) return { kind: 'reading' };
  if (!read.ok) return { kind: 'wont', hint: `${text.trim()}: ${read.error}. It won't roll.` };
  if ('blank' in read && read.blank) return { kind: 'reading' };
  const r = read as Extract<GearDiceRead, { low: number }>;
  let named = text.trim();
  for (const u of r.used) named = named.split(u.token).join(`${u.label} (${u.value})`);
  const range = r.low === r.high ? `${r.low}` : `${r.low} to ${r.high}`;
  // What each name is on this character, said only where there are names to say.
  const said = named === text.trim() ? text.trim() : `${text.trim()} · on this character ${named}`;
  const worked = r.worked ?? null;
  if (!worked || !worked.length) return { kind: 'as typed', hint: `${said}: ${range}` };
  const lone = worked.length === 1;
  return {
    kind: 'roll',
    parts: worked.map((p) => ({ text: partShown(p, lone), type: p.type })),
    hint: `${said} = ${worked.map(partWords).join(' + ')} (${range})`,
  };
};

/** Every DAMAGE and DICE text on the lines, once each, in the order first met: what one reading asks of the server. */
export const textsToRead = (cells: { kind: string; text: string }[]): string[] =>
  [...new Set(cells.filter((c) => (c.kind === 'damage' || c.kind === 'dice') && c.text.trim()).map((c) => c.text))];
