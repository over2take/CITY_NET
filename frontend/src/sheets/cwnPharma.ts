// Pharmaceuticals and street drugs (CWN p60-61), mirrored for the sheet.
//
// backend/sheets/cwnPharma.js is authoritative: the server resolves attacks, so its copy
// is the one that decides whether Boneshaker's +2 actually lands. This one exists because
// the sheet draws the picker and the chips and the frontend cannot import the server's
// CommonJS module - the same reason cwnGearMods and cyberwareEffects are mirrored.
//
// A test cross-checks the two tables entry by entry, so a drug edited on one side and not
// the other fails there rather than in somebody's game.
//
// Only three of the sixteen change a number this app works out - Boneshaker, Olympus and
// Avalanche. The server module's header says which and why; the short version is that
// Morale is not a stat we roll, a cyberspace action is not a number, and the hostile
// drugs are saving throws aimed at a victim rather than states a character is in.

import {
  INVENTORY_FIELD, readInventory, writeInventory, type InventoryItem,
} from './inventory';

/**
 * What is currently in the bloodstream. NOT what is being carried.
 *
 * Doses you own are ordinary inventory rows, counted like ammunition, because that is what
 * they are. This field is the other thing: a state with a duration and a System Strain
 * bill, which a quantity cannot express - you are not carrying two of being on Boneshaker.
 * Taking a dose moves one from the inventory to here.
 */
export const PHARMA_FIELD = 'pharma_active';

/**
 * Which systems have this drug table.
 *
 * A per-system flag rather than a name check at the call site, the same way the mod table
 * and experience are gated. p60-61 is a Cities Without Number table; Cyberpunk RED has its
 * own drugs with their own numbers, and offering these there would state something false
 * about that game.
 */
const PHARMA_SYSTEMS = new Set(['cities_without_number']);

export const hasPharma = (system: string | null | undefined): boolean =>
  PHARMA_SYSTEMS.has(String(system ?? ''));

export type PharmaDuration = 'scene' | 'hour' | 'instant' | 'extended';

export interface Pharmaceutical {
  id: string;
  label: string;
  cost: number;
  /** Minimum Heal skill to administer, null for the book's "None". */
  heal: number | null;
  duration: PharmaDuration;
  effect: string;
  /** Needs a Contact to obtain (the book's @ marker). */
  rare?: boolean;
  /** Aimed at a victim rather than taken. */
  hostile?: boolean;
  hit?: number;
  damage?: number;
  shock?: number;
  /** Added to every Trauma Die rolled AGAINST the user. */
  incomingTrauma?: number;
  /** Hit points handed over on the spot. A write, not an overlay - see the server copy. */
  grantsHp?: number;
  /** Carried for the table: the app does not roll the d12 Major Injury table. */
  majorInjury?: number;
  /** System Strain billed when a scene-length dose ends. */
  strain?: number;
}

