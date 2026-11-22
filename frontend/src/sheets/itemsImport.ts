// The ITEMS tab's IMPORT as logic (8aL3b; approved mockup docs/mockups/items-layout.html, 2026-11-14, section 5): the
// two files it hands out and what it shows of a preview. The reading is the server's alone (backend
// systemBuilder/itemsImport.js): PREVIEW sends the text and shows what came back, so what the GM is shown is what APPLY
// puts into the draft. Both files are read back by that reader in a test: the example has no mistakes, and a list
// downloaded and imported unchanged changes nothing.
//
//   DOWNLOAD EXAMPLE   made from the system it comes from (the user's call): a section per type it has, headed by that
//                      type's own columns; NEEDS in its own words; COST only where it has an install; made-up rows that
//                      fit each column, dice reading its own names, PICK ONE its own words, a rest its own.
//   DOWNLOAD THIS LIST what its items are now, in the same shape; what a feature does beyond words and uses is a # note.

import type { Definition } from './systemsApi';
import { itemList, itemSlots, itemInstalls, itemFeatures, type Item } from './items';
import { itemTypes, ownTypes, typeOf, itemValues, type ItemType, type ItemColumn } from './itemTypes';
import { allStats, formulaList } from './statsRules';
import { restList } from './rests';
import { kindsOf } from './choices';

export { MAX_BYTES, lineRange } from './choicesImport';

