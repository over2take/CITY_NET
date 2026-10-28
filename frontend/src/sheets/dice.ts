// STATS & RULES' DICE tab as logic (6c2a; approved mockup docs/mockups/builder-dice.html,
// 2026-10-21): a system's own dice and the symbols their faces show, edited as stored
// (backend systemBuilder/diceFaces.js checks them, and the rolls roll them). Pure: every edit
// returns the definition after it, and tests hold each to the server's checks.
//
// A face is a number (`n`, signed), symbols (`s`), both, or blank. A symbol has a name, a mark of a
// character or two, what it cancels (a pair: each cancels the other) and what it also counts as.
// The table's dice from CUSTOM_DIE.EXE stay the table's; COPY FROM THE TABLE'S DICE makes a die of
// the system's own from one, its words becoming symbols.

import type { Definition } from './systemsApi';
import type { CustomDie } from '../types';
import { idFor } from './setup';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A symbol: its name, its mark (what the log writes), what it cancels and counts as, and maybe a picture: an icon (drawn or uploaded) or a drawing. */
export interface DieSymbol { id: string; name: string; mark?: string; icon?: string; drawn?: string[]; cancels?: string; also?: string }
export interface DieFace { n?: number; s?: string[] }
export interface OwnDie { id: string; name: string; color?: 'theme' | 'danger'; faces: DieFace[] }

/** backend diceFaces.js LIMITS, held equal by a test. */
export const LIMITS = { symbols: 12, dice: 20, name: 20, mark: 2, faces: 100, perFace: 6, number: 999 } as const;

/** A system's symbols and dice, as stored. */
export const symbolList = (def: Definition): DieSymbol[] =>
  (Array.isArray(def.symbols) ? def.symbols.filter((s) => isObject(s) && typeof (s as Obj).id === 'string') as unknown as DieSymbol[] : []);
export const dieList = (def: Definition): OwnDie[] =>
  (Array.isArray(def.dice) ? def.dice.filter((d) => isObject(d) && typeof (d as Obj).id === 'string' && Array.isArray((d as Obj).faces)) as unknown as OwnDie[] : []);

const withSymbols = (def: Definition, symbols: DieSymbol[]): Definition => {
  const next: Definition = { ...def };
  if (symbols.length) next.symbols = symbols; else delete next.symbols;
  return next;
};
const withDice = (def: Definition, dice: OwnDie[]): Definition => {
  const next: Definition = { ...def };
  if (dice.length) next.dice = dice; else delete next.dice;
  return next;
};
const changedDie = (def: Definition, id: string, change: (d: OwnDie) => OwnDie): Definition =>
  withDice(def, dieList(def).map((d) => (d.id === id ? change(d) : d)));

// ─── PRESETS ────────────────────────────────────────────────────────────────

const sym = (id: string, name: string, mark: string, more: Partial<DieSymbol> = {}): DieSymbol => ({ id, name, mark, ...more });
const face = (...s: string[]): DieFace => (s.length ? { s } : {});

/** What the DICE tab starts from: Fate's dice, a set of symbol dice, and a numbered die with a word. CITY_NET's own words. */
export const DICE_PRESETS: Record<string, { label: string; symbols: DieSymbol[]; dice: OwnDie[] }> = {
  fate: {
    label: 'dF (Fate)',
    symbols: [],
    dice: [{ id: 'fate', name: 'dF', faces: [{ n: 1 }, { n: 1 }, { n: 0 }, { n: 0 }, { n: -1 }, { n: -1 }] }],
  },
  narrative: {
    label: 'Good / Great / Bad',
    symbols: [
      sym('hit', 'Hit', '✶', { cancels: 'miss' }), sym('miss', 'Miss', '✕', { cancels: 'hit' }),
      sym('edge', 'Edge', '◆', { cancels: 'snag' }), sym('snag', 'Snag', '◇', { cancels: 'edge' }),
      sym('crit', 'Crit', '★', { also: 'hit' }),
    ],
    dice: [
      { id: 'good', name: 'Good', faces: [face(), face(), face('hit'), face('hit', 'edge'), face('edge', 'edge'), face('edge')] },
      { id: 'great', name: 'Great', faces: [face(), face('hit'), face('hit'), face('hit', 'hit'), face('edge'), face('hit', 'edge'), face('edge', 'edge'), face('crit')] },
      { id: 'bad', name: 'Bad', color: 'danger', faces: [face(), face('miss'), face('miss', 'miss'), face('snag'), face('snag'), face('snag'), face('miss', 'snag'), face('snag', 'snag')] },
    ],
  },
  worded: {
    label: 'A d6 with a word',
    symbols: [sym('skull', 'Skull', '☠')],
    dice: [{ id: 'skull_die', name: 'Skull die', faces: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, face('skull')] }],
  },
};

