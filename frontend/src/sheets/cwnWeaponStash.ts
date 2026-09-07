// Weapons a character owns but is not carrying.
//
// The book has no slot count for weapons - what you can carry is decided by Encumbrance,
// and Encumbrance is about what is ON you. A rifle in the safehouse weighs nothing and
// slows you down not at all, so it does not belong in the carried rows at all.
//
// Hence two lists. CARRIED is the numbered rows the attack resolver fires and Encumbrance
// counts. The STASH is everything else you own: unlimited, free, and carrying a note of
// where it actually is.
//
// Named STASH rather than "stored" on purpose. The carry radio already uses the book's
// word STOWED for packed-away-but-on-your-back, which costs Encumbrance and takes a Main
// Action to reach. "Stored" is one letter away and means the opposite thing, and that is a
// coin flip every time somebody reads the sheet.
//
// The whole stat block travels with the weapon both ways, the same as a cyberware row: a
// rifle put in the stash and taken out again is the same rifle, not a name that has lost
// its numbers.

/** The sheet field holding the array. */
export const STASH_FIELD = 'weapons_stash';

export interface StashedWeapon {
  name: string;
  dmg: string;
  skill: string;
  attr: string;
  trauma: string;
  shock: string;
  atk: number;
  /** Encumbrance if it were picked up. Costs nothing while it is in the stash. */
  enc: string;
  /** Gear mod ids, as the carried row stores them. */
  mods: string;
  /** Where it actually is - "in the Kestrel", "safehouse locker". */
  location: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A stash entry with every field present, whatever it was handed. */
export const normaliseStashed = (raw: unknown): StashedWeapon => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: str(r.name),
    dmg: str(r.dmg),
    skill: str(r.skill),
    attr: str(r.attr),
    trauma: str(r.trauma),
    shock: str(r.shock),
    atk: num(r.atk),
    enc: str(r.enc),
    mods: str(r.mods),
    location: str(r.location),
  };
};

/**
 * Whatever the sheet holds, as stash entries.
 *
 * Defensive for the same reason every other list on this sheet is: it is free-form JSON on
 * a sheet people import into and edit by hand, and a window that throws on a malformed one
 * is worse than a window that shows an empty list.
 */
export const readStash = (data: Record<string, unknown> | undefined | null): StashedWeapon[] => {
  let value: unknown = data?.[STASH_FIELD];
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map(normaliseStashed);
};

/** Stored as a JSON string, matching how the other lists on this sheet are written. */
export const writeStash = (rows: StashedWeapon[]): string => JSON.stringify(rows);

/** The fields one carried row is made of, given its index. */
const carriedFields = (i: number) => ({
  name: `weapon${i}_name`, dmg: `weapon${i}_dmg`, skill: `weapon${i}_skill`,
  attr: `weapon${i}_attr`, trauma: `weapon${i}_trauma`, shock: `weapon${i}_shock`,
  atk: `weapon${i}_atk`, enc: `weapon${i}_enc`, mods: `weapon${i}_mods`,
  carry: `weapon${i}_carry`,
});

/**
 * The first carried row with nothing in it, or null when they are all full.
 *
 * A row is empty when it has no name: everything else can legitimately be blank, and a
 * name is what a player types first.
 */
export const firstFreeRow = (
  data: Record<string, unknown> | undefined | null,
  rows: number,
): number | null => {
  for (let i = 1; i <= rows; i += 1) {
    if (!str(data?.[`weapon${i}_name`]).trim()) return i;
  }
  return null;
};

/** One carried row, as a stash entry. Used when putting a weapon away. */
export const carriedToStashed = (
  data: Record<string, unknown> | undefined | null,
  i: number,
  location = '',
): StashedWeapon => {
  const f = carriedFields(i);
  return normaliseStashed({
    name: data?.[f.name], dmg: data?.[f.dmg], skill: data?.[f.skill], attr: data?.[f.attr],
    trauma: data?.[f.trauma], shock: data?.[f.shock], atk: data?.[f.atk],
    enc: data?.[f.enc], mods: data?.[f.mods], location,
  });
};

/**
 * The field writes that put a stash entry into a carried row.
 *
 * Lands as STOWED, not Readied: a weapon just taken out of a locker is in your bag, and
 * claiming it is in your hands would quietly change what you could draw this round - and
 * put it against the tighter of the two Encumbrance limits without being asked.
 */
export const stashedToCarried = (
  w: StashedWeapon,
  i: number,
): Record<string, string | number> => {
  const f = carriedFields(i);
  return {
    [f.name]: w.name, [f.dmg]: w.dmg, [f.skill]: w.skill, [f.attr]: w.attr,
    [f.trauma]: w.trauma, [f.shock]: w.shock, [f.atk]: w.atk,
    [f.enc]: w.enc, [f.mods]: w.mods, [f.carry]: 'stowed',
  };
};

/** Every field of one carried row, as a plain object. */
const readCarried = (data: Record<string, unknown> | undefined | null, i: number) => {
  const f = carriedFields(i);
  return {
    name: str(data?.[f.name]), dmg: str(data?.[f.dmg]), skill: str(data?.[f.skill]),
    attr: str(data?.[f.attr]), trauma: str(data?.[f.trauma]), shock: str(data?.[f.shock]),
    atk: data?.[f.atk] ?? '', enc: str(data?.[f.enc]), mods: str(data?.[f.mods]),
    carry: str(data?.[f.carry]),
  };
};

/**
 * The rows a character is left carrying once one is taken out, closed up.
 *
 * Without this, taking the first of two weapons away leaves a hole: the sheet decides how
 * many rows to draw from the LAST one that holds anything, so an empty row 1 above a
 * filled row 2 is still drawn - a blank weapon nobody can get rid of.
 *
 * Rewrites every row rather than moving one, which is more writes but one save, and it
 * also closes any hole that was already there.
 */
export const compactCarried = (
  data: Record<string, unknown> | undefined | null,
  rows: number,
  removeIndex: number,
): Record<string, string | number> => {
  const kept: ReturnType<typeof readCarried>[] = [];
  for (let i = 1; i <= rows; i += 1) {
    if (i === removeIndex) continue;
    const row = readCarried(data, i);
    if (row.name.trim()) kept.push(row);
  }

  const out: Record<string, string | number> = {};
  for (let i = 1; i <= rows; i += 1) {
    const f = carriedFields(i);
    const row = kept[i - 1];
    if (!row) { Object.assign(out, clearCarried(i)); continue; }
    out[f.name] = row.name; out[f.dmg] = row.dmg; out[f.skill] = row.skill;
    out[f.attr] = row.attr; out[f.trauma] = row.trauma; out[f.shock] = row.shock;
    out[f.atk] = row.atk as string | number; out[f.enc] = row.enc;
    out[f.mods] = row.mods; out[f.carry] = row.carry;
  }
  return out;
};

/**
 * The field writes that empty a carried row, for when a weapon is put away.
 *
 * Every field goes to the empty string, including the numeric one. A zero is a value: the
 * sheet decides which rows to draw by whether any field in them holds anything, so a row
 * cleared to `atk: 0` would stay on screen forever as an empty weapon nobody could get
 * rid of.
 */
export const clearCarried = (i: number): Record<string, string | number> => {
  const f = carriedFields(i);
  return {
    [f.name]: '', [f.dmg]: '', [f.skill]: '', [f.attr]: '',
    [f.trauma]: '', [f.shock]: '', [f.atk]: '', [f.enc]: '', [f.mods]: '', [f.carry]: '',
  };
};