export const CWN_PHARMACEUTICALS: Pharmaceutical[] = [
  {
    id: 'avalanche', label: 'AVALANCHE', cost: 100, heal: 0, duration: 'hour',
    effect: 'Numbs pain for an hour: +10 current hit points, even above maximum. -1 on the d12 for any Major Injury taken while it lasts.',
    grantsHp: 10,
    majorInjury: -1,
  },
  {
    id: 'boneshaker', label: 'BONESHAKER', cost: 10, heal: null, duration: 'scene',
    effect: 'Blind aggression: +2 Morale, +2 to hit, damage and Shock. All attacks against you add +2 to any Trauma Die. 2 System Strain when the scene ends.',
    hit: 2, damage: 2, shock: 2,
    incomingTrauma: 2,
    strain: 2,
  },
  {
    id: 'chokeout', label: 'CHOKEOUT', cost: 50, heal: null, duration: 'extended',
    effect: 'Hostile. Consumed in food or drink; Physical save or strangled unconscious for an hour, waking at 1 hit point. On a success, 1d10 non-lethal damage. A natural 1 kills. Degrades after twelve hours.',
    hostile: true,
  },
  {
    id: 'control_delete', label: 'CONTROL-DELETE', cost: 25, heal: null, duration: 'extended',
    effect: 'Hostile. Ingested in food or drink; no saving throw, but toxin-filtering cyber stops it. The target acts normally and forgets everything between the dose and their next sleep or unconsciousness.',
    hostile: true,
  },
  {
    id: 'hellbender', label: 'HELLBENDER', cost: 100, heal: null, duration: 'instant',
    effect: 'Hostile. Physical save or convulse helplessly for 1d6 rounds, taking 1d10 damage each round unless restrained by two or more. This can kill.',
    hostile: true,
  },
  {
    id: 'lurch', label: 'LURCH', cost: 25, heal: 0, duration: 'instant',
    effect: 'Heals 1d10 plus the physician\'s Heal skill, and adds 1 System Strain. Each dose after the first in a day raises the Heal needed by one. Conscious, stabilized targets only - it kills the Mortally Wounded.',
  },
  {
    id: 'madeleine', label: 'MADELEINE', cost: 100, heal: null, duration: 'hour',
    effect: 'Relive a chosen memory with perfect fidelity for 1d6 hours, oblivious to your surroundings. Psychologically addictive.',
  },
  {
    id: 'medical_prescription', label: 'MEDICAL PRESCRIPTION', cost: 20, heal: null, duration: 'extended',
    effect: 'Treats a chronic condition. Some need a dose a few times a week; others need one daily or risk lethal complications.',
  },
  {
    id: 'olympus', label: 'OLYMPUS', cost: 100, heal: 0, duration: 'scene',
    effect: 'Numbs pain and sharpens focus: +2 to hit, and reroll your first failed Morale check in a fight. 1 System Strain when the scene ends.',
    hit: 2,
    strain: 1,
  },
  {
    id: 'panacea', label: 'PANACEA', cost: 200, heal: 1, duration: 'instant',
    effect: 'Used as part of a first aid attempt, doubles the hit points recovered, minimum 6.',
  },
  {
    id: 'pillow', label: 'PILLOW', cost: 10, heal: 0, duration: 'extended',
    effect: 'Hostile. A sedative injected into a restrained or helpless subject: 24 hours of torpor indistinguishable from death. A second dose inside 24 hours means a Physical save or die.',
    hostile: true,
  },
  {
    id: 'psycho', label: 'PSYCHO', cost: 10, heal: null, duration: 'hour',
    effect: 'About an hour of flattened emotion and raised aggression: +2 to Morale checks, and no immediate emotional trauma from anything you do.',
  },
  {
    id: 'reset', label: 'RESET', cost: 1000, heal: null, duration: 'instant', rare: true,
    effect: 'A drug of desperation, for a willing subject with at least one Body or Nerve cyber system. Sheds all System Strain above the permanent minimum; five minutes later Strain maxes and a Physical save is made at a penalty equal to the Strain gained since. Success drops you to 1 hit point, failure is Mortally Wounded, and 1 or less means a second save or die. More than once a week is fatal.',
  },
  {
    id: 'sand', label: 'SAND', cost: 2, heal: null, duration: 'hour',
    effect: 'A euphoric haze for up to an hour, then shooting pains and light sensitivity. Heavy users usually die within six to twelve months.',
  },
  {
    id: 'trauma_patch', label: 'TRAUMA PATCH', cost: 50, heal: null, duration: 'instant',
    effect: 'Stabilizes a Mortally Wounded ally on an Int or Dex/Heal check against difficulty 6, +1 for each full round since they went down. Useless after six rounds, and never against poison, disease or dismemberment.',
  },
  {
    id: 'window', label: 'WINDOW', cost: 200, heal: 1, duration: 'scene',
    effect: 'Trade your Move action for a bonus Main Action usable only on cyberspace actions. Each time you do, gain 1 System Strain. One dose lasts a scene.',
  },
];

const BY_ID = new Map(CWN_PHARMACEUTICALS.map((p) => [p.id, p]));

export const pharmaById = (id: string): Pharmaceutical | null =>
  BY_ID.get(String(id ?? '').trim().toLowerCase()) ?? null;

/** 'Trauma Patch', 'TRAUMA-PATCH' and 'trauma patch' are all the same shelf. */
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const BY_NAME = new Map(
  CWN_PHARMACEUTICALS.flatMap((p) => [[norm(p.id), p], [norm(p.label), p]] as const),
);

/**
 * A drug by whatever somebody typed into an inventory row, or null.
 *
 * Doses are carried as ordinary inventory items - they are countable miscellaneous things
 * and that is exactly what the inventory is for - so the link between a row and the
 * catalogue is its name, and the name is whatever a player or an importer wrote.
 */
export const pharmaByName = (name: string): Pharmaceutical | null =>
  BY_NAME.get(norm(name)) ?? null;

/**
 * What is running on this sheet.
 *
 * Deduplicated: a second dose of the same drug changes nothing the rules recognise, since
 * a bonus does not stack with itself any more than with another drug's. Unknown ids are
 * dropped rather than guessed at - this is free-form JSON on a sheet people import into.
 */