/**
 * A preset's dice added, each under an id the system doesn't use yet, with the symbols it needs:
 * one the system already has (same id) is used as it is. Null when it would pass the limits.
 */
export const withDicePreset = (def: Definition, key: string): { definition: Definition; id: string } | null => {
  const p = DICE_PRESETS[key];
  if (!p) return null;
  const have = new Set(symbolList(def).map((s) => s.id));
  const symbols = [...symbolList(def), ...clone(p.symbols).filter((s) => !have.has(s.id))];
  if (symbols.length > LIMITS.symbols || dieList(def).length + p.dice.length > LIMITS.dice) return null;
  const dice = [...dieList(def)];
  for (const d of clone(p.dice)) dice.push({ ...d, id: idFor(d.id, dice.map((x) => x.id)) });
  return { definition: withDice(withSymbols(def, symbols), dice), id: dice[dieList(def).length].id };
};

/** A plain six-sided die to change: faces 1 to 6. */
export const withNewDie = (def: Definition): { definition: Definition; id: string } | null => {
  if (dieList(def).length >= LIMITS.dice) return null;
  const id = idFor('new_die', dieList(def).map((d) => d.id));
  return { definition: withDice(def, [...dieList(def), { id, name: 'New die', faces: [1, 2, 3, 4, 5, 6].map((n) => ({ n })) }]), id };
};

// ─── A DIE ──────────────────────────────────────────────────────────────────

/** A die renamed; its id stays (rolls name it). */
export const withDieName = (def: Definition, id: string, name: string): Definition => changedDie(def, id, (d) => ({ ...d, name: name.slice(0, LIMITS.name) }));

/** Drawn in the theme's color, or the danger color for a bad die. */
export const withDieColor = (def: Definition, id: string, danger: boolean): Definition => changedDie(def, id, (d) => {
  const next: OwnDie = { ...d, color: 'danger' };
  if (!danger) delete next.color;
  return next;
});

/**
 * How many faces, 2 to 100, fewer cut from the end. More carry the numbering on where the faces so
 * far are 1, 2, 3 in order with nothing else on them (a d6 made a d13 gets 7 to 13); otherwise
 * they are added blank.
 */
export const withFaceCount = (def: Definition, id: string, count: number): Definition => changedDie(def, id, (d) => {
  const n = Math.max(2, Math.min(LIMITS.faces, Math.trunc(count)));
  if (n <= d.faces.length) return { ...d, faces: d.faces.slice(0, n) };
  const numbered = d.faces.every((f, i) => f.n === i + 1 && !(f.s ?? []).length);
  return { ...d, faces: [...d.faces, ...Array.from({ length: n - d.faces.length }, (_, k): DieFace => (numbered ? { n: d.faces.length + k + 1 } : {}))] };
});

/** One face changed: its number (null for none) and its symbols, up to six. */
export const withFace = (def: Definition, id: string, index: number, patch: { n?: number | null; s?: string[] }): Definition => changedDie(def, id, (d) => ({
  ...d,
  faces: d.faces.map((f, i) => {
    if (i !== index) return f;
    const next: DieFace = { ...f };
    if (patch.n !== undefined) {
      if (patch.n === null || !Number.isFinite(patch.n)) delete next.n;
      else next.n = Math.max(-LIMITS.number, Math.min(LIMITS.number, Math.trunc(patch.n)));
    }
    if (patch.s !== undefined) {
      if (patch.s.length) next.s = patch.s.slice(0, LIMITS.perFace); else delete next.s;
    }
    return next;
  }),
}));

