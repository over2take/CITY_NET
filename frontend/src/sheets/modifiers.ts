// Modifiers on wires (5b3; approved mockup docs/mockups/builder-graph.html, 2026-10-17, decision 4:
// "modifiers are diamonds on wires, not nodes of their own"). Pure: where a formula does something
// simple to one name on its way in, that is shown as a diamond on the name's wire, and its number
// changed from the node's panel, which rewrites the formula's text. Nothing new is stored.
//
// Read only where it is unmistakably that name's: the name read once, and
//   @x * 6, 6 * @x          ×6
//   @x / 2                  ÷2
//   floor(@x / 2)           ÷2↓  (halved, rounded down)
//   ceil(@x / 2)            ÷2↑

export type ModifierKind = 'times' | 'divided' | 'down' | 'up';

export interface Modifier { name: string; kind: ModifierKind; n: number; label: string; words: string }

const NUM = '(\\d+(?:\\.\\d+)?)';
const LABEL: Record<ModifierKind, (n: string) => string> = { times: (n) => `×${n}`, divided: (n) => `÷${n}`, down: (n) => `÷${n}↓`, up: (n) => `÷${n}↑` };
const WORDS: Record<ModifierKind, string> = { times: 'times', divided: 'divided by', down: 'divided by, rounded down', up: 'divided by, rounded up' };

/** Each shape a modifier takes, most particular first, with where its number is. */
const shapes = (name: string): { kind: ModifierKind; re: RegExp }[] => [
  { kind: 'down', re: new RegExp(`\\bfloor\\(\\s*@${name}\\s*/\\s*${NUM}\\s*\\)`) },
  { kind: 'up', re: new RegExp(`\\bceil\\(\\s*@${name}\\s*/\\s*${NUM}\\s*\\)`) },
  // Not a divisor itself (6 / @x * 2), and the whole number (not the 2 of 12).
  { kind: 'times', re: new RegExp(`(?<![/\\w.]\\s*)@${name}\\s*\\*\\s*${NUM}(?![\\w.])`) },
  { kind: 'times', re: new RegExp(`(?<![/\\w.]\\s*)${NUM}\\s*\\*\\s*@${name}(?![\\w(])`) },
  { kind: 'divided', re: new RegExp(`(?<![/\\w.]\\s*)@${name}\\s*/\\s*${NUM}(?![\\w.])`) },
];

const once = (text: string, name: string) => (text.match(new RegExp(`@${name}(?![a-z0-9_])`, 'g')) ?? []).length === 1;

/** The modifier on `@name` in a formula's text, or null where there isn't one plainly its own. */
export const modifierOn = (text: string, name: string): Modifier | null => {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || !once(text, name)) return null;
  for (const { kind, re } of shapes(name)) {
    const m = re.exec(text);
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n > 0)) return null;
    return { name, kind, n, label: LABEL[kind](m[1]), words: WORDS[kind] };
  }
  return null;
};

/** Every modifier in a formula's text, in the order its names are first read. */
export const modifiersIn = (text: string): Modifier[] => {
  const names = [...new Set([...text.matchAll(/@([a-z][a-z0-9_]*)/g)].map((m) => m[1]))];
  return names.map((n) => modifierOn(text, n)).filter((m): m is Modifier => !!m);
};

/** The text with `@name`'s modifier given another number, or null where there is none, or the number won't do. */
export const withModifierNumber = (text: string, name: string, n: number): string | null => {
  if (!modifierOn(text, name) || !Number.isFinite(n) || n <= 0) return null;
  for (const { re } of shapes(name)) {
    const m = re.exec(text);
    if (!m) continue;
    // The number is before the name (2 * @x) or after it (@x * 2, floor(@x / 2)); a name may hold digits itself.
    const before = m[0].indexOf(m[1]) < m[0].indexOf('@');
    const at = m.index + (before ? m[0].indexOf(m[1]) : m[0].lastIndexOf(m[1]));
    return text.slice(0, at) + String(n) + text.slice(at + m[1].length);
  }
  return null;
};
