// A type's quick filters in the shop (8a7c3; approved mockup docs/mockups/item-types-in-shops.html, section 3, answered
// 2 A): each PICK ONE column of the type as buttons, ALL first, one word picked per column at most. A line shows when it
// has every word picked, exactly as the builder keeps it (a PICK ONE value is one of its words). Pure, so the shop only draws.

/** A column as the shop reads it: its id, name and kind, with PICK ONE's words. */
interface PickColumn { id: string; label: string; kind: string; options?: unknown }
/** A PICK ONE column with its words, as the shop draws its buttons. */
export interface PickShown { id: string; label: string; options: string[] }
/** What is picked: a word per column; a column not here shows ALL. */
export type Picks = Record<string, string>;

/** The type's PICK ONE columns that have words, in its order; none for no type, or a type with none. */
export const pickColumnsOf = (type: { columns?: PickColumn[] } | null | undefined): PickShown[] =>
  (Array.isArray(type?.columns) ? type!.columns : [])
    .filter((c) => c?.kind === 'pick' && Array.isArray(c.options))
    .map((c) => ({ id: c.id, label: String(c.label || c.id).toUpperCase(), options: (c.options as unknown[]).filter((w): w is string => typeof w === 'string' && w !== '') }))
    .filter((c) => c.options.length > 0);

/** The picks with `word` picked for `column`, or the column back to ALL for none. */
export const withPick = (picks: Picks, column: string, word: string): Picks => {
  const next = { ...picks };
  if (word) next[column] = word;
  else delete next[column];
  return next;
};

/** Whether a line's values have every word picked. */
export const pickedIn = (fields: Record<string, unknown> | null | undefined, picks: Picks): boolean =>
  Object.entries(picks).every(([column, word]) => String(fields?.[column] ?? '') === word);