/** A die removed. A roll that rolled it shows the problem, as for anything else a roll names. */
export const withoutDie = (def: Definition, id: string): Definition => withDice(def, dieList(def).filter((d) => d.id !== id));

// ─── SYMBOLS ────────────────────────────────────────────────────────────────

/** A new symbol to name, with a mark to change. */
export const withNewSymbol = (def: Definition): { definition: Definition; id: string } | null => {
  if (symbolList(def).length >= LIMITS.symbols) return null;
  const id = idFor('new_symbol', symbolList(def).map((s) => s.id));
  return { definition: withSymbols(def, [...symbolList(def), { id, name: 'New symbol', mark: '?' }]), id };
};

/**
 * A symbol changed: its name, mark, what it cancels and what it also counts as (null for nothing).
 * Cancelling is a pair: the one it cancels cancels it back, and any partner either had before lets go.
 */
export const withSymbol = (def: Definition, id: string, patch: { name?: string; mark?: string; cancels?: string | null; also?: string | null }): Definition => {
  const next = symbolList(def).map((s) => ({ ...s }));
  const me = next.find((s) => s.id === id);
  if (!me) return def;
  if (patch.name !== undefined) me.name = patch.name.slice(0, LIMITS.name);
  if (patch.mark !== undefined) me.mark = patch.mark;
  if (patch.also !== undefined) {
    if (!patch.also || patch.also === id) delete me.also;
    else if (alsoChoices(def, id).some((c) => c.id === patch.also)) me.also = patch.also;
    else return def;
  }
  if (patch.cancels !== undefined) {
    const partner = patch.cancels && patch.cancels !== id ? next.find((s) => s.id === patch.cancels) : undefined;
    // This one, its partner before, its new partner and that one's partner before all let go.
    const loose = new Set([id, me.cancels, partner?.id, partner?.cancels].filter((x): x is string => !!x));
    for (const s of next) if (loose.has(s.id)) delete s.cancels;
    if (partner) { me.cancels = partner.id; partner.cancels = id; }
  }
  return withSymbols(def, next);
};

/**
 * What a symbol may also count as: another symbol that counts as nothing more, and none at all when
 * another already counts as this one (counting goes one step, as the server checks).
 */
export const alsoChoices = (def: Definition, id: string): DieSymbol[] => {
  const list = symbolList(def);
  if (list.some((s) => s.also === id)) return [];
  return list.filter((s) => s.id !== id && !s.also);
};

/** A symbol removed: off every face, and nothing cancels it or counts as it any more. */
export const withoutSymbol = (def: Definition, id: string): Definition => {
  const symbols = symbolList(def).filter((s) => s.id !== id).map((s) => {
    const n = { ...s };
    if (n.cancels === id) delete n.cancels;
    if (n.also === id) delete n.also;
    return n;
  });
  const dice = dieList(def).map((d) => ({
    ...d,
    faces: d.faces.map((f) => {
      if (!f.s?.includes(id)) return f;
      const s = f.s.filter((x) => x !== id);
      const next: DieFace = { ...f };
      if (s.length) next.s = s; else delete next.s;
      return next;
    }),
  }));
  return withDice(withSymbols(def, symbols), dice);
};

// ─── A SYMBOL'S LOOK (6c2b1, decision 10) ───────────────────────────────────

/** A drawing nothing has been drawn on: 16 rows of 16 empty squares, as stored (4 hex digits a row). */
export const BLANK_DRAWN: string[] = Array.from({ length: 16 }, () => '0000');

/** Whether square (x, y) of a drawing is drawn: the row's highest bit is its first square. */
export const drawnAt = (drawn: string[], x: number, y: number): boolean => ((parseInt(drawn[y] ?? '0', 16) >> (15 - x)) & 1) === 1;

/** A drawing with square (x, y) drawn or rubbed out. */
export const withSquare = (drawn: string[], x: number, y: number, on: boolean): string[] => drawn.map((row, i) => {
  if (i !== y || x < 0 || x > 15) return row;
  const bits = parseInt(row, 16);
  const next = on ? bits | (1 << (15 - x)) : bits & ~(1 << (15 - x));
  return next.toString(16).padStart(4, '0');
});

