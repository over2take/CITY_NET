// The CHOICES page's IMPORT as logic (choices import 2; approved mockup docs/mockups/choices-import.html,
// 2026-10-28): the two files it hands out, and what it shows of a preview. The reading is the
// server's alone (backend/systemBuilder/choicesImport.js): PREVIEW sends the text and shows what came
// back, so what the GM is shown is what APPLY puts into the draft. The files written here are read
// back by that reader in a test, so a downloaded list imported unchanged changes nothing.
//
//   DOWNLOAD EXAMPLE   a .csv for one list, made from the system: the @names its formulas read, its
//                      rests by name, a level column only for a levelled list, and made-up rows.
//   DOWNLOAD THIS LIST what the list holds now, in the same shape; what a feature does beyond words
//                      and uses is a # note, as an import never touches it.

import type { Definition } from './systemsApi';
import { choiceLists, featureList, kindsOf, levelOf, type ChoiceList } from './choices';
import { allStats, formulaList } from './statsRules';
import { restList } from './rests';

/** backend choicesImport.js MAX_BYTES, held equal by a test. */
export const MAX_BYTES = 200_000;

/** What changed in one part of an option or feature, as the server says it. */
export interface ImportPart { part: 'description' | 'requires' | 'level' | 'words' | 'uses' | 'refill'; from: string | number; to: string | number }
/** A preview: the list as it would be, what is new and what changes, and each line skipped and why. */
export interface ImportPreview {
  list: ChoiceList;
  added: {
    options: { line: number; option: string; requires?: string }[];
    features: { line: number; option: string; feature: string; level?: number; uses?: string; refill?: string }[];
  };
  changed: {
    options: { line: number; option: string; parts: ImportPart[] }[];
    features: { line: number; option: string; feature: string; parts: ImportPart[] }[];
  };
  same: number;
  skipped: { line: number; message: string }[];
  notes: { line: number; message: string }[];
  changes: number;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * One cell as a spreadsheet writes it. A cell can't hold a line break or a tab (the reader splits
 * lines first, and one tab makes the whole file tab-separated), so those become spaces; quoted when
 * it holds a separator or a quote, has spaces at its ends, or starts with # (a note otherwise).
 */
