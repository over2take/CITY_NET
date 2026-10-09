// A token's conditions in the windows (4e2b1; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09). The token list carries which conditions a token has ([{ id }], with `left` for the
// GM); the running game's list (GET /api/systems/conditions/:system) says what each one is; and
// whoever may change them is also sent the rounds left and modifiers over the socket
// (requestTokenConditions). Pure: the HEALTH folder and the stream overlay draw what this gives.
// The server checks and stores (backend/tokens/conditions.js).

/** One of the running game's conditions, as the server describes it (systemBuilder/conditions.js conditionsOf). */
export interface GameCondition {
  id: string;
  name: string;
  short: string;
  icon: string;
  description: string;
  ends: 'removed' | 'rounds';
  rounds?: number;
  modifiers: { target: string; amount: number }[];
  standard: boolean;
}
/** One condition on a token, as stored or sent: its id, and the rounds it has left where known. */
export interface OnToken { id: string; left?: number; modifiers?: { target: string; amount: number }[] }
/** A condition on a token, whole: what it is, with its rounds left and modifiers where this viewer may see them. */
export interface Shown { condition: GameCondition; left?: number; modifiers: { target: string; amount: number }[] }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A token's conditions from the token list's column, whatever it holds: never a throw. */
export const parseOnToken = (raw: unknown): OnToken[] => {
  let list: unknown;
  try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is Record<string, unknown> => isObject(c) && typeof c.id === 'string')
    .map((c) => (Number.isInteger(c.left) && (c.left as number) > 0 ? { id: c.id as string, left: c.left as number } : { id: c.id as string }));
};

/**
 * What to draw: each condition on the token that the game has, in the token's order, with the
 * rounds left and modifiers from `detail` (the socket's answer) where this viewer was sent them.
 * One the game no longer has (a custom system turned it off) isn't drawn.
 */
export const shownConditions = (onToken: OnToken[], game: GameCondition[], detail?: OnToken[] | null): Shown[] => {
  const byId = new Map(game.map((c) => [c.id, c]));
  const detailed = new Map((detail ?? []).map((d) => [d.id, d]));
  return onToken.flatMap((t) => {
    const condition = byId.get(t.id);
    if (!condition) return [];
    const d = detailed.get(t.id);
    const left = d ? d.left : t.left;
    return [{ condition, ...(Number.isInteger(left) ? { left } : {}), modifiers: d?.modifiers ?? [] }];
  });
};

/**
 * The list to send when one is put on: every condition already there with the rounds it has left
 * (so putting one on never resets another's), then the new one, starting at its own rounds.
 */
export const withPutOn = (onToken: OnToken[], detail: OnToken[] | null | undefined, id: string): OnToken[] => {
  const left = new Map((detail ?? onToken).map((d) => [d.id, d.left]));
  const kept = onToken.filter((t) => t.id !== id).map((t) => (Number.isInteger(left.get(t.id)) ? { id: t.id, left: left.get(t.id) } : { id: t.id }));
  return [...kept, { id }];
};

/** The list to send when one is taken off, the rest keeping their rounds left. */
export const withTakenOff = (onToken: OnToken[], detail: OnToken[] | null | undefined, id: string): OnToken[] => {
  const left = new Map((detail ?? onToken).map((d) => [d.id, d.left]));
  return onToken.filter((t) => t.id !== id).map((t) => (Number.isInteger(left.get(t.id)) ? { id: t.id, left: left.get(t.id) } : { id: t.id }));
};

/** The game's conditions not on the token yet, to put on. */
export const notOnYet = (onToken: OnToken[], game: GameCondition[]) => game.filter((c) => !onToken.some((t) => t.id === c.id));

/** A modifier as the HEALTH folder says it: "ALL ROLLS −1", "STR +2". */
export const modifierText = (m: { target: string; amount: number }) =>
  `${m.target === 'all_rolls' ? 'ALL ROLLS' : m.target.replace(/_/g, ' ').toUpperCase()} ${m.amount > 0 ? '+' : '−'}${Math.abs(m.amount)}`;

/** Rounds left as the chip says it. */
export const roundsText = (left: number) => `${left} ROUND${left === 1 ? '' : 'S'} LEFT`;