/** The squares drawn, for drawing them: [x, y] each. */
export const drawnSquares = (drawn: string[]): [number, number][] =>
  drawn.flatMap((_, y) => Array.from({ length: 16 }, (__, x) => x).filter((x) => drawnAt(drawn, x, y)).map((x): [number, number] => [x, y]));

/**
 * What a symbol looks like on the dice: its mark; one of the drawn icons or an upload; or a drawing.
 * One picture at a time. The mark is kept for the log (made from the name's first letter if there is none).
 */
export const withSymbolLook = (def: Definition, id: string, look: { mark: true } | { icon: string } | { drawn: string[] }): Definition => withSymbols(def, symbolList(def).map((s) => {
  if (s.id !== id) return s;
  const next: DieSymbol = { ...s };
  delete next.icon;
  delete next.drawn;
  if (!next.mark) next.mark = [...(s.name || '?')][0].toUpperCase();
  if ('icon' in look) next.icon = look.icon;
  if ('drawn' in look) next.drawn = look.drawn.slice(0, 16);
  return next;
}));

// ─── THE TABLE'S DICE ───────────────────────────────────────────────────────

/**
 * A die of the system's own from one of the table's (CUSTOM_DIE.EXE): a face that is a whole
 * number stays a number (+1 and -1 too); a face of words becomes a symbol of that name, the one the
 * system already has by that name if any, its first letter for a mark. Null, with why, when it
 * would pass the limits.
 */
export const withTableDie = (def: Definition, die: Pick<CustomDie, 'name' | 'faces'>): { definition: Definition; id: string } | { definition: null; message: string } => {
  if (dieList(def).length >= LIMITS.dice) return { definition: null, message: `A system has at most ${LIMITS.dice} dice.` };
  const symbols = symbolList(def).map((s) => ({ ...s }));
  const faces = die.faces.slice(0, LIMITS.faces).map((f): DieFace => {
    const text = String(f.value ?? '').trim();
    if (/^[+-]?\d+$/.test(text) && Math.abs(Number(text)) <= LIMITS.number) return { n: Number(text) };
    if (!text) return {};
    const name = text.slice(0, LIMITS.name);
    let s = symbols.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) {
      s = { id: idFor(name, symbols.map((x) => x.id)), name, mark: [...name][0].toUpperCase() };
      symbols.push(s);
    }
    return { s: [s.id] };
  });
  if (symbols.length > LIMITS.symbols) return { definition: null, message: `Its words would make more than ${LIMITS.symbols} symbols.` };
  while (faces.length < 2) faces.push({});
  const id = idFor(die.name || 'die', dieList(def).map((d) => d.id));
  return { definition: withDice(withSymbols(def, symbols), [...dieList(def), { id, name: (die.name || 'Die').slice(0, LIMITS.name), faces }]), id };
};

// ─── IN WORDS ───────────────────────────────────────────────────────────────

/** A face as the dice and the log show it: its number (signed on a die with any below 0) and its symbols' marks; '·' for a blank. */
export const faceText = (d: OwnDie, f: DieFace, symbols: DieSymbol[]): string => {
  const signed = d.faces.some((x) => (x.n ?? 0) < 0);
  const n = f.n === undefined ? '' : signed && f.n > 0 ? `+${f.n}` : String(f.n);
  const marks = (f.s ?? []).map((id) => { const s = symbols.find((x) => x.id === id); return s?.mark ?? s?.name.slice(0, 1).toUpperCase() ?? id; }).join('');
  return `${n}${marks}` || '·';
};

/** A face in words, for its box: "+1", "HIT EDGE", "3 SKULL", or BLANK. */
export const faceWords = (f: DieFace, symbols: DieSymbol[]): string =>
  [f.n === undefined ? '' : f.n > 0 ? `+${f.n}` : String(f.n), ...(f.s ?? []).map((id) => (symbols.find((x) => x.id === id)?.name ?? id).toUpperCase())].filter(Boolean).join(' ') || 'BLANK';
