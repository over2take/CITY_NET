// Encumbrance (CWN p48).
//
// Counted always, enforced only when the table asks for it. The book is explicit that this
// is optional - "some tables prefer not to use these rules" - so the ENCUMBRANCE house
// rule is off by default and all it turns on is the Move penalty. The count itself is
// shown either way, because knowing what you are carrying is useful even at a table that
// never charges you for it.
//
// The penalty is the whole penalty: being overloaded in CWN costs SPEED and nothing else.
// No hit penalty, no skill penalty, no AC change. That makes this a much smaller feature
// than "encumbrance" usually implies, and it means the payoff is concrete - the Move field
// already on the sheet simply becomes correct.

/** The house rule that turns the Move penalty on. Off by default. */
export const ENCUMBRANCE_RULE = 'cwn_encumbrance';

/**
 * What the book charges for an item, by size (p48).
 *
 * Offered as a picker rather than typed, because these are the only five values the table
 * has and a free number invites a 4 that means nothing.
 */
export const CWN_ENC_SIZES: { value: string; label: string }[] = [
  { value: '0', label: '0 · pocket' },
  { value: '1', label: '1 · one hand' },
  { value: '2', label: '2 · two hands' },
  { value: '5', label: '5 · whole body' },
  { value: '12', label: '12 · a person' },
];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What a character may carry before the penalties start.
 *
 * Readied is half Strength rounded down - in hand, worn armor, a holstered pistol.
 * Stowed is up to full Strength, packed away and a Main Action to reach.
 */
export const encLimits = (data: Record<string, unknown> | undefined | null) => {
  const str = Math.max(0, num(data?.str));
  return { readied: Math.floor(str / 2), stowed: str };
};

/**
 * How far past the limits a character is allowed to push, per step (p48).
 *
 * "They can carry an additional two Ready and four Stowed items." Twice, and the second
 * time costs more; a third is not a thing the book allows.
 */
const PUSH = { readied: 2, stowed: 4 };

/** What each level of overload does to Move. Both measured from the base rate, not stacked. */
export const ENC_MOVE_PENALTY = [0, 0.3, 0.5];

export interface EncState {
  readied: number;
  stowed: number;
  readiedMax: number;
  stowedMax: number;
  /** 0 within limits, 1 after one push, 2 after two, 3 = more than can be hauled. */
  overload: number;
  /** The fraction of Move lost. 0 while within limits. */
  movePenalty: number;
  /** Carrying more than the book allows at all. */
  impossible: boolean;
}

/**
 * Where a character stands.
 *
 * Readied and Stowed are counted apart because the book limits them apart - a character
 * can be over on one and fine on the other, and it is the worse of the two that decides
 * the penalty.
 */
export const encState = (
  data: Record<string, unknown> | undefined | null,
  carried: { readied: number; stowed: number },
): EncState => {
  const { readied: readiedMax, stowed: stowedMax } = encLimits(data);

  // How many pushes each track is into: 0 while within its limit, then one per allowance.
  const stepsOver = (used: number, max: number, per: number) =>
    used <= max ? 0 : Math.ceil((used - max) / per);

  const overload = Math.max(
    stepsOver(carried.readied, readiedMax, PUSH.readied),
    stepsOver(carried.stowed, stowedMax, PUSH.stowed),
  );

  return {
    readied: carried.readied,
    stowed: carried.stowed,
    readiedMax,
    stowedMax,
    overload,
    movePenalty: ENC_MOVE_PENALTY[Math.min(overload, ENC_MOVE_PENALTY.length - 1)],
    // "More weight than this can't be practically hauled over significant distances."
    impossible: overload > 2,
  };
};

/**
 * The Move rate a character actually has, once what they are carrying is counted.
 *
 * Rounded down, and never below zero. Only called where the house rule is on - the count
 * is shown at every table, the penalty is charged only at the ones that asked for it.
 */
export const encumberedMove = (baseMove: number, state: EncState): number =>
  Math.max(0, Math.floor(num(baseMove) * (1 - state.movePenalty)));

/**
 * What the sheet can actually count, split by where it is carried.
 *
 * Three sources, and only two of them are structured. Worn armor is Readied by
 * definition. Weapon rows carry their own Enc and say whether they are Readied or Stowed.
 * Everything else lives in the gear textarea, which is prose - so there are two boxes for
 * a player to total that up themselves rather than the sheet pretending to know.
 *
 * A weapon nobody has filed as Readied or Stowed counts as Stowed: it is on the sheet, so
 * it is being carried, and Stowed is the more forgiving of the two limits to guess at.
 */
export const carriedEnc = (
  data: Record<string, unknown> | undefined | null,
  weaponRows = 4,
): { readied: number; stowed: number } => {
  let readied = num(data?.armor_enc) + num(data?.gear_enc_readied);
  let stowed = num(data?.gear_enc_stowed);

  for (let i = 1; i <= weaponRows; i += 1) {
    // A row with no name is an empty slot, not a weapon weighing nothing.
    if (!String(data?.[`weapon${i}_name`] ?? '').trim()) continue;
    const enc = num(data?.[`weapon${i}_enc`]);
    if (String(data?.[`weapon${i}_carry`] ?? '') === 'readied') readied += enc;
    else stowed += enc;
  }
  return { readied, stowed };
};

/** The line shown at the top of GEAR. */
export const describeEnc = (s: EncState): string => {
  const head = `READIED ${s.readied}/${s.readiedMax} · STOWED ${s.stowed}/${s.stowedMax}`;
  if (s.impossible) return `${head} — more than can be hauled any distance`;
  if (s.overload > 0) return `${head} — overloaded, Move -${Math.round(s.movePenalty * 100)}%`;
  return head;
};