/** What changed in one part of an item or feature, as the server says it. */
export interface ItemsImportPart { part: string; from: string; to: string }
/** A preview: the items part as it would be, what is new and what changes, and each line skipped and why. */
export interface ItemsImportPreview {
  items: Record<string, unknown>;
  added: { items: { line: number; item: string; type: string }[]; features: { line: number; item: string; feature: string }[] };
  changed: {
    items: { line: number; item: string; parts: ItemsImportPart[] }[];
    features: { line: number; item: string; feature: string; parts: ItemsImportPart[] }[];
  };
  same: number;
  skipped: { line: number; message: string }[];
  notes: { line: number; message: string }[];
  changes: number;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** One cell as a spreadsheet writes it, as CHOICES' files have them: quoted when it must be, no line breaks or tabs. */
const cell = (v: unknown): string => {
  const s = (v === undefined || v === null ? '' : String(v)).replace(/[\r\n\t]+/g, ' ');
  return /[",;]|^\s|\s$|^#/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cells: unknown[]) => cells.map(cell).join(', ');

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'system';
export const itemsFileName = (def: Definition, kind: 'example' | 'list') =>
  `${slug(typeof def.name === 'string' ? def.name : '')}-items${kind === 'example' ? '-example' : ''}.csv`;

/** A type's section name: its name as the GM gave it, or its id where another type has the same name. */
const sectionOf = (types: ItemType[], t: ItemType) => {
  const name = (t.label.trim() || t.id).toLowerCase();
  return types.filter((x) => (x.label.trim() || x.id).toLowerCase() === name).length > 1 ? t.id : name;
};
/** A column's head: its name, or its id where the name is taken (by another column or what every item has). */
const headOf = (t: ItemType, c: ItemColumn) => {
  const name = (c.label.trim() || c.id).toLowerCase();
  const clash = ['name', 'needs', 'cost', 'words', 'in shops'].includes(name) || t.columns.filter((x) => (x.label.trim() || x.id).toLowerCase() === name).length > 1;
  return clash ? c.id : name;
};
const hasInstalls = (def: Definition) => itemInstalls(def).length > 0;
const tail = (def: Definition) => ['needs', ...(hasInstalls(def) ? ['cost'] : []), 'words'];

/** Whether a type has a column called price, by name or id: it holds the price (backend itemsImport.js pricedByColumn). */
const pricedByColumn = (t: ItemType) => t.columns.some((c) => c.id.toLowerCase() === 'price' || c.label.trim().toLowerCase() === 'price');
/** The shops' columns a section has (8a7a3b2), in a game with types of its own: an item's own price, where its type has no
 *  column holding it, and IN SHOPS. */
const shopHeads = (def: Definition, t: ItemType) => (ownTypes(def) ? [...(pricedByColumn(t) ? [] : ['price']), 'in shops'] : []);
/** An item's cells for them: its own price, and IN SHOPS only where it says so, so a file read back changes nothing. */
const shopCells = (def: Definition, t: ItemType, i: { price?: number; in_shops?: boolean }) => (ownTypes(def)
  ? [...(pricedByColumn(t) ? [] : [typeof i.price === 'number' ? i.price : '']), i.in_shops === true ? 'yes' : i.in_shops === false ? 'no' : ''] : []);

/** What an item needs, in the words a file says it: worn, carried, or a slot's or install's name. */
const needsWord = (def: Definition, needs: string | undefined) => {
  if (!needs || needs === 'worn') return 'worn';
  const named = [...itemSlots(def), ...itemInstalls(def)].find((s) => s.id === needs);
  return named ? (named.label.trim() || named.id).toLowerCase() : needs;
};

/** The rests by the name the reader finds them by: on and named once, else the id. */
const restWords = (def: Definition) => {
  const rests = restList(def);
  const once = (name: string) => rests.filter((r) => r.on && r.name.trim().toLowerCase() === name.trim().toLowerCase()).length === 1;
  return {
    offered: rests.filter((r) => r.on).map((r) => r.name),
    of: (id: string) => { const r = rests.find((x) => x.id === id); return r && r.on && once(r.name) ? r.name : id; },
  };
};

/** A name dice can read, for the made-up rows: a modifier formula first, then a stat. */
const diceName = (def: Definition): string | null => {
  const mod = formulaList(def).map((f) => f.id).find((id) => typeof id === 'string' && id.endsWith('_mod'));
  return mod ?? allStats(def).map((s) => s.id).find((id): id is string => typeof id === 'string') ?? null;
};

/** A made-up value that fits a column: the first row's, then the second's. */
const sampleOf = (def: Definition, c: ItemColumn, second: boolean): string | number => {
  const name = diceName(def);
  switch (c.kind) {
    case 'damage': return second ? '1d6' : `1d8${name ? ` + @${name}` : ''}`;
    case 'dice': return second ? '1d4' : '2d4 + 2';
    case 'text': return second ? 'melee' : '30 m';
    case 'count': return second ? 1 : 6;
    case 'pick': { const w = c.options ?? []; return w.length ? w[second && w.length > 1 ? 1 : 0] : ''; }
    default: return /price|cost|value/i.test(c.label) ? (second ? 5 : 25) : (second ? 1 : 2);
  }
};

/** The notes at the top of a file: how it is read, in this system's words. */
const head = (def: Definition, intro: string[]): string[] => {
  const types = itemTypes(def);
  const name = diceName(def);
  const picks = types.flatMap((t) => t.columns.filter((c) => c.kind === 'pick').map((c) => `${(t.label || t.id).toUpperCase()} ${(c.label || c.id).toUpperCase()}: ${(c.options ?? []).join(', ') || 'no words yet'}`));
  const needs = ['worn', 'carried', ...itemSlots(def).map((s) => `${(s.label || s.id).toLowerCase()} (a slot)`), ...itemInstalls(def).map((s) => `${(s.label || s.id).toLowerCase()} (an install)`)];
  const rests = restWords(def).offered;
  return [
    ...intro,
    '# Lines starting with # are notes and are skipped. A cell with a comma in it needs "quotes".',
    '# Each [section] is one of this system\'s types, headed by its own columns. Matched by name: a name already here is updated',
    '# (and made the section\'s type), a new name is added. Nothing is deleted. An empty cell leaves that part as it is; write - to clear it.',
    '#',
    `# DAMAGE and DICE are dice, like ${name ? `1d8 + @${name}` : '1d8 + 2'}. A COUNT is how many it holds, 0 to 1000. A NUMBER is a number.`,
    ...(picks.length ? [`# PICK ONE is one of its words: ${picks.join('; ')}.`] : []),
    `# needs is when its features count: ${needs.join(', ')}.`,
    ...(hasInstalls(def) ? ['# cost is what installing it costs, for an item that needs an install: fractions are fine, 0.25.'] : []),
    ...(ownTypes(def) ? ['# price is what it costs in the shops, a number (a type with a PRICE column of its own has it there). in shops is yes or no:',
      '# no keeps it out of every shop, only given; yes needs a price.'] : []),
    `# [features]: refill is one of this system's rests, by name: ${rests.length ? rests.join(', ') : 'none (it has none on)'}. It needs uses.`,
    '# Modifiers, rolls and roll changes are set in the builder; an import never changes them.',
  ];
};

/**
 * The import box's grey hint (8a7a5): this system's first type as its section, headed by the columns the file has, and the
 * features section. It showed a fixed [gear] in every game.
 */
export const itemsHint = (def: Definition): string => {
  const types = itemTypes(def);
  const t = types[0];
  return 'Paste a table here, or upload a file. DOWNLOAD EXAMPLE gives one in the right shape.\n\n'
    + `[${sectionOf(types, t)}]\n${['name', ...t.columns.map((c) => headOf(t, c)), ...shopHeads(def, t), ...tail(def)].join(', ')}\n\n[features]\nitem, feature, words, uses, refill`;
};

/** DOWNLOAD EXAMPLE: a file made from this system, a section per type, with made-up rows that fit each column. */
export const exampleItemsFile = (def: Definition): string => {
  const types = itemTypes(def);
  const installs = itemInstalls(def);
  const slots = itemSlots(def);
  const rest = restWords(def).offered[0] ?? '';
  const lines = [
    ...head(def, [
      `# Items for ${def.name || 'this system'}, to import on the builder's ITEMS page (IMPORT on the ITEMS tab).`,
      '# The rows below are made up, to show the shape: replace them with your own.',
    ]),
  ];
  // The second row of each needs something else where the system has it: a slot, else an install (with its cost), else carried.
  const other = slots[0] ?? installs[0];
  const secondNeeds = other ? (other.label.trim() || other.id).toLowerCase() : 'carried';
  const secondCost = installs.some((s) => s.id === other?.id) ? 1 : '';
  types.forEach((t) => {
    const one = t.one?.trim() || t.label.trim() || t.id;
    lines.push('', `[${sectionOf(types, t)}]`, ['name', ...t.columns.map((c) => headOf(t, c)), ...shopHeads(def, t), ...tail(def)].join(', '));
    // The first sold at a price, the second kept out of the shops (8a7a3b2).
    lines.push(row(`Sample ${one}`, ...t.columns.map((c) => sampleOf(def, c, false)), ...shopCells(def, t, { price: 25, in_shops: true }), 'worn', ...(installs.length ? [''] : []), 'What the table reads about it.'));
    lines.push(row(`Sample ${one} 2`, ...t.columns.map((c) => sampleOf(def, c, true)), ...shopCells(def, t, { in_shops: false }), secondNeeds, ...(installs.length ? [secondCost] : []), ''));
  });
  const first = types[0];
  lines.push('', '[features]', 'item, feature, words, uses, refill',
    row(`Sample ${first.one?.trim() || first.label.trim() || first.id}`, 'A feature', 'What it does, in words.', rest ? 1 : '', rest), '');
  return lines.join('\n');
};

/** The words an item's feature has beyond what a file carries, for its # note. */
const ALSO: Record<string, string> = { modifier: 'modifiers', roll: 'rolls it gives', change: 'roll changes' };

/** DOWNLOAD THIS LIST: the system's items as they are now, to keep as a copy or edit and import back. */
export const itemsListFile = (def: Definition): string => {
  const types = itemTypes(def);
  const items = itemList(def);
  const rests = restWords(def);
  const lines = [...head(def, [`# The items of ${def.name || 'this system'} as they are now. Edit them and import them back; rows left as they are change nothing.`])];
  for (const t of types) {
    const mine = items.filter((i) => typeOf(def, i.type).id === t.id);
    if (!mine.length && ownTypes(def)) continue;
    lines.push('', `[${sectionOf(types, t)}]`, ['name', ...t.columns.map((c) => headOf(t, c)), ...shopHeads(def, t), ...tail(def)].join(', '));
    for (const i of mine) {
      const values = itemValues(def, i);
      lines.push(row(i.label, ...t.columns.map((c) => values[c.id] ?? ''), ...shopCells(def, t, i), needsWord(def, i.needs),
        ...(hasInstalls(def) ? [typeof i.cost === 'number' ? i.cost : ''] : []), i.description ?? ''));
    }
  }
  lines.push('', '[features]', 'item, feature, words, uses, refill');
  for (const i of items) {
    for (const f of itemFeatures(i)) {
      const also = kindsOf(f).filter((k) => ALSO[k]).map((k) => ALSO[k]);
      if (also.length) lines.push(`# ${i.label} · ${f.label} also has ${also.join(', ')}, set in the builder`);
      const uses = isObject(f.uses) && f.uses.count !== undefined ? String(f.uses.count) : '';
      const refill = uses && typeof f.uses?.refill === 'string' ? rests.of(f.uses.refill) : '';
      lines.push(row(i.label, f.label, f.text ?? '', uses, refill));
    }
  }
  return [...lines, ''].join('\n');
};

/** The definition with a previewed items part put in place. */
export const withImportedItems = (def: Definition, items: Record<string, unknown>): Definition => {
  const next: Definition = { ...def };
  if (Object.keys(items).length) next.items = items; else delete next.items;
  return next;
};

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);

/** One change as the preview says it: DAMAGE 2d6 → 2d6 + @might; NEEDS WORN → ATTUNED; WORDS "…" → "…". */
export const itemPartText = (def: Definition, p: ItemsImportPart): string => {
  const shown = (v: string) => {
    if (v === '' || v === undefined || v === null) return 'nothing';
    if (p.part === 'needs') return needsWord(def, v).toUpperCase();
    if (p.part === 'refill') return (restList(def).find((r) => r.id === v)?.name ?? v).toUpperCase();
    return p.part === 'words' ? `"${short(v)}"` : v;
  };
  return `${p.part.toUpperCase()} ${shown(p.from)} → ${shown(p.to)}`;
};

/** The ids of every item and item feature, to say which an APPLY added. */
export const itemIdsOf = (items: Record<string, unknown> | undefined): string[] =>
  (Array.isArray(items?.list) ? items!.list as Item[] : []).filter(isObject).flatMap((i) => [i.id, ...itemFeatures(i as Item).map((f) => f.id)]);
