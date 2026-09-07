// The book's weapon tables (CWN p54-56), for the gun shop and for filling a row.
//
// Same shape as the cyberware catalogue and for the same reason: a weapon is eight numbers
// a player would otherwise copy out of a book, and every one of them is a chance to
// mistype something the server then rolls with.
//
// Two things the book prints that the sheet has nowhere to put: RANGE and MAGAZINE. They
// are carried here so the shop can show them - picking a rifle without knowing its range
// is not really a choice - but they do not survive being bought, because there is no field
// to survive into. Adding those columns is a decision nobody has taken yet.
//
// Damage is cleaned of the table's footnote markers. That is not tidying: the resolver
// parses damage as /^\d+d\d+([+-]\d+)?$/, so a "1d12*" copied straight off the page is a
// weapon that silently cannot be fired. What each marker meant is kept in `note`, except
// `!`, which becomes the `!` the trauma field already understands.

export interface CwnWeaponPreset {
  id: string;
  name: string;
  category: 'firearm' | 'melee' | 'heavy';
  /** Clean dice the resolver will accept. */
  dmg: string;
  /** Shoot, Stab or Punch. */
  skill: string;
  /** The book's Attr column: '', 'str', 'dex', 'str_dex', 'wis' or 'none'. */
  attr: string;
  /** Trauma die and rating as the sheet spells it - "d8/x3", with ! for vehicles. */
  trauma: string;
  /** Shock as the sheet spells it - "2/13". Firearms have none. */
  shock: string;
  /** Encumbrance, one of the book's sizes. */
  enc: string;
  price: number;
  /** Printed range in metres, short/long. Shown in the shop; the sheet has no field. */
  range: string;
  /** Magazine, for firearms. Shown in the shop; the sheet has no field. */
  mag: string;
  /** What the table's footnote markers meant, plus anything else worth knowing. */
  note: string;
}

const ILLEGAL = 'Needs a Contact to buy legally.';
const BURST = 'Can burst fire: three rounds for +2 to hit and damage.';
const SUPPRESS = 'Can fire to suppress when braced or prone.';
const TWO_HANDED = 'Two-handed, so nothing can be Readied in the off hand.';
const NONLETHAL = 'Damage is non-lethal unless you choose otherwise, and rolls no Trauma Die.';
const FAST_RELOAD = 'Reloads with a Move action, or On Turn at Shoot-1 or better.';

/**
 * Firearms (p54).
 *
 * All Dex, all Shoot. The Taser has no Trauma Die at all, which the sheet spells as a
 * blank rather than as a zero.
 */
const FIREARMS: CwnWeaponPreset[] = [
  { id: 'light_pistol', name: 'Light Pistol', category: 'firearm', dmg: '1d6', skill: 'shoot', attr: 'dex', trauma: 'd8/x2', shock: '', enc: '1', price: 200, range: '10/80', mag: '15', note: '' },
  { id: 'heavy_pistol', name: 'Heavy Pistol', category: 'firearm', dmg: '1d8', skill: 'shoot', attr: 'dex', trauma: 'd6/x3', shock: '', enc: '1', price: 200, range: '10/100', mag: '8', note: '' },
  { id: 'advanced_bow', name: 'Advanced Bow', category: 'firearm', dmg: '1d8', skill: 'shoot', attr: 'dex', trauma: 'd8/x3', shock: '', enc: '2', price: 500, range: '30/200', mag: '1', note: `${FAST_RELOAD} The book gives its Trauma Die a +1 the sheet has no field for.` },
  { id: 'rifle', name: 'Rifle', category: 'firearm', dmg: '1d10+2', skill: 'shoot', attr: 'dex', trauma: 'd8/x3', shock: '', enc: '2', price: 1000, range: '200/400', mag: '6', note: '' },
  { id: 'combat_rifle', name: 'Combat Rifle', category: 'firearm', dmg: '1d12', skill: 'shoot', attr: 'dex', trauma: 'd8/x3', shock: '', enc: '2', price: 2500, range: '100/300', mag: '30', note: `${BURST} ${ILLEGAL}` },
  { id: 'smg', name: 'Submachine Gun', category: 'firearm', dmg: '1d8', skill: 'shoot', attr: 'dex', trauma: 'd6/x2', shock: '', enc: '1', price: 2000, range: '30/100', mag: '20', note: `${BURST} ${ILLEGAL}` },
  { id: 'shotgun', name: 'Shotgun', category: 'firearm', dmg: '3d4', skill: 'shoot', attr: 'dex', trauma: 'd10/x3', shock: '', enc: '2', price: 200, range: '10/30', mag: '2', note: '' },
  { id: 'semi_auto_shotgun', name: 'Semi-Auto Shotgun', category: 'firearm', dmg: '3d4', skill: 'shoot', attr: 'dex', trauma: 'd10/x3', shock: '', enc: '2', price: 1000, range: '10/30', mag: '6', note: '' },
  { id: 'combat_shotgun', name: 'Combat Shotgun', category: 'firearm', dmg: '3d4', skill: 'shoot', attr: 'dex', trauma: 'd10/x3', shock: '', enc: '2', price: 3000, range: '10/30', mag: '12', note: `${BURST} ${ILLEGAL}` },
  { id: 'sniper_rifle', name: 'Sniper Rifle', category: 'firearm', dmg: '2d8', skill: 'shoot', attr: 'dex', trauma: 'd10/x4', shock: '', enc: '2', price: 3000, range: '1000/2000', mag: '1', note: FAST_RELOAD },
  { id: 'taser_pistol', name: 'Taser Pistol', category: 'firearm', dmg: '1d8', skill: 'shoot', attr: 'dex', trauma: '', shock: '', enc: '1', price: 500, range: '10/15', mag: '2', note: 'No Trauma Die.' },
  { id: 'automatic_rifle', name: 'Automatic Rifle', category: 'firearm', dmg: '2d8', skill: 'shoot', attr: 'dex', trauma: 'd10/x3', shock: '', enc: '4', price: 10000, range: '200/400', mag: '10', note: `${SUPPRESS} ${ILLEGAL}` },
];

