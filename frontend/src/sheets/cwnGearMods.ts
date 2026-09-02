// Armor and weapon mods (CWN p58-59), mirrored for the sheet.
//
// backend/sheets/cwnGearMods.js is authoritative: the server is what resolves an attack
// and what recomputes a suit's soak, so its copy is the one that decides outcomes. This
// one exists because the sheet has to draw the pickers and the chips, and the frontend
// cannot import the server's CommonJS module - the same reason cyberwareEffects and
// buildingTypes are mirrored rather than shared.
//
// A test cross-checks the two tables field by field, so a mod edited on one side and not
// the other fails there rather than in somebody's game.

import type { SheetOption } from './types';

export interface GearMod {
  id: string;
  label: string;
  /** Fix skill level a technician needs to fit it. */
  skill: string;
  cost: number;
  /** Units of special tech required, zero for most. */
  tech: number;
  /** The book's own summary line, printed on the chip. */
  effect: string;
  /** Another mod that has to be fitted first. Trauma Dampers is the only one. */
  requires?: string;
  hit?: number;
  damage?: number;
  shock?: number;
  vsVehicles?: boolean;
  noTrauma?: boolean;
  soak?: number;
  traumaTarget?: number;
  rangedAc?: number;
  meleeAc?: number;
}

/** The book caps how far mods can push a weapon. */
export const CWN_WEAPON_BONUS_CAP = 3;

export const CWN_ARMOR_MODS: GearMod[] = [
  { id: "absorption_pads", label: "ABSORPTION PADS", skill: "Fix-2", cost: 2000, tech: 0, effect: "The armor gains +5 HP of soak per fight", soak: 5 },
  { id: "active_response", label: "ACTIVE RESPONSE", skill: "Fix-3", cost: 20000, tech: 2, effect: "The armor increases a Trauma Target by +1", traumaTarget: 1 },
  { id: "biostabilizing", label: "BIOSTABILIZING", skill: "Fix-1", cost: 2500, tech: 0, effect: "Roll 2d6+2 vs 8 to stabilize at zero hit points" },
  { id: "customized_armor", label: "CUSTOMIZED", skill: "Fix-1", cost: 1000, tech: 0, effect: "A specific user gains +1 ranged/melee AC", rangedAc: 1, meleeAc: 1 },
  { id: "discreet_design", label: "DISCREET DESIGN", skill: "Fix-2", cost: 5000, tech: 1, effect: "Make Obvious armor Subtle, at -2 ranged and melee AC", rangedAc: -2, meleeAc: -2 },
  { id: "flexible", label: "FLEXIBLE", skill: "Fix-2", cost: 10000, tech: 1, effect: "Remove the Heavy penalty from armor" },
  { id: "quickchange", label: "QUICKCHANGE", skill: "Fix-1", cost: 1000, tech: 0, effect: "Change armor appearance as a Main Action" },
  { id: "sealed", label: "SEALED", skill: "Fix-1", cost: 2500, tech: 0, effect: "Environmentally seal armor for 30 minutes" },
  { id: "tailored_rig", label: "TAILORED RIG", skill: "Fix-1", cost: 2000, tech: 0, effect: "+1 Readied and +2 Stowed unconcealed items" },
  { id: "trauma_dampers", label: "TRAUMA DAMPERS", skill: "Fix-3", cost: 10000, tech: 1, effect: "The armor gains +5 HP of soak per fight", requires: "absorption_pads", soak: 5 },
  { id: "whisperlight", label: "WHISPERLIGHT", skill: "Fix-2", cost: 10000, tech: 1, effect: "The armor's Encumbrance decreases by 1" },
];

