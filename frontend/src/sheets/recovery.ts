// The builder's recovery dice and how rests are finished, as logic (R1b; approved mockup
// docs/mockups/rest-on-sheet.html, 2026-10-30): the system's `resting`, read with its defaults and
// written back storing only what differs from them. Mirrors backend/systemBuilder/recovery.js, which
// checks what is written; the tests hold the two together. No presets: turning the dice on starts
// them at a short rest, all back at a long rest, for the GM to change.

// Reads the lists itself rather than through choices.ts, which reads rests.ts, which clears a deleted
// rest from here: no import loop.
import type { Definition } from './systemsApi';

/** backend recovery.js LIMITS, held equal by a test. */
export const LIMITS = { name: 30, formula: 200, back: 12 } as const;

export type Finish = 'call' | 'sheet';
export type BackHow = 'all' | 'half' | 'by';
/** A rest giving recovery dice back: all, half (at least 1), or by an amount. */
export interface Back { rest: string; how: BackHow; amount?: string }
export interface Recovery {
  name: string;
  /** One per level of each option with a die, or a formula. */
  count: 'levels' | string;
  /** Each heals its die once per level, not once. */
  perLevel: boolean;
  /** A formula added to each die, or null. */
  plus: string | null;
  spentAt: string[] | 'any';
  back: Back[];
}
export type RecoveryPatch = Partial<Recovery>;

/** The dice the HIT DIE buttons offer; any other size, 2 to 100, is typed. */
export const DIE_CHOICES = [4, 6, 8, 10, 12, 20] as const;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const HOWS: BackHow[] = ['all', 'half', 'by'];

const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObject) : []);

/** The options with a die, in the levelled lists, as backend diceOptionsOf: each one's name and die. */
export const diceOptions = (def: Definition): { id: string; label: string; die: number }[] => objects(def.choices).filter((c) => c.levelled === true)
  .flatMap((c) => objects(c.options).filter((o) => typeof o.id === 'string' && Number.isInteger(o.die))
    .map((o) => ({ id: o.id as string, label: typeof o.label === 'string' && o.label.trim() ? o.label : o.id as string, die: o.die as number })));

/** How a system's characters rest: finished at the GM's call with no recovery dice when it says nothing. */
export const restingOf = (def: Definition): { finish: Finish; recovery: Recovery | null } => {
  const resting = isObject(def.resting) ? def.resting : {};
  const r = isObject(resting.recovery) ? resting.recovery : null;
  return {
    finish: resting.finish === 'sheet' ? 'sheet' : 'call',
    recovery: r && {
      name: typeof r.name === 'string' ? r.name : '',
      count: typeof r.count === 'string' ? r.count : 'levels',
      perLevel: r.per_level === true,
      plus: typeof r.plus === 'string' ? r.plus : null,
      spentAt: r.spent_at === 'any' ? 'any' : (Array.isArray(r.spent_at) ? r.spent_at.filter((id): id is string => typeof id === 'string') : []),
      back: (Array.isArray(r.back) ? r.back : []).filter(isObject).map((b) => ({
        rest: typeof b.rest === 'string' ? b.rest : '',
        how: HOWS.includes(b.how as BackHow) ? b.how as BackHow : 'all',
        ...(b.how === 'by' ? { amount: typeof b.amount === 'string' ? b.amount : '' } : {}),
      })),
    },
  };
};

/** The recovery dice as the system file stores them: the defaults left out, a name and its rests kept as set. */
const storedOf = (r: Recovery): Obj => ({
  name: r.name,
  ...(r.count !== 'levels' ? { count: r.count } : {}),
  ...(r.perLevel ? { per_level: true } : {}),
  ...(r.plus !== null && r.plus.trim() ? { plus: r.plus } : {}),
  spent_at: r.spentAt,
  ...(r.back.length ? { back: r.back.map((b) => (b.how === 'by' ? { rest: b.rest, how: b.how, amount: b.amount ?? '' } : { rest: b.rest, how: b.how })) } : {}),
});

