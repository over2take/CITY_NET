// The Cities Without Number cyberware tables.
//
// Mechanical data from Cities Without Number (Sine Nomine Publishing), whose SRD places
// its mechanics, stats and gear under CC0. The same standing as the vehicle presets
// beside this file: book numbers, our own structure.
//
// The mechanical row only - name, install type, concealment, System Strain, price, and
// the book's one-line effect summary. The descriptive paragraphs that accompany each
// table are deliberately not reproduced.
//
// Sixty entries, extracted from the tables twice by different methods and cross-checked
// against each other and against the per-type counts before being written down.
//
// Two source values need care and are normalised here rather than at the call site:
// Medusa Implant prints its strain as `.5` with no leading zero, and Skinmod costs $250
// flat where every other price is in thousands or millions.
//
// `mods` come from the effect line *and* the description beside each table, because the
// column is a summary and the paragraph is where the number lives - the Aesthetic
// Augmentation Suite's column says only "Cha bonus" while its description says a Charisma
// score of 14, or +2 if already 14 or greater.
//
// A modifier is attached only where the book states it outright. Where the effect is
// conditional - "hearing-related Notice checks", "Heal checks on you" - or names something
// the sheet has no field for, like a base AC or a Trauma Target, it is a `note` instead: a
// chip everyone can see, which nothing tries to apply. A flat +2 Notice where the book
// says hearing-related would be a wrong number quietly beating no number at all.
//
// Still left bare: "extreme feats", "for cyber purposes" and the other phrases that would
// need inventing a rule to express.

import type { CyberMod, Conc } from './cyberwareRows';

/** The book's five install types, matching the ids in cyberwareLocations. */
export type CwnCyberType = 'body' | 'head' | 'skin' | 'limb' | 'nerve';

export interface CwnCyberPreset {
  /** Stable, so a stocked shop can name a piece without storing its whole row. */
  id: string;
  name: string;
  type: CwnCyberType;
  conc: Exclude<Conc, ''>;
  /** System Strain. Fractional on purpose - quarter and half points are common. */
  strain: number;
  /** In credits, whole numbers: $50K is 50000, and Skinmod is 250. */
  price: number;
  /** The book's one-line summary of what it does. */
  effect: string;
  /** Only where the effect line is unambiguous. */
  mods?: CyberMod[];
}