export const CWN_WEAPON_MODS: GearMod[] = [
  { id: "autotargeting", label: "AUTOTARGETING", skill: "Fix-1", cost: 5000, tech: 0, effect: "Gain a +1 bonus to hit with the weapon", hit: 1 },
  { id: "concealed", label: "CONCEALED", skill: "Fix-2", cost: 5000, tech: 1, effect: "Makes a weapon much harder to recognize" },
  { id: "customized_weapon", label: "CUSTOMIZED", skill: "Fix-1", cost: 1000, tech: 0, effect: "Gain a +1 bonus to hit with the weapon", hit: 1 },
  { id: "extended_mag", label: "EXTENDED MAG", skill: "Fix-1", cost: 1000, tech: 0, effect: "Doubles weapon mag size" },
  { id: "heavy_sabot", label: "HEAVY SABOT", skill: "Fix-1", cost: 2000, tech: 0, effect: "Allows Traumatic Hits on drones/vehicles", vsVehicles: true },
  { id: "integral_toxins", label: "INTEGRAL TOXINS", skill: "Fix-2", cost: 10000, tech: 1, effect: "Gain a +2 poison bonus to damage and Shock", damage: 2, shock: 2 },
  { id: "onboard_gunlink", label: "ONBOARD GUNLINK", skill: "Fix-2", cost: 10000, tech: 1, effect: "A gun emulates the Gunlink cybersystem" },
  { id: "predictive_guidance", label: "PREDICTIVE GUIDANCE", skill: "Fix-3", cost: 15000, tech: 2, effect: "Gain a +1 bonus to hit, damage, and Shock", hit: 1, damage: 1, shock: 1 },
  { id: "reel_wires", label: "REEL WIRES", skill: "Fix-1", cost: 2500, tech: 0, effect: "Retrieves a thrown weapon as an On Turn act" },
  { id: "savage_impact", label: "SAVAGE IMPACT", skill: "Fix-1", cost: 5000, tech: 0, effect: "Gain a +1 bonus to damage and Shock", damage: 1, shock: 1 },
  { id: "shock_burst", label: "SHOCK BURST", skill: "Fix-2", cost: 5000, tech: 0, effect: "Once/fight, +2d6 electric damage, +2 Shock" },
  { id: "stun_rounds", label: "STUN ROUNDS", skill: "Fix-2", cost: 5000, tech: 0, effect: "-2 damage, half range, but non-lethal damage", damage: -2, noTrauma: true },
  { id: "thermal_charge", label: "THERMAL CHARGE", skill: "Fix-2", cost: 7500, tech: 0, effect: "+2 heat damage and Shock for two fights", damage: 2, shock: 2 },
];

/** A tag_list stores a JSON array of ids in one field; anything else reads as empty. */
export const parseModIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const out: unknown = JSON.parse(value);
    return Array.isArray(out) ? out.map(String) : [];
  } catch {
    return [];
  }
};

const optionsOf = (mods: GearMod[]): SheetOption[] =>
  mods.map((m) => ({ value: m.id, label: m.label }));

export const ARMOR_MOD_OPTIONS = optionsOf(CWN_ARMOR_MODS);
export const WEAPON_MOD_OPTIONS = optionsOf(CWN_WEAPON_MODS);

const byId = (mods: GearMod[]) => new Map(mods.map((m) => [m.id, m]));
const ARMOR_BY_ID = byId(CWN_ARMOR_MODS);
const WEAPON_BY_ID = byId(CWN_WEAPON_MODS);

export const getArmorMod = (id: string) => ARMOR_BY_ID.get(id);
export const getWeaponMod = (id: string) => WEAPON_BY_ID.get(id);

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/**
 * The chip's suffix: what it does, then what it took to fit.
 *
 * The effect text is the book's own summary line rather than our paraphrase, so a player
 * reading the chip is reading what they would read in the table.
 */
const describe = (mod: GearMod | undefined, id: string) =>
  mod ? `${mod.effect} - ${mod.skill}, ${money(mod.cost)}${mod.tech ? `, ${mod.tech} tech` : ''}` : id;

export const describeArmorMod = (id: string) => describe(getArmorMod(id), id);
export const describeWeaponMod = (id: string) => describe(getWeaponMod(id), id);

