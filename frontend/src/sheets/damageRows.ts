// An item's DAMAGE as rows, one per part (8b2b; approved 2026-11-23, "that's perfect"): each part's dice in a box of its own
// with eˣ, its TYPE picked from the game's damage types, + PART for another. Kept as the text the server reads (backend
// systemBuilder/damageText.js, held to this by the tests), so files, imports and rolls never change: "1d8 + @might_mod
// SLASHING + 2d6 FIRE DMG". A text the rows can't say the same (a word that is no type, a type with no dice) stays one box.
// Pure.

/** One part: its dice and formula, and the damage type it is (its id), or none. */
export interface DamageRow { dice: string; type: string | null }
/** A damage type as the rows offer it: its id and the name a hit says. */
export interface RowType { id: string; name: string }

/** Words the formula language has that are never a type. */
const LANGUAGE = new Set(['and', 'or', 'not']);
const DIE_WORD = /^d\d+$/i;

/** The runs of bare words outside brackets that name a type, as the server finds them (damageText.js typeRuns). */
const typeRuns = (text: string): { start: number; end: number; words: string[] }[] => {
  const runs: { start: number; end: number; words: string[] }[] = [];
  let depth = 0;
  let run: { start: number; end: number; words: string[] } | null = null;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '(') { depth += 1; run = null; i += 1; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); run = null; i += 1; continue; }
    if (depth === 0 && /[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9_@.]/.test(text[i - 1]))) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_'-]/.test(text[j])) j += 1;
      const word = text.slice(i, j).replace(/[-']+$/, '');
      const next = text.slice(j).match(/^\s*(\S)?/)![1];
      const bare = !!word && !DIE_WORD.test(word) && !LANGUAGE.has(word.toLowerCase()) && next !== '(';
      if (bare) {
        if (run && /^[\s-]*$/.test(text.slice(run.end, i))) { run.end = j; run.words.push(word); } else { run = { start: i, end: j, words: [word] }; runs.push(run); }
      } else run = null;
      i = Math.max(j, i + 1);
      continue;
    }
    i += 1;
  }
  return runs;
};

/** A DAMAGE value's parts, as the server reads them (damageText.js damageParts): each its dice, and its type's words or none. */
export const damageParts = (value: string): { text: string; label: string | null }[] => {
  const runs = typeRuns(value);
  if (!runs.length) return [{ text: value.trim(), label: null }];
  const parts: { text: string; label: string | null }[] = [];
  let from = 0;
  for (const r of runs) {
    const words = r.words.filter((w) => w.toLowerCase() !== 'dmg');
    parts.push({ text: value.slice(from, r.start).trim(), label: words.length ? words.join(' ') : null });
    from = r.end;
  }
  const rest = value.slice(from).trim();
  if (rest) parts.push({ text: rest, label: null });
  return parts.map((p, i) => ({ ...p, text: i > 0 ? p.text.replace(/^\+\s*/, '') : p.text }));
};

/** A type's name as a hit says it, compared: capitals, one space. */
const said = (name: string) => name.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * The rows a DAMAGE value is, or null where they can't say it the same and it stays one box: a part with no dice, or words
 * that are none of `types`. Empty, one empty row.
 */
export const rowsOf = (value: string, types: RowType[]): DamageRow[] | null => {
  if (!value.trim()) return [{ dice: '', type: null }];
  const rows: DamageRow[] = [];
  for (const p of damageParts(value)) {
    if (!p.text) return null;
    if (!p.label) { rows.push({ dice: p.text, type: null }); continue; }
    const t = types.find((x) => said(x.name) === said(p.label!));
    if (!t) return null;
    rows.push({ dice: p.text, type: t.id });
  }
  return rows;
};

/**
 * The rows as the text kept: each part's dice and its type's name; a part with no type before another said DMG, so it
 * stays its own; DMG after the last type. A part with no dice yet is left out until it has some. One plain part is its
 * dice alone, as DAMAGE always was.
 */
export const textOf = (rows: DamageRow[], types: RowType[]): string => {
  const kept = rows.filter((r) => r.dice.trim());
  const name = (r: DamageRow) => types.find((t) => t.id === r.type)?.name.trim().toUpperCase() ?? '';
  let out = '';
  kept.forEach((r, i) => {
    const dice = r.dice.trim();
    if (i > 0) out += dice.startsWith('-') ? ' ' : ' + ';
    const typed = name(r);
    out += dice + (typed ? ` ${typed}` : i < kept.length - 1 ? ' DMG' : '');
  });
  return kept.length && name(kept[kept.length - 1]) ? `${out} DMG` : out;
};

/** The rows with one changed. */
export const withRow = (rows: DamageRow[], i: number, patch: Partial<DamageRow>): DamageRow[] => rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
/** The rows with a new part at the end, blank, its type the column's MOST LINES ARE, else the last part's. */
export const withNewRow = (rows: DamageRow[], usual: string | null = null): DamageRow[] => [...rows, { dice: '', type: usual ?? rows[rows.length - 1]?.type ?? null }];
/** The rows without one; never none. */
export const withoutRow = (rows: DamageRow[], i: number): DamageRow[] => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows);