/**
 * Melee and thrown (p55).
 *
 * Blades take Stab and blunt weapons take Punch - p29 talks about "Punch weapons or
 * unarmed attacks" adding the Punch skill, which is the distinction. It stays editable on
 * the row either way, because a table that reads it differently should not have to argue
 * with a dropdown.
 *
 * Shock is the column firearms use for Magazine, so these carry one and the guns do not.
 */
const MELEE: CwnWeaponPreset[] = [
  { id: 'knife', name: 'Knife', category: 'melee', dmg: '1d4', skill: 'stab', attr: 'str_dex', trauma: 'd6/x3', shock: '1/15', enc: '1', price: 20, range: '10/20', mag: '', note: '' },
  { id: 'club', name: 'Club', category: 'melee', dmg: '1d4', skill: 'punch', attr: 'str', trauma: 'd6/x2', shock: '1/18', enc: '1', price: 0, range: '10/20', mag: '', note: `${NONLETHAL} Improvised, so the book prices it N/A.` },
  { id: 'spear', name: 'Spear', category: 'melee', dmg: '1d6', skill: 'stab', attr: 'str_dex', trauma: 'd8/x3', shock: '2/13', enc: '1', price: 50, range: '10/20', mag: '', note: '' },
  { id: 'sword', name: 'Sword', category: 'melee', dmg: '1d8', skill: 'stab', attr: 'str_dex', trauma: 'd8/x2', shock: '2/13', enc: '1', price: 200, range: '', mag: '', note: '' },
  { id: 'big_sword', name: 'Big Sword', category: 'melee', dmg: '2d6', skill: 'stab', attr: 'str', trauma: 'd8/x3', shock: '2/15', enc: '2', price: 500, range: '', mag: '', note: TWO_HANDED },
  { id: 'big_club', name: 'Big Club', category: 'melee', dmg: '1d10', skill: 'punch', attr: 'str', trauma: 'd8/x3', shock: '2/18', enc: '2', price: 100, range: '', mag: '', note: `${NONLETHAL} ${TWO_HANDED}` },
  { id: 'advanced_knife', name: 'Advanced Knife', category: 'melee', dmg: '1d6', skill: 'stab', attr: 'str_dex', trauma: 'd8/x3', shock: '2/15', enc: '1', price: 200, range: '10/20', mag: '', note: '' },
  { id: 'advanced_sword', name: 'Advanced Sword', category: 'melee', dmg: '1d10', skill: 'stab', attr: 'str_dex', trauma: 'd8/x3', shock: '3/15', enc: '1', price: 1000, range: '', mag: '', note: '' },
  { id: 'advanced_big_sword', name: 'Advanced Big Sword', category: 'melee', dmg: '2d8', skill: 'stab', attr: 'str', trauma: 'd8/x3', shock: '4/15', enc: '2', price: 2500, range: '', mag: '', note: TWO_HANDED },
  { id: 'advanced_club', name: 'Advanced Club', category: 'melee', dmg: '1d8', skill: 'punch', attr: 'str', trauma: 'd8/x3', shock: '2/18', enc: '1', price: 500, range: '', mag: '', note: NONLETHAL },
  { id: 'grenade_frag', name: 'Grenade, Frag', category: 'melee', dmg: '2d6', skill: 'shoot', attr: 'dex', trauma: 'd8/x2', shock: '', enc: '1', price: 100, range: '10/30', mag: '', note: ILLEGAL },
  { id: 'grenade_gas', name: 'Grenade, Gas', category: 'melee', dmg: '1d10', skill: 'shoot', attr: 'dex', trauma: '', shock: '', enc: '1', price: 50, range: '10/30', mag: '', note: NONLETHAL },
  { id: 'grenade_smoke', name: 'Grenade, Smoke', category: 'melee', dmg: '', skill: 'shoot', attr: 'dex', trauma: '', shock: '', enc: '1', price: 25, range: '10/30', mag: '', note: 'No damage; it makes smoke.' },
];

