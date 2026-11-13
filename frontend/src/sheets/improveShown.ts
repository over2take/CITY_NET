// IMPROVE BY USE on the sheet, as logic (7f3b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): which stats
// carry a mark, whether each is marked, and what its mark says. The server marks a stat after a roll and rolls the
// marked ones at the rest (backend improveByUse.js); the player or the GM ticks or clears a mark by hand (improveAction).
// Pure, so the sheet only draws.

/** What the sheet is told (backend improveByUse.js improveShown). */
export interface ImproveShown {
  stats: { id: string; label: string }[];
  marked: 'success' | 'any' | 'hand';
  at: { id: string; name: string };
}
/** What the sheet asks the server: a mark ticked or cleared. */
export interface ImproveAction { kind: 'mark'; stat: string; on: boolean }

export const MARKS_KEY = '_marks';
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Each stat that improves, by id, and whether it is marked now. */
export const markStates = (improve: ImproveShown | null | undefined, data: Record<string, unknown> | null | undefined): Map<string, boolean> => {
  const kept = isObject(data) && isObject(data[MARKS_KEY]) ? data[MARKS_KEY] : {};
  return new Map((improve?.stats ?? []).map((s) => [s.id, kept[s.id] === true]));
};

/** What marks a stat, in words. */
const BY: Record<ImproveShown['marked'], string> = {
  success: 'A successful roll of it marks it',
  any: 'Rolling it marks it',
  hand: 'It is marked by hand',
};

/** What a stat's mark says, marked or not: "MARKED: it rolls to improve at END OF SESSION. Click to clear." */
export const markTitle = (improve: ImproveShown, marked: boolean, canChange: boolean): string => {
  const at = improve.at.name.toUpperCase();
  return marked
    ? `MARKED: it rolls to improve at ${at}.${canChange ? ' Click to clear.' : ''}`
    : `Not marked. ${BY[improve.marked]}, and a marked stat rolls to improve at ${at}.${canChange ? ' Click to mark it.' : ''}`;
};

/** The action a mark's click asks for. */
export const markAction = (stat: string, marked: boolean): ImproveAction => ({ kind: 'mark', stat, on: !marked });