export const activeDrugs = (
  data: Record<string, unknown> | undefined | null,
): Pharmaceutical[] => {
  let value: unknown = data?.[PHARMA_FIELD];
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Pharmaceutical[] = [];
  for (const raw of value) {
    const drug = pharmaById(String(raw));
    if (!drug || seen.has(drug.id)) continue;
    seen.add(drug.id);
    out.push(drug);
  }
  return out;
};

export const writeActive = (drugs: Pharmaceutical[] | string[]): string =>
  JSON.stringify(drugs.map((d) => (typeof d === 'string' ? d : d.id)));

export interface PharmaEffects {
  hit: number;
  damage: number;
  shock: number;
  incomingTrauma: number;
  majorInjury: number;
  /** What ending the scene will cost in System Strain. */
  sceneStrain: number;
  active: Pharmaceutical[];
}

const EMPTY: PharmaEffects = {
  hit: 0, damage: 0, shock: 0, incomingTrauma: 0, majorInjury: 0, sceneStrain: 0, active: [],
};

/**
 * The numbers currently on a character, with the book's stacking rule applied.
 *
 * "In the case that multiple drugs are taken at once, only the highest bonus applies"
 * (p60). Maxima, not sums: Boneshaker and Olympus together are +2 to hit, not +4. Taken
 * per channel, because the sentence is about bonuses rather than drugs.
 *
 * Strain is the exception and is summed - it is a price each drug charges for itself, not
 * a benefit being capped.
 */
export const pharmaEffects = (
  data: Record<string, unknown> | undefined | null,
): PharmaEffects => {
  const active = activeDrugs(data);
  if (!active.length) return EMPTY;
  const best = (key: keyof Pharmaceutical) =>
    active.reduce((n, d) => Math.max(n, Number(d[key]) || 0), 0);
  return {
    hit: best('hit'),
    damage: best('damage'),
    shock: best('shock'),
    incomingTrauma: best('incomingTrauma'),
    majorInjury: active.reduce((n, d) => Math.min(n, Number(d.majorInjury) || 0), 0),
    sceneStrain: active
      .filter((d) => d.duration === 'scene')
      .reduce((n, d) => n + (Number(d.strain) || 0), 0),
    active,
  };
};

/**
 * What is left running once the scene ends, and what it cost.
 *
 * Scene-length doses end and bill their Strain. Anything measured in hours outlasts a
 * scene and stays - Avalanche runs an hour, and a fight is not an hour.
 */
export const endScene = (
  data: Record<string, unknown> | undefined | null,
): { remaining: string[]; ended: string[]; strain: number } => {
  const active = activeDrugs(data);
  const ending = active.filter((d) => d.duration === 'scene');
  return {
    remaining: active.filter((d) => d.duration !== 'scene').map((d) => d.id),
    ended: ending.map((d) => d.id),
    strain: ending.reduce((n, d) => n + (Number(d.strain) || 0), 0),
  };
};

/**
 * Ending named doses, and charging for them.
 *
 * The single place a drug stops, so ending one by hand and ending a whole scene cannot
 * disagree about the price. Boneshaker "adds 2 System Strain at the end of it" (p60) and
 * Olympus one at its end: the bill falls when the drug ENDS, however it ended, and taking
 * the chip off IS a drug ending. Splitting those two was a bug - the × quietly ended a
 * drug for free while END SCENE charged for the same thing.
 *
 * Strain is summed rather than capped at the highest. It is the price each drug charges
 * for itself, not a benefit the stacking rule limits. Clamped at the maximum because the
 * sheet has nowhere to say "over" - the pool has a ceiling, and a character at it is
 * already in the state the rules care about.
 */
export const endDoses = (
  data: Record<string, unknown> | undefined | null,
  ids: string[],
): Record<string, string | number> => {
  const ending = new Set(ids);
  const active = activeDrugs(data);
  const owed = active
    .filter((d) => ending.has(d.id))
    .reduce((n, d) => n + (Number(d.strain) || 0), 0);
  const max = num(data?.system_strain_max);
  const strain = num(data?.system_strain) + owed;
  return {
    [PHARMA_FIELD]: writeActive(active.filter((d) => !ending.has(d.id))),
    system_strain: max > 0 ? Math.min(max, strain) : strain,
  };
};

/** What ending these doses will cost, for a control that should say so beforehand. */
export const strainOwed = (
  data: Record<string, unknown> | undefined | null,
  ids: string[],
): number => {
  const ending = new Set(ids);
  return activeDrugs(data)
    .filter((d) => ending.has(d.id))
    .reduce((n, d) => n + (Number(d.strain) || 0), 0);
};

