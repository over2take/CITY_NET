// The sheet's DYING box, as logic (8c3; approved mockup docs/mockups/rule-library.html, section 2, 2026-11-26): what a token
// down under its game's dying rule shows under the vitals box, on SHEET.EXE and the sheet's own tab alike. The rule comes as
// the server shows it (backend systemBuilder/dying.js dyingShown, in the sheet's template); the state is the token's own
// (`dying`, tokens/dyingTable.js), its count sent only to its player and the GM. Pure, so the box (components/DyingBox.tsx)
// only draws.

export type DyingWay = 'count' | 'once' | 'turns' | 'none';
/** The rule as the server shows a sheet it. */
export interface DyingShown {
  word: string;
  way: DyingWay;
  save: { dice: string; way: 'at_least' | 'under'; target: string };
  to_live: number;
  to_die: number;
  harder: number;
  turns: number;
}
export type DownState = 'dying' | 'stable' | 'dead';
/** A token's state, as kept: the word alone for anyone but its player and the GM. */
/** `full`: the count is here (its player's and the GM's); without it only the word was sent. */
export interface Down { state: DownState; saves?: number; fails?: number; made?: number; turns?: number; due?: boolean; full: boolean }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): number | undefined => (Number.isInteger(v) && (v as number) >= 0 ? v as number : undefined);

/** A token's `dying` read: null where it is not down, or it is not the shape kept. */
export const downOf = (text: string | null | undefined): Down | null => {
  if (typeof text !== 'string' || !text) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!isObject(v) || !['dying', 'stable', 'dead'].includes(v.state as string)) return null;
  // The whole state always has its turns; what anyone else is sent has the word's state alone.
  const out: Down = { state: v.state as DownState, full: count(v.turns) !== undefined };
  for (const k of ['saves', 'fails', 'made', 'turns'] as const) { const n = count(v[k]); if (n !== undefined) out[k] = n; }
  if (v.due === true) out.due = true;
  return out;
};

/** The word a token down shows: the game's while dying, STABLE or DEAD after. */
export const downWord = (rule: Pick<DyingShown, 'word'> | null | undefined, down: Down): string =>
  (down.state === 'dying' ? (rule?.word || 'DYING') : down.state.toUpperCase());

/** The save as the box says it: "1d20 · 10 OR MORE", "1d10 + 2 · UNDER BODY", harder by the saves made. */
export const saveWords = (rule: DyingShown, down: Down): string => {
  const harder = rule.way === 'once' ? (down.made ?? 0) * rule.harder : 0;
  const dice = `${rule.save.dice}${harder > 0 ? ` + ${harder}` : harder < 0 ? ` - ${-harder}` : ''}`;
  return `${dice} · ${rule.save.way === 'under' ? `UNDER ${rule.save.target}` : `${rule.save.target} OR MORE`}`;
};

/** What the box shows for a token down. `gm`: the GM's A TURN GOES BY, where turns are counted. */
export interface Box {
  word: string;
  state: DownState;
  /** SAVES COUNTED: where the count stands. */
  saves?: { made: number; of: number };
  fails?: { made: number; of: number };
  /** TURNS LEFT: how many, of how many. */
  turnsLeft?: { left: number; of: number };
  /** ONE FAIL IS DEATH: saves made so far. */
  madeIt?: number;
  /** The save's words, and whether DEATH SAVE is offered and lit (their turn come in a fight). */
  save?: { words: string; lit: boolean };
  /** The GM's A TURN GOES BY, offered where turns are counted with no roll. */
  turnButton: boolean;
  note: string;
}

export const boxOf = (rule: DyingShown, down: Down, { gm }: { gm: boolean }): Box => {
  const word = downWord(rule, down);
  if (down.state === 'stable') return { word, state: 'stable', turnButton: false, note: 'No more saves. Healing above 0 clears it.' };
  if (down.state === 'dead') return { word, state: 'dead', turnButton: false, note: 'The GM heals them back if the table says so. Nothing on the sheet is lost.' };
  const base = { word, state: 'dying' as const, turnButton: false };
  const save = { words: saveWords(rule, down), lit: down.due === true };
  switch (rule.way) {
    case 'count':
      return {
        ...base, saves: { made: down.saves ?? 0, of: rule.to_live }, fails: { made: down.fails ?? 0, of: rule.to_die }, save,
        note: `${rule.to_live} successes and they are stable; ${rule.to_die} failures and they are dead.`,
      };
    case 'once':
      return { ...base, madeIt: down.made ?? 0, save, note: 'A save every turn until stabilized: missing one is death.' };
    case 'turns':
      return {
        ...base, turnsLeft: { left: Math.max(0, rule.turns - (down.turns ?? 0)), of: rule.turns }, turnButton: gm,
        note: 'Someone must stabilize them before the turns run out.',
      };
    default:
      return { ...base, note: 'The table decides what happens. Healing above 0 clears it.' };
  }
};