/** The chip's name. Its own lookup because the picker stops offering what is fitted. */
export const labelArmorMod = (id: string) => getArmorMod(id)?.label ?? id;
export const labelWeaponMod = (id: string) => getWeaponMod(id)?.label ?? id;

const total = (mods: GearMod[], key: keyof GearMod) =>
  mods.reduce((t, m) => t + (Number(m[key]) || 0), 0);

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

const installed = (values: string[], lookup: Map<string, GearMod>) =>
  values.map((id) => lookup.get(id)).filter(Boolean) as GearMod[];

/**
 * What an armor's mods add up to. Mirrors armorModEffects on the server.
 *
 * Kept here as well as there because the sheet recomputes its own derived fields for the
 * cyberware overlay, and soak and Trauma Target are two of them.
 */
export const armorModTotals = (value: unknown) => {
  const mods = installed(parseModIds(value), ARMOR_BY_ID);
  return {
    soak: total(mods, 'soak'),
    traumaTarget: total(mods, 'traumaTarget'),
    rangedAc: total(mods, 'rangedAc'),
    meleeAc: total(mods, 'meleeAc'),
  };
};

/**
 * The line under a weapon's mod list.
 *
 * Its job is the cap. The book says "no combination of mods can improve a weapon's hit or
 * damage bonus by more than +3", and three of the bonus mods stack to exactly that - so a
 * player one mod past the line needs to be told, not left to discover it when the server
 * quietly clamps the roll.
 */
export const summariseWeaponMods = (values: string[]) => {
  const mods = installed(values, WEAPON_BY_ID);
  if (mods.length === 0) return { text: 'No mods fitted.' };
  const hit = total(mods, 'hit');
  const damage = total(mods, 'damage');
  const shock = total(mods, 'shock');
  const parts: string[] = [];
  if (hit !== 0) parts.push(`hit ${signed(hit)}`);
  if (damage !== 0) parts.push(`dmg ${signed(damage)}`);
  if (shock !== 0) parts.push(`shock ${signed(shock)}`);
  if (mods.some((m) => m.vsVehicles)) parts.push('bites vehicles');
  if (mods.some((m) => m.noTrauma)) parts.push('no trauma die');
  const over = Math.max(hit, damage) > CWN_WEAPON_BONUS_CAP;
  const text = (parts.length ? parts.join(' / ') : 'No change to the rolls.')
    + (over ? ` - over the +${CWN_WEAPON_BONUS_CAP} cap, rolled at +${CWN_WEAPON_BONUS_CAP}` : '');
  return { text, warn: over };
};

/**
 * The line under the armor's mod list.
 *
 * No cap here: the book puts one on weapons only. Trauma Dampers is the one mod in either
 * table with a prerequisite, so a suit wearing it without Absorption Pads is called out.
 */
export const summariseArmorMods = (values: string[]) => {
  const mods = installed(values, ARMOR_BY_ID);
  if (mods.length === 0) return { text: 'No mods fitted.' };
  const t = armorModTotals(JSON.stringify(values));
  const parts: string[] = [];
  if (t.soak !== 0) parts.push(`soak ${signed(t.soak)}`);
  if (t.traumaTarget !== 0) parts.push(`trauma tgt ${signed(t.traumaTarget)}`);
  if (t.rangedAc !== 0 || t.meleeAc !== 0) {
    parts.push(`AC ${signed(t.rangedAc)} rng / ${signed(t.meleeAc)} mel`);
  }
  const missing = mods.filter((m) => m.requires && !values.includes(m.requires));
  const text = (parts.length ? parts.join(' / ') : 'No change to the numbers.')
    + (missing.length
      ? ` - ${missing.map((m) => m.label).join(', ')} needs `
        + missing.map((m) => ARMOR_BY_ID.get(m.requires as string)?.label ?? m.requires).join(', ')
      : '');
  return { text, warn: missing.length > 0 };
};

/** Mods the sheet still offers, given what is already fitted. A mod goes on once. */
export const remainingOptions = (all: SheetOption[], values: string[]) =>
  all.filter((o) => !values.includes(o.value));