export const CWN_CYBERWARE: CwnCyberPreset[] = [
  { id: 'aesthetic-augmentation-suite', name: "Aesthetic Augmentation Suite", type: 'body', conc: 'sight', strain: 2, price: 50000, effect: "Body sculpt and Cha bonus", mods: [{ kind: 'statFloor', target: 'Charisma', value: 14, bonus: 2 }] },
  { id: 'assisted-glide-system', name: "Assisted Glide System", type: 'body', conc: 'touch', strain: 2, price: 50000, effect: "Glide from high launch points" },
  { id: 'banshee-module', name: "Banshee Module", type: 'body', conc: 'medical', strain: 1, price: 30000, effect: "Mimic voices and stun enemies" },
  { id: 'cybernetic-infrastructure-baseline', name: "Cybernetic Infrastructure Baseline", type: 'body', conc: 'medical', strain: 0, price: 20000, effect: "Gain Con 12 for cyber purposes" },
  { id: 'deadman-circuit', name: "Deadman Circuit", type: 'body', conc: 'sight', strain: 0.25, price: 10000, effect: "Fry cyber without access codes" },
  { id: 'dermal-armor-trauma-shielding', name: "Dermal Armor/Trauma Shielding", type: 'body', conc: 'medical', strain: 1, price: 100000, effect: "Add +1 to user's Trauma Target", mods: [{ kind: 'note', target: 'Trauma Target', value: 1 }] },
  { id: 'emergency-stabilization-factor', name: "Emergency Stabilization Factor", type: 'body', conc: 'medical', strain: 1, price: 30000, effect: "Automatically stabilize" },
  { id: 'fleshmod', name: "Fleshmod", type: 'body', conc: 'medical', strain: 1, price: 20000, effect: "Completely rework your body" },
  { id: 'full-body-conversion', name: "Full Body Conversion", type: 'body', conc: 'sight', strain: 0, price: 6000000, effect: "Become a full body cyborg" },
  { id: 'hemosynthetic-filter-system', name: "Hemosynthetic Filter System", type: 'body', conc: 'medical', strain: 1, price: 25000, effect: "Immune to normal disease/toxin" },
  { id: 'holdout-cavity', name: "Holdout Cavity", type: 'body', conc: 'medical', strain: 1, price: 10000, effect: "2 Enc. of hidden body space" },
  { id: 'medical-support-readout', name: "Medical Support Readout", type: 'body', conc: 'medical', strain: 0.25, price: 10000, effect: "Gain +2 to Heal checks on you", mods: [{ kind: 'note', target: 'Heal checks on you', value: 2 }] },
  { id: 'recovery-support-unit', name: "Recovery Support Unit", type: 'body', conc: 'medical', strain: 1, price: 30000, effect: "Gain 4 System Strain for heals" },
  { id: 'redundant-systems', name: "Redundant Systems", type: 'body', conc: 'medical', strain: 1, price: 15000, effect: "Sacrifice to avoid Major Injury" },
  { id: 'retribution-shield', name: "Retribution Shield", type: 'body', conc: 'touch', strain: 1, price: 50000, effect: "Burst to harm melee targets" },
  { id: 'therapeutic-control-dampers', name: "Therapeutic Control Dampers", type: 'body', conc: 'medical', strain: 1, price: 25000, effect: "Suppress an implant side-effect" },
  { id: 'titan-gun-system', name: "Titan Gun System", type: 'body', conc: 'sight', strain: 1, price: 100000, effect: "Mount a Heavy weapon" },
  { id: 'viper-sting', name: "Viper Sting", type: 'body', conc: 'medical', strain: 0.5, price: 25000, effect: "Hidden drug injection system" },
  { id: 'courier-memory', name: "Courier Memory", type: 'head', conc: 'medical', strain: 0.25, price: 10000, effect: "Carry locked Memory data" },
  { id: 'cranial-jack', name: "Cranial Jack", type: 'head', conc: 'touch', strain: 0.25, price: 1000, effect: "Link to jack-equipped gear" },
  { id: 'discretion-insurance-unit', name: "Discretion Insurance Unit", type: 'head', conc: 'medical', strain: 0.5, price: 10000, effect: "Cranial bomb with remote key" },
  { id: 'eye-mod-dazzler', name: "Eye Mod/Dazzler", type: 'head', conc: 'medical', strain: 0.5, price: 15000, effect: "Dazzle enemies within 5m" },
  { id: 'eye-mod-flechette-launcher', name: "Eye Mod/Flechette Launcher", type: 'head', conc: 'medical', strain: 0.5, price: 20000, effect: "Surprise light pistol attack" },
  { id: 'funes-complex', name: "Funes Complex", type: 'head', conc: 'medical', strain: 1, price: 40000, effect: "Gain eidetic memory" },
  { id: 'medusa-implant', name: "Medusa Implant", type: 'head', conc: 'obvious', strain: 0.5, price: 20000, effect: "Prehensile hair implants" },
  { id: 'neural-buffer', name: "Neural Buffer", type: 'head', conc: 'medical', strain: 1, price: 40000, effect: "Gain 3 HP/level vs hacker dmg" },
  { id: 'skillplug-jack-i', name: "Skillplug Jack I", type: 'head', conc: 'touch', strain: 0.25, price: 10000, effect: "Use level-1 intellectual plugs" },
  { id: 'skillplug-jack-ii', name: "Skillplug Jack II", type: 'head', conc: 'touch', strain: 0.5, price: 25000, effect: "Use level-1 plugs of any kind" },
  { id: 'skull-citadel', name: "Skull Citadel", type: 'head', conc: 'medical', strain: 2, price: 100000, effect: "Armor the brain against harm" },
  { id: 'body-blades-i', name: "Body Blades I", type: 'limb', conc: 'medical', strain: 1, price: 10000, effect: "Integral body weaponry" },
  { id: 'body-blades-ii', name: "Body Blades II", type: 'limb', conc: 'sight', strain: 2, price: 25000, effect: "Larger body weaponry" },
  { id: 'cyberlimb', name: "Cyberlimb", type: 'limb', conc: 'touch', strain: 0.5, price: 10000, effect: "Prosthetic with storage space" },
  { id: 'iron-hand-aegis', name: "Iron Hand Aegis", type: 'limb', conc: 'touch', strain: 1, price: 40000, effect: "Deflect one ranged hit per scene" },
  { id: 'limbgun', name: "Limbgun", type: 'limb', conc: 'touch', strain: 1, price: 30000, effect: "Implanted gun in a limb" },
  { id: 'muscle-fiber-replacement-i', name: "Muscle Fiber Replacement I", type: 'limb', conc: 'touch', strain: 1, price: 50000, effect: "Str 14, or +2 if higher", mods: [{ kind: 'statFloor', target: 'Strength', value: 14, bonus: 2 }] },
  { id: 'muscle-fiber-replacement-ii', name: "Muscle Fiber Replacement II", type: 'limb', conc: 'sight', strain: 2, price: 200000, effect: "Str 18 and extreme feats", mods: [{ kind: 'statFloor', target: 'Strength', value: 18, bonus: 0 }] },
  { id: 'neolimb', name: "Neolimb", type: 'limb', conc: 'sight', strain: 1, price: 25000, effect: "Add a new additional limb" },
  { id: 'omnihand', name: "Omnihand", type: 'limb', conc: 'touch', strain: 0.25, price: 10000, effect: "Toolkit hand, +1 check 1/day" },
  { id: 'shock-fists', name: "Shock Fists", type: 'limb', conc: 'touch', strain: 1, price: 10000, effect: "Do electric fist damage" },
  { id: 'stick-pads', name: "Stick Pads", type: 'limb', conc: 'touch', strain: 0.5, price: 15000, effect: "Climb sheer or vertical surfaces" },
  { id: 'synthlimb', name: "Synthlimb", type: 'limb', conc: 'medical', strain: 0.5, price: 25000, effect: "Lifelike artificial limb" },
  { id: 'coordination-augment-i', name: "Coordination Augment I", type: 'nerve', conc: 'medical', strain: 2, price: 50000, effect: "Dex 14, or +2 if higher", mods: [{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }] },
  { id: 'coordination-augment-ii', name: "Coordination Augment II", type: 'nerve', conc: 'touch', strain: 3, price: 200000, effect: "Dex 18 and +10m Move", mods: [{ kind: 'statFloor', target: 'Dexterity', value: 18, bonus: 0 }, { kind: 'note', target: 'Move (metres)', value: 10 }] },
  { id: 'enhanced-reflexes-i', name: "Enhanced Reflexes I", type: 'nerve', conc: 'medical', strain: 2, price: 100000, effect: "1/scene, bonus Main Action" },
  { id: 'enhanced-reflexes-ii', name: "Enhanced Reflexes II", type: 'nerve', conc: 'medical', strain: 3, price: 250000, effect: "1/scene, bonus Main and Move" },
  { id: 'enhanced-reflexes-iii', name: "Enhanced Reflexes III", type: 'nerve', conc: 'touch', strain: 4, price: 750000, effect: "2/scene, bonus Main and Move" },
  { id: 'reaction-booster-i', name: "Reaction Booster I", type: 'nerve', conc: 'medical', strain: 1, price: 50000, effect: "+2 Init and Snap Attack benefits", mods: [{ kind: 'roll', target: 'Initiative', value: 2 }] },
  { id: 'reaction-booster-ii', name: "Reaction Booster II", type: 'nerve', conc: 'medical', strain: 2, price: 100000, effect: "Automatically win initiative" },
  { id: 'remote-control-unit', name: "Remote Control Unit", type: 'nerve', conc: 'touch', strain: 2, price: 10000, effect: "Remote control drones/vehicles" },
  { id: 'skillplug-wiring', name: "Skillplug Wiring", type: 'nerve', conc: 'medical', strain: 1, price: 50000, effect: "Boost skillplug max to level-3" },
  { id: 'trajectory-optimization-node', name: "Trajectory Optimization Node", type: 'nerve', conc: 'medical', strain: 1, price: 50000, effect: "1/scene turn a miss into a hit" },
  { id: 'zombie-wires', name: "Zombie Wires", type: 'nerve', conc: 'medical', strain: 2, price: 60000, effect: "Keep acting at zero HP" },
  { id: 'dermal-armor-i', name: "Dermal Armor I", type: 'skin', conc: 'medical', strain: 1, price: 40000, effect: "AC 16, +1 to Trauma Target", mods: [{ kind: 'note', target: 'Base AC', value: 16 }, { kind: 'note', target: 'Trauma Target', value: 1 }] },
  { id: 'dermal-armor-ii', name: "Dermal Armor II", type: 'skin', conc: 'touch', strain: 2, price: 80000, effect: "As I, but AC 18 and Shock resist", mods: [{ kind: 'note', target: 'Base AC', value: 18 }, { kind: 'note', target: 'Trauma Target', value: 1 }] },
  { id: 'dermal-armor-iii', name: "Dermal Armor III", type: 'skin', conc: 'sight', strain: 3, price: 200000, effect: "As II, but AC 20 and +2 TT", mods: [{ kind: 'note', target: 'Base AC', value: 20 }, { kind: 'note', target: 'Trauma Target', value: 2 }] },
  { id: 'poseidon-implants', name: "Poseidon Implants", type: 'skin', conc: 'touch', strain: 1, price: 30000, effect: "Aquatic adaptation mods" },
  { id: 'sealed-systems-implant', name: "Sealed Systems Implant", type: 'skin', conc: 'medical', strain: 1, price: 15000, effect: "Trigger a temp space suit" },
  { id: 'sharkskin-electrodes', name: "Sharkskin Electrodes", type: 'skin', conc: 'touch', strain: 1, price: 20000, effect: "Shock grapplers" },
  { id: 'skinmod', name: "Skinmod", type: 'skin', conc: 'sight', strain: 0, price: 250, effect: "Make cosmetic-level body mods" },
  { id: 'skyborn-shielding', name: "Skyborn Shielding", type: 'skin', conc: 'sight', strain: 2, price: 40000, effect: "Orbital hab lifestyle mods" },
];

const BY_ID = new Map(CWN_CYBERWARE.map((c) => [c.id, c]));

export const cyberById = (id: string): CwnCyberPreset | undefined => BY_ID.get(id);

/** Everything that installs into one part of the body. */
export const cyberByType = (type: CwnCyberType): CwnCyberPreset[] =>
  CWN_CYBERWARE.filter((c) => c.type === type);
