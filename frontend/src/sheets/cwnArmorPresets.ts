// The armor table, CWN p53.
//
// The one catalogue every operator buys from first, and the last one to get written down.
// Until now armor existed in CITY_NET only as hint text on the sheet's `armor_ac` field -
// a string listing a few examples - so there was nothing a shop could put on a shelf and
// nothing a player could pick from.
//
// Three groupings, as the book prints them. Civilian armor and suit armor SET the wearer's
// AC and you can only wear one at a time; accessories ADD to whatever is worn, and each
// can only be added once. That difference is the whole reason `group` exists rather than
// one flat list.

export interface ArmorPreset {
  id: string;
  label: string;
  /** The book's three groupings. Accessories add; the other two set. */
  group: 'civilian' | 'suit' | 'accessory';
  /** For civilian and suit armor, the AC itself. For an accessory, the bonus it adds. */
  rangedAc: number;
  meleeAc: number;
  /** Damage Soak: hit points of damage the armor eats per fight. */
  soak: number;
  enc: number;
  /** The Trauma Target Mod column - what the armor does to a Trauma Target against it. */
  traumaTargetMod: number;
  /** Subtle armor passes for clothing; Obvious armor does not. */
  subtle: boolean;
  cost: number;
  /** The book's @: needs a relevant Contact to buy, or some other special opportunity. */
  rare?: boolean;
  /** The book's H: -1 to all Sneak and Exert checks. Multiple heavy items stack. */
  heavy?: boolean;
  /** The book's NS: cannot be added to suit armor. */
  noSuit?: boolean;
}

/** Fourteen, in the book's order within each grouping. */
export const CWN_ARMOR: ArmorPreset[] = [
  // Civilian armor - p53. Ordinary Clothing is on the table because "no armor" still has
  // an AC, and a player picking nothing should be able to see what nothing is worth.
  { id: 'ordinary_clothing', label: 'Ordinary Clothing', group: 'civilian', rangedAc: 10, meleeAc: 10, soak: 0, enc: 0, traumaTargetMod: 0, subtle: true, cost: 25 },
  { id: 'reinforced_clothing', label: 'Reinforced Clothing', group: 'civilian', rangedAc: 13, meleeAc: 10, soak: 2, enc: 0, traumaTargetMod: 0, subtle: true, cost: 100 },
  { id: 'war_harness', label: 'War Harness', group: 'civilian', rangedAc: 13, meleeAc: 14, soak: 5, enc: 1, traumaTargetMod: 0, subtle: false, cost: 200 },
  { id: 'street_leathers', label: 'Street Leathers', group: 'civilian', rangedAc: 13, meleeAc: 12, soak: 3, enc: 0, traumaTargetMod: 0, subtle: true, cost: 250 },
  { id: 'reinforced_longcoat', label: 'Reinforced Longcoat', group: 'civilian', rangedAc: 15, meleeAc: 13, soak: 5, enc: 1, traumaTargetMod: 1, subtle: true, cost: 500 },
  { id: 'armored_clothing', label: 'Armored Clothing', group: 'civilian', rangedAc: 16, meleeAc: 14, soak: 5, enc: 2, traumaTargetMod: 1, subtle: true, cost: 1000 },
  { id: 'plated_longcoat', label: 'Plated Longcoat', group: 'civilian', rangedAc: 17, meleeAc: 15, soak: 5, enc: 3, traumaTargetMod: 1, subtle: false, cost: 2000, heavy: true },
  // Out of price order in the book too: it trades ranged AC for soak, so it sits with the
  // civilian list rather than being sorted into it.
  { id: 'impact_jacket', label: 'Impact Jacket', group: 'civilian', rangedAc: 12, meleeAc: 14, soak: 8, enc: 1, traumaTargetMod: 1, subtle: false, cost: 1000 },

  // Suit armor - p53. All three are @: you do not simply walk in and buy one.
  { id: 'light_armored_suit', label: 'Light Armored Suit', group: 'suit', rangedAc: 16, meleeAc: 13, soak: 5, enc: 2, traumaTargetMod: 2, subtle: false, cost: 5000, rare: true },
  { id: 'medium_armored_suit', label: 'Medium Armored Suit', group: 'suit', rangedAc: 18, meleeAc: 14, soak: 10, enc: 3, traumaTargetMod: 2, subtle: false, cost: 10000, rare: true },
  { id: 'heavy_armored_suit', label: 'Heavy Armored Suit', group: 'suit', rangedAc: 20, meleeAc: 18, soak: 15, enc: 3, traumaTargetMod: 3, subtle: false, cost: 20000, rare: true, heavy: true },

  // Accessories - p53. These numbers are bonuses, not armor classes.
  { id: 'riot_shield', label: 'Riot Shield', group: 'accessory', rangedAc: 2, meleeAc: 4, soak: 0, enc: 2, traumaTargetMod: 0, subtle: false, cost: 1000 },
  { id: 'absorption_plates', label: 'Absorption Plates', group: 'accessory', rangedAc: 2, meleeAc: 2, soak: 3, enc: 1, traumaTargetMod: 0, subtle: false, cost: 500, heavy: true, noSuit: true },
  { id: 'joint_reinforcement', label: 'Joint Reinforcement', group: 'accessory', rangedAc: 1, meleeAc: 1, soak: 0, enc: 0, traumaTargetMod: 0, subtle: true, cost: 250, heavy: true, noSuit: true },
];

/**
 * The fifteenth row on the book's table, which is not a thing you buy.
 *
 * Obsolete Tech is a discount applied to any armor or accessory on the list: half price,
 * and the penalties are rolled AFTER the purchase, so nobody - including this app - can
 * say in advance what the armor will turn out to be. That is why it is a constant with its
 * text rather than a row on a shelf with a BUY button that could not tell you what it was
 * selling.
 */
export const OBSOLETE_TECH = {
  label: 'Obsolete Tech',
  costMultiplier: 0.5,
  effect:
    'Half price. Rolled after purchase: -1d2 ranged and melee AC (minimum AC 10), '
    + 'and -1d4 Damage Soak (minimum 0).',
} as const;

export const CWN_ARMOR_BY_ID = new Map(CWN_ARMOR.map((a) => [a.id, a]));

/** The AC a piece gives, as the shelf prints it: a value for armor, a bonus for accessories. */
export const acText = (a: ArmorPreset, which: 'ranged' | 'melee'): string => {
  const n = which === 'ranged' ? a.rangedAc : a.meleeAc;
  return a.group === 'accessory' ? `+${n}` : String(n);
};