/**
 * How many doses of each drug the character is actually carrying.
 *
 * Read off the inventory rather than kept in a second place: a dose is a countable
 * miscellaneous thing, which is what the inventory is for, and a drug list that also
 * tracked quantities would be the same fact stored twice.
 *
 * Stashed rows do not count. The stash is not on you, and you cannot inject something
 * that is in a locker across town.
 */
export const carriedDoses = (
  data: Record<string, unknown> | undefined | null,
): Map<string, number> => {
  const out = new Map<string, number>();
  for (const item of readInventory(data)) {
    if (item.carry === 'stash') continue;
    const drug = pharmaByName(item.name);
    if (!drug) continue;
    out.set(drug.id, (out.get(drug.id) ?? 0) + item.qty);
  }
  return out;
};

/**
 * The inventory with one dose of this drug used up, or null if none was carried.
 *
 * The row goes when its last dose does: a row reading zero is not an item you have, it is
 * one you have run out of, and the inventory's own normaliser would read the zero back as
 * a one anyway.
 */
export const consumeDose = (
  data: Record<string, unknown> | undefined | null,
  drugId: string,
): InventoryItem[] | null => {
  const items = readInventory(data);
  const i = items.findIndex(
    (it) => it.carry !== 'stash' && pharmaByName(it.name)?.id === drugId,
  );
  if (i < 0) return null;
  return items
    .map((it, n) => (n === i ? { ...it, qty: it.qty - 1 } : it))
    .filter((it, n) => n !== i || it.qty > 0);
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Whether an inventory row can be taken right now, and why not.
 *
 * Readied only, and that is the book rather than a preference: injecting or ingesting a
 * drug "requires a Main Action" (p60), and a Stowed item is itself "a Main Action to
 * reach" (p48). Two Main Actions is two turns, so a dose you have not readied is not one
 * you can take this turn.
 */
export const consumable = (
  item: InventoryItem,
): { drug: Pharmaceutical | null; ok: boolean; why: string } => {
  const drug = pharmaByName(item.name);
  if (!drug) return { drug: null, ok: false, why: '' };
  if (item.carry === 'readied') return { drug, ok: true, why: `Take a dose of ${drug.label}` };
  return {
    drug,
    ok: false,
    why: item.carry === 'stash'
      ? 'Stashed — this is not on you.'
      : 'Ready it first. Reaching a Stowed item is a Main Action and injecting is another.',
  };
};

/**
 * Taking the dose in one particular inventory row.
 *
 * Every field the sheet has to change, returned together so a dose cannot half-apply: what
 * is now running, the row it came out of, and - for Avalanche alone - the hit points it
 * hands over. Null when that row is not a drug.
 *
 * The row is addressed by index rather than by drug, because the player clicked a row.
 * Two rows of Boneshaker readied and stowed are different rows, and only one of them is
 * the one they pressed.
 */
export const takeDoseFromRow = (
  data: Record<string, unknown> | undefined | null,
  index: number,
): Record<string, string | number> | null => {
  const items = readInventory(data);
  const item = items[index];
  if (!item) return null;
  const { drug, ok } = consumable(item);
  if (!drug || !ok) return null;

  const next = items
    .map((it, n) => (n === index ? { ...it, qty: it.qty - 1 } : it))
    .filter((it, n) => n !== index || it.qty > 0);

  const active = activeDrugs(data);
  const fields: Record<string, string | number> = {
    // A second dose of something already running is still swallowed - it just does not
    // stack, which the effects already handle - so the row is spent either way.
    [PHARMA_FIELD]: writeActive(
      active.some((d) => d.id === drug.id) ? active : [...active, drug],
    ),
    [INVENTORY_FIELD]: writeInventory(next),
  };
  // Hit points are the one thing a drug hands over rather than lends. A real write,
  // because they get spent - an overlay would hand the +10 back on every read.
  if (drug.grantsHp) fields.hp = num(data?.hp) + drug.grantsHp;
  return fields;
};

/** A one-line summary of what a dose costs and needs, for the picker and the shelf. */
export const describePharma = (drug: Pharmaceutical): string => {
  const bits = [`$${drug.cost.toLocaleString()}`];
  bits.push(drug.heal === null ? 'anyone' : `Heal-${drug.heal}`);
  if (drug.duration === 'scene') bits.push('one scene');
  else if (drug.duration === 'hour') bits.push('an hour');
  if (drug.rare) bits.push('needs a Contact');
  return bits.join(' · ');
};