/**
 * Heavy weapons (p56).
 *
 * The `!` the book prints on their damage is the one thing that does not get stripped and
 * discarded: it means the Trauma Die works on drones and vehicles, and the trauma field
 * already spells that with a trailing `!`.
 *
 * A Mortar fires off Wis rather than Dex, which is the reason the ATTR column exists.
 */
const HEAVY: CwnWeaponPreset[] = [
  { id: 'anti_materiel_rifle', name: 'Anti-Materiel Rifle', category: 'heavy', dmg: '3d8', skill: 'shoot', attr: 'dex', trauma: 'd12/x3!', shock: '', enc: '3', price: 8000, range: '1000/2000', mag: '5', note: `${FAST_RELOAD} ${ILLEGAL}` },
  { id: 'heavy_machine_gun', name: 'Heavy Machine Gun', category: 'heavy', dmg: '3d6', skill: 'shoot', attr: 'dex', trauma: 'd12/x3!', shock: '', enc: '3', price: 10000, range: '500/2000', mag: '10', note: `Can suppress when fixed to a vehicle or firing position. ${ILLEGAL}` },
  { id: 'mortar', name: 'Mortar', category: 'heavy', dmg: '3d6', skill: 'shoot', attr: 'wis', trauma: 'd12/x3', shock: '', enc: '3', price: 5000, range: '1000/2000', mag: '1', note: `Fired off Wisdom, not Dexterity. ${ILLEGAL}` },
  { id: 'rocket_launcher', name: 'Rocket Launcher', category: 'heavy', dmg: '3d10', skill: 'shoot', attr: 'dex', trauma: 'd10/x3!', shock: '', enc: '2', price: 5000, range: '2000/4000', mag: '', note: ILLEGAL },
  { id: 'demo_charge', name: 'Demo Charge', category: 'heavy', dmg: '3d10', skill: 'shoot', attr: 'none', trauma: 'd10/x3!', shock: '', enc: '1', price: 1000, range: '20/20', mag: '', note: `No attribute modifier. ${ILLEGAL}` },
  { id: 'land_mine_ap', name: 'Land Mine, Anti-Personnel', category: 'heavy', dmg: '1d8', skill: 'shoot', attr: 'none', trauma: 'd10/x3', shock: '', enc: '1', price: 150, range: '', mag: '', note: `No attribute modifier. ${ILLEGAL}` },
  { id: 'land_mine_av', name: 'Land Mine, Anti-Vehicle', category: 'heavy', dmg: '3d8', skill: 'shoot', attr: 'none', trauma: 'd20/x3!', shock: '', enc: '2', price: 1000, range: '', mag: '', note: `No attribute modifier. ${ILLEGAL}` },
];

export const CWN_WEAPONS: CwnWeaponPreset[] = [...FIREARMS, ...MELEE, ...HEAVY];

export const weaponById = (id: unknown): CwnWeaponPreset | null =>
  CWN_WEAPONS.find((w) => w.id === String(id ?? '')) ?? null;

/**
 * A catalogue weapon as a stash entry.
 *
 * Bought weapons land in the stash rather than in a carried row: you have just walked out
 * of a shop holding a bag, and where the thing goes is the player's decision. It also
 * means a shop can never fail for want of a free row.
 */
export const weaponToStashed = (w: CwnWeaponPreset, location = '') => ({
  name: w.name,
  dmg: w.dmg,
  skill: w.skill,
  attr: w.attr,
  trauma: w.trauma,
  shock: w.shock,
  atk: 0,
  enc: w.enc,
  mods: '',
  location,
});