const withResting = (def: Definition, finish: Finish, recovery: Recovery | null): Definition => {
  const next: Definition = { ...def };
  const resting: Obj = { ...(finish === 'sheet' ? { finish } : {}), ...(recovery ? { recovery: storedOf(recovery) } : {}) };
  if (Object.keys(resting).length) next.resting = resting; else delete next.resting;
  return next;
};

/** The definition with rests finished at the GM's call (stored as nothing) or on each sheet. */
export const withFinish = (def: Definition, finish: Finish): Definition => withResting(def, finish, restingOf(def).recovery);

/**
 * The recovery dice turned on, as a starting point to change: spent at a short rest and all back at
 * a long rest, whichever of those is on (any time, and nothing back, when neither is).
 */
export const withRecoveryOn = (def: Definition, onRests: string[]): Definition => withResting(def, restingOf(def).finish, {
  name: 'Recovery dice', count: 'levels', perLevel: false, plus: null,
  spentAt: onRests.includes('short_rest') ? ['short_rest'] : 'any',
  back: onRests.includes('long_rest') ? [{ rest: 'long_rest', how: 'all' }] : [],
});

/** The definition with the recovery dice changed, or taken away (null). */
export const withRecovery = (def: Definition, patch: RecoveryPatch | null): Definition => {
  const { finish, recovery } = restingOf(def);
  if (patch === null || !recovery) return withResting(def, finish, null);
  return withResting(def, finish, { ...recovery, ...patch });
};

/**
 * What one rest gives back, or null for nothing: the back list in the order written, a rest added at
 * its end, and an amount only when by one (starting at 1).
 */
export const withBack = (def: Definition, rest: string, how: BackHow | null): Definition => {
  const recovery = restingOf(def).recovery;
  if (!recovery) return def;
  const others = recovery.back.filter((b) => b.rest !== rest);
  const had = recovery.back.find((b) => b.rest === rest);
  if (!how) return withRecovery(def, { back: others });
  const entry: Back = how === 'by' ? { rest, how, amount: had?.how === 'by' ? had.amount ?? '' : '1' } : { rest, how };
  return withRecovery(def, { back: had ? recovery.back.map((b) => (b.rest === rest ? entry : b)) : [...others, entry] });
};

/** The amount a rest gives back by (one giving back all or half stores none). */
export const withBackAmount = (def: Definition, rest: string, amount: string): Definition => {
  const recovery = restingOf(def).recovery;
  if (!recovery) return def;
  return withRecovery(def, { back: recovery.back.map((b) => (b.rest === rest ? { ...b, amount } : b)) });
};

/** Whether the dice are spent at a rest, ticked on or off; ANY TIME is its own switch. */
export const withSpentAt = (def: Definition, rest: string, on: boolean): Definition => {
  const recovery = restingOf(def).recovery;
  if (!recovery) return def;
  const now = recovery.spentAt === 'any' ? [] : recovery.spentAt;
  return withRecovery(def, { spentAt: on ? [...now.filter((id) => id !== rest), rest] : now.filter((id) => id !== rest) });
};

/** The definition with no recovery dice pointing at a deleted rest (rests.ts withoutRest). */
export const withoutRestInResting = (def: Definition, rest: string): Definition => {
  const recovery = restingOf(def).recovery;
  if (!recovery || !(recovery.back.some((b) => b.rest === rest) || (recovery.spentAt !== 'any' && recovery.spentAt.includes(rest)))) return def;
  return withRecovery(def, {
    back: recovery.back.filter((b) => b.rest !== rest),
    ...(recovery.spentAt !== 'any' ? { spentAt: recovery.spentAt.filter((id) => id !== rest) } : {}),
  });
};

/** What one heals, in words: `its die + @con_mod`, `its die once for each level`. */
export const healsText = (r: Recovery): string => `its die${r.perLevel ? ' once for each level' : ''}${r.plus?.trim() ? ` + ${r.plus.trim()}` : ''}`;