const cell = (v: unknown): string => {
  const s = (v === undefined || v === null ? '' : String(v)).replace(/[\r\n\t]+/g, ' ');
  return /[",;]|^\s|\s$|^#/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cells: unknown[]) => cells.map(cell).join(', ');

/** A file name's part from a system's or list's name. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'system';
export const fileName = (def: Definition, list: ChoiceList, kind: 'example' | 'list') =>
  `${slug(typeof def.name === 'string' ? def.name : '')}-${slug(list.many || list.id)}${kind === 'example' ? '-example' : ''}.csv`;

/** The rests a file names, by name where that is how the reader finds them: on and named once. */
const restNames = (def: Definition) => {
  const rests = restList(def);
  const named = (name: string) => rests.filter((r) => r.on && r.name.trim().toLowerCase() === name.trim().toLowerCase()).length === 1;
  return {
    offered: rests.filter((r) => r.on).map((r) => r.name),
    of: (id: string) => { const r = rests.find((x) => x.id === id); return r && r.on && named(r.name) ? r.name : id; },
  };
};

/** The names a formula in the file can read, for the notes at its top. */
const readable = (def: Definition, list: ChoiceList): string[] => {
  const own = [...allStats(def).map((s) => s.id), ...formulaList(def).map((f) => f.id)].filter((id): id is string => typeof id === 'string');
  const levelled = choiceLists(def).filter((c) => c.levelled);
  const levels = [
    ...(levelled.length && !own.includes('level') ? ['level'] : []),
    ...levelled.map((c) => `${c.id}_level`),
  ];
  const shown = own.slice(0, 16).map((n) => `@${n}`);
  const more = own.length > 16 ? [`and ${own.length - 16} more`] : [];
  const option = list.levelled ? list.options[0]?.id : levelled[0]?.options[0]?.id;
  return [...shown, ...more, ...levels.map((n) => `@${n}`), ...(levelled.length ? [`each option's own level, like @${option ?? 'soldier'}_level`] : [])];
};

const head = (def: Definition, list: ChoiceList, rests: string[], intro: string[]): string[] => {
  const many = (list.many || list.id).toUpperCase();
  const names = readable(def, list);
  return [
    ...intro,
    '# Lines starting with # are notes and are skipped. A cell with a comma in it needs "quotes".',
    `# Matched by name: a name already in ${many} is updated, a new name is added. Nothing is deleted.`,
    '# An empty cell leaves that part as it is; write - to clear it.',
    '#',
    `# requires and uses are formulas, as in the builder. They can read ${names.length ? names.join(', ') : 'numbers only (this system has no stats yet)'}.`,
    `# refill is one of this system's rests, by name: ${rests.length ? rests.join(', ') : 'none (it has none on)'}. It needs uses.`,
    list.levelled
      ? '# level is when a feature unlocks, 1 to 30. Features of one name at several levels are told apart by level.'
      : `# ${many} isn't levelled, so features have no level.`,
    '# Modifiers, rolls and the lists a feature opens are set in the builder; an import never changes them.',
  ];
};

const featureColumns = (list: ChoiceList) => (list.levelled ? 'option, feature, level, words, uses, refill' : 'option, feature, words, uses, refill');

/** DOWNLOAD EXAMPLE: a file in the right shape for this list, with made-up rows to replace. */
export const exampleFile = (def: Definition, list: ChoiceList): string => {
  const many = (list.many || list.id).toUpperCase();
  const rests = restNames(def).offered;
  const [first, second] = [rests[0] ?? '', rests[1] ?? rests[0] ?? ''];
  const stat = allStats(def).map((s) => s.id).find((id) => typeof id === 'string');
  const f = (option: string, feature: string, level: number, words: string, uses = '', refill = '') =>
    (list.levelled ? row(option, feature, level, words, uses, uses ? refill : '') : row(option, feature, words, uses, uses ? refill : ''));
  return [
    ...head(def, list, rests, [
      `# ${many} for ${def.name || 'this system'}, to import on the builder's CHOICES page (IMPORT on the ${many} list).`,
      '# The rows below are made up, to show the shape: replace them with your own.',
    ]),
    '',
    '[options]',
    'name, description, requires',
    row('Veteran', 'Has seen worse, and says so.', stat ? `@${stat} >= 13` : ''),
    row('Scholar', 'Reads everything twice.', ''),
    '',
    '[features]',
    featureColumns(list),
    f('Veteran', 'Hard to Rattle', 1, 'Keeps a cool head when it counts.'),
    f('Veteran', 'Second Wind', 2, 'Catch your breath and keep going.', '1', first),
    f('Scholar', 'Flash of Insight', 1, 'Know the answer, once.', '2', second),
    ...(list.levelled ? [f('Scholar', 'Training', 4, 'Raise one stat.'), f('Scholar', 'Training', 8, 'Raise one stat.')] : []),
    '',
  ].join('\n');
};

const ALSO: Record<string, string> = { modifier: 'modifiers', roll: 'rolls it gives', change: 'roll changes', choice: 'a list it opens' };

/** DOWNLOAD THIS LIST: what the list holds now, to keep as a copy or edit and import back. */
export const listFile = (def: Definition, list: ChoiceList): string => {
  const many = (list.many || list.id).toUpperCase();
  const rests = restNames(def);
  const lines = [
    ...head(def, list, rests.offered, [
      `# ${many} in ${def.name || 'this system'} as it is now. Edit it and import it back on the same list; rows left as they are change nothing.`,
    ]),
    '',
    '[options]',
    'name, description, requires',
    ...list.options.map((o) => row(o.label, o.description ?? '', o.requires ?? '')),
    '',
    '[features]',
    featureColumns(list),
  ];
  for (const o of list.options) {
    for (const f of featureList(o)) {
      const also = kindsOf(f).filter((k) => ALSO[k]).map((k) => ALSO[k]);
      if (also.length) lines.push(`# ${o.label} · ${f.label} also has ${also.join(', ')}, set in the builder`);
      const uses = isObject(f.uses) && f.uses.count !== undefined ? String(f.uses.count) : '';
      const refill = uses && typeof f.uses?.refill === 'string' ? rests.of(f.uses.refill) : '';
      lines.push(list.levelled ? row(o.label, f.label, levelOf(f), f.text ?? '', uses, refill) : row(o.label, f.label, f.text ?? '', uses, refill));
    }
  }
  return [...lines, ''].join('\n');
};

/** The definition with a previewed list put in place of the one of its id. */
export const withImported = (def: Definition, list: ChoiceList): Definition => ({
  ...def,
  choices: (Array.isArray(def.choices) ? def.choices : []).map((c) => (isObject(c) && c.id === list.id ? list : c)),
});

/** Where line `line` (from 1) is in `text`, to select it. */
export const lineRange = (text: string, line: number): { from: number; to: number } => {
  let from = 0;
  for (let n = 1; n < line; n += 1) {
    const next = text.indexOf('\n', from);
    if (next < 0) return { from: text.length, to: text.length };
    from = next + 1;
  }
  const end = text.indexOf('\n', from);
  return { from, to: (end < 0 ? text.length : end) - (text[end - 1] === '\r' ? 1 : 0) };
};

const PART_NAMES: Record<ImportPart['part'], string> = { description: 'WHAT IT IS', requires: 'REQUIRES', level: 'LEVEL', words: 'WORDS', uses: 'USES', refill: 'REFILL' };
const short = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);

/** One change as the preview says it: WHAT IT IS "Reads the weave." → "Reads it, and bends it.". */
export const partText = (def: Definition, p: ImportPart): string => {
  const rests = restList(def);
  const shown = (v: string | number) => {
    if (v === '' || v === undefined || v === null) return 'nothing';
    if (p.part === 'refill') return (rests.find((r) => r.id === v)?.name ?? String(v)).toUpperCase();
    return p.part === 'description' || p.part === 'words' ? `"${short(String(v))}"` : String(v);
  };
  return `${PART_NAMES[p.part]} ${shown(p.from)} → ${shown(p.to)}`;
};

/** A new feature as the preview says it: SOLDIER · RALLY · LEVEL 2 · 1 USE, SHORT REST. */
export const addedFeatureText = (def: Definition, f: ImportPreview['added']['features'][number]): string => {
  const rest = f.refill ? restList(def).find((r) => r.id === f.refill)?.name ?? f.refill : '';
  return [f.option, f.feature, ...(f.level ? [`LEVEL ${f.level}`] : []),
    ...(f.uses ? [`${f.uses} USE${f.uses === '1' ? '' : 'S'}${rest ? `, ${rest}` : ''}`] : [])].join(' · ').toUpperCase();
};
