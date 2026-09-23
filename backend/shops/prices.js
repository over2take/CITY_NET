// What a shop may charge, and the only place that decides it.
//
// Money is the one thing a client must never be trusted with. The shop window knows every
// price already - it prints them - but a purchase arrives here as "this catalogue, this
// id" and the amount is looked up on this side. A modified client can ask to buy a Tank;
// it cannot ask to buy one for nothing.
//
// Each entry is `id: [label, price]`. The label is here because SELLING needs it: a
// character sheet stores what someone owns by NAME - "Heavy Pistol" in a weapon slot,
// "Climbing kit" on an inventory row - so verifying that a player really owns the thing
// they are selling means matching a name back to a catalogue entry, on this side, where
// the answer can be trusted.
//
// **Mirrored from the frontend catalogues, and cross-checked by a test.** Two of the ten
// already had a server-side copy and are reused rather than duplicated - pharmaceuticals
// and the two mod tables. The other seven are transcribed here, generated from the real
// modules rather than retyped. The mirror is only worth having if it agrees, so
// shopPrices.test.ts walks every frontend catalogue against this file and fails naming the
// entry that drifted.
//
// Every figure is the book's. Per-store markup does not exist: what a shop PAYS is a
// percentage set by the GM, and that lives in shops/buyback.js.

const cwnPharma = require('../sheets/cwnPharma');
const cwnGearMods = require('../sheets/cwnGearMods');

const CYBERWARE = {
  "aesthetic-augmentation-suite": ["Aesthetic Augmentation Suite", 50000],
  "assisted-glide-system": ["Assisted Glide System", 50000],
  "banshee-module": ["Banshee Module", 30000],
  "cybernetic-infrastructure-baseline": ["Cybernetic Infrastructure Baseline", 20000],
  "deadman-circuit": ["Deadman Circuit", 10000],
  "dermal-armor-trauma-shielding": ["Dermal Armor/Trauma Shielding", 100000],
  "emergency-stabilization-factor": ["Emergency Stabilization Factor", 30000],
  "fleshmod": ["Fleshmod", 20000],
  "full-body-conversion": ["Full Body Conversion", 6000000],
  "hemosynthetic-filter-system": ["Hemosynthetic Filter System", 25000],
  "holdout-cavity": ["Holdout Cavity", 10000],
  "medical-support-readout": ["Medical Support Readout", 10000],
  "recovery-support-unit": ["Recovery Support Unit", 30000],
  "redundant-systems": ["Redundant Systems", 15000],
  "retribution-shield": ["Retribution Shield", 50000],
  "therapeutic-control-dampers": ["Therapeutic Control Dampers", 25000],
  "titan-gun-system": ["Titan Gun System", 100000],
  "viper-sting": ["Viper Sting", 25000],
  "courier-memory": ["Courier Memory", 10000],
  "cranial-jack": ["Cranial Jack", 1000],
  "discretion-insurance-unit": ["Discretion Insurance Unit", 10000],
  "eye-mod-dazzler": ["Eye Mod/Dazzler", 15000],
  "eye-mod-flechette-launcher": ["Eye Mod/Flechette Launcher", 20000],
  "funes-complex": ["Funes Complex", 40000],
  "medusa-implant": ["Medusa Implant", 20000],
  "neural-buffer": ["Neural Buffer", 40000],
  "skillplug-jack-i": ["Skillplug Jack I", 10000],
  "skillplug-jack-ii": ["Skillplug Jack II", 25000],
  "skull-citadel": ["Skull Citadel", 100000],
  "body-blades-i": ["Body Blades I", 10000],
  "body-blades-ii": ["Body Blades II", 25000],
  "cyberlimb": ["Cyberlimb", 10000],
  "iron-hand-aegis": ["Iron Hand Aegis", 40000],
  "limbgun": ["Limbgun", 30000],
  "muscle-fiber-replacement-i": ["Muscle Fiber Replacement I", 50000],
  "muscle-fiber-replacement-ii": ["Muscle Fiber Replacement II", 200000],
  "neolimb": ["Neolimb", 25000],
  "omnihand": ["Omnihand", 10000],
  "shock-fists": ["Shock Fists", 10000],
  "stick-pads": ["Stick Pads", 15000],
  "synthlimb": ["Synthlimb", 25000],
  "coordination-augment-i": ["Coordination Augment I", 50000],
  "coordination-augment-ii": ["Coordination Augment II", 200000],
  "enhanced-reflexes-i": ["Enhanced Reflexes I", 100000],
  "enhanced-reflexes-ii": ["Enhanced Reflexes II", 250000],
  "enhanced-reflexes-iii": ["Enhanced Reflexes III", 750000],
  "reaction-booster-i": ["Reaction Booster I", 50000],
  "reaction-booster-ii": ["Reaction Booster II", 100000],
  "remote-control-unit": ["Remote Control Unit", 10000],
  "skillplug-wiring": ["Skillplug Wiring", 50000],
  "trajectory-optimization-node": ["Trajectory Optimization Node", 50000],
  "zombie-wires": ["Zombie Wires", 60000],
  "dermal-armor-i": ["Dermal Armor I", 40000],
  "dermal-armor-ii": ["Dermal Armor II", 80000],
  "dermal-armor-iii": ["Dermal Armor III", 200000],
  "poseidon-implants": ["Poseidon Implants", 30000],
  "sealed-systems-implant": ["Sealed Systems Implant", 15000],
  "sharkskin-electrodes": ["Sharkskin Electrodes", 20000],
  "skinmod": ["Skinmod", 250],
  "skyborn-shielding": ["Skyborn Shielding", 40000],
};

const WEAPONS = {
  "light_pistol": ["Light Pistol", 200],
  "heavy_pistol": ["Heavy Pistol", 200],
  "advanced_bow": ["Advanced Bow", 500],
  "rifle": ["Rifle", 1000],
  "combat_rifle": ["Combat Rifle", 2500],
  "smg": ["Submachine Gun", 2000],
  "shotgun": ["Shotgun", 200],
  "semi_auto_shotgun": ["Semi-Auto Shotgun", 1000],
  "combat_shotgun": ["Combat Shotgun", 3000],
  "sniper_rifle": ["Sniper Rifle", 3000],
  "taser_pistol": ["Taser Pistol", 500],
  "automatic_rifle": ["Automatic Rifle", 10000],
  "knife": ["Knife", 20],
  "club": ["Club", 0],
  "spear": ["Spear", 50],
  "sword": ["Sword", 200],
  "big_sword": ["Big Sword", 500],
  "big_club": ["Big Club", 100],
  "advanced_knife": ["Advanced Knife", 200],
  "advanced_sword": ["Advanced Sword", 1000],
  "advanced_big_sword": ["Advanced Big Sword", 2500],
  "advanced_club": ["Advanced Club", 500],
  "grenade_frag": ["Grenade, Frag", 100],
  "grenade_gas": ["Grenade, Gas", 50],
  "grenade_smoke": ["Grenade, Smoke", 25],
  "anti_materiel_rifle": ["Anti-Materiel Rifle", 8000],
  "heavy_machine_gun": ["Heavy Machine Gun", 10000],
  "mortar": ["Mortar", 5000],
  "rocket_launcher": ["Rocket Launcher", 5000],
  "demo_charge": ["Demo Charge", 1000],
  "land_mine_ap": ["Land Mine, Anti-Personnel", 150],
  "land_mine_av": ["Land Mine, Anti-Vehicle", 1000],
};

const ARMOR = {
  "ordinary_clothing": ["Ordinary Clothing", 25],
  "reinforced_clothing": ["Reinforced Clothing", 100],
  "war_harness": ["War Harness", 200],
  "street_leathers": ["Street Leathers", 250],
  "reinforced_longcoat": ["Reinforced Longcoat", 500],
  "armored_clothing": ["Armored Clothing", 1000],
  "plated_longcoat": ["Plated Longcoat", 2000],
  "impact_jacket": ["Impact Jacket", 1000],
  "light_armored_suit": ["Light Armored Suit", 5000],
  "medium_armored_suit": ["Medium Armored Suit", 10000],
  "heavy_armored_suit": ["Heavy Armored Suit", 20000],
  "riot_shield": ["Riot Shield", 1000],
  "absorption_plates": ["Absorption Plates", 500],
  "joint_reinforcement": ["Joint Reinforcement", 250],
};

const GEAR = {
  "hearing_protection": ["Active hearing protection", 250],
  "ammo_magazine": ["Ammunition, empty magazine", 10],
  "ammo_round": ["Ammunition, per round", 1],
  "backpack": ["Backpack or gear harness", 25],
  "binoculars": ["Binoculars", 100],
  "bus_pass": ["Bus pass, monthly", 50],
  "climbing_kit": ["Climbing kit", 150],
  "clothing_fashionable": ["Clothing, fashionable", 500],
  "clothing_couture": ["Clothing, haute couture", 10000],
  "clothing_ordinary": ["Clothing, ordinary", 25],
  "gas_mask": ["Gas mask", 1000],
  "goggles_antiflash": ["Goggles, Anti-Flash", 100],
  "goggles_ir": ["Goggles, IR", 1000],
  "kit_basic_tools": ["Kit, Basic Tools", 100],
  "kit_cyberdoc": ["Kit, Cyberdoc", 500],
  "kit_medkit": ["Kit, Medkit", 100],
  "kit_survival": ["Kit, Survival", 100],
  "lockpicks": ["Lockpicks", 100],
  "military_ration": ["Military ration, per day", 20],
  "video_camera": ["Portable video camera", 300],
  "radio_handheld": ["Radio, handheld", 50],
  "radio_tab": ["Radio, ultralight tab", 500],
  "smartphone_plan": ["Smartphone service plan/month", 10],
  "smartphone_basic": ["Smartphone, basic", 50],
  "smartphone_fashionable": ["Smartphone, fashionable", 2000],
  "vr_crown": ["VR crown, cheap", 50],
  "wearable_light": ["Wearable light", 25],
};

const VEHICLES = {
  "motorcycle": ["MOTORCYCLE", 1000],
  "micro_flyer": ["MICRO FLYER", 3000],
  "car": ["CAR", 5000],
  "truck": ["TRUCK", 7500],
  "helicopter": ["HELICOPTER", 50000],
  "tank": ["TANK", 500000],
  "apc": ["APC", 60000],
  "gev": ["GEV", 100000],
  "casra": ["CASRA", 200000],
  "dropcraft": ["DROPCRAFT", 1000000],
};

const VEHICLE_FITTINGS = {
  "advanced_sensors": ["ADVANCED SENSORS", 8000],
  "afterburners": ["AFTERBURNERS", 5000],
  "armor_plating": ["ARMOR PLATING", 5000],
  "cargo_space": ["CARGO SPACE", 0],
  "crash_pod": ["CRASH POD", 2500],
  "ecm_emitter": ["ECM EMITTER", 10000],
  "emissions_cloaking": ["EMISSIONS CLOAKING", 10000],
  "extra_durability": ["EXTRA DURABILITY", 5000],
  "extra_passengers": ["EXTRA PASSENGERS", 2500],
  "field_portable": ["FIELD PORTABLE", 1000],
  "ghost_driver": ["GHOST DRIVER", 2500],
  "hardpoint_support": ["HARDPOINT SUPPORT", 5000],
  "jack_control_port": ["JACK CONTROL PORT", 5000],
  "limpet_mount": ["LIMPET MOUNT", 5000],
  "living_quarters": ["LIVING QUARTERS", 8000],
  "medbay": ["MEDBAY", 10000],
  "offroad_package": ["OFFROAD PACKAGE", 5000],
  "power_small": ["POWER SYSTEM, SMALL", 1000],
  "power_medium": ["POWER SYSTEM, MEDIUM", 5000],
  "power_large": ["POWER SYSTEM, LARGE", 10000],
  "sealed_atmosphere": ["SEALED ATMOSPHERE", 5000],
  "smugglers_hold": ["SMUGGLER'S HOLD", 1000],
  "targeting_board": ["TARGETING BOARD", 2500],
  "tool_rack": ["TOOL RACK", 2500],
};

const VEHICLE_WEAPONS = {
  "anti_materiel_rifle": ["ANTI-MATERIEL RIFLE", 8000],
  "drone_cannon": ["DRONE CANNON", 5000],
  "grenade_launcher": ["GRENADE LAUNCHER", 3000],
  "headshot_pod": ["HEADSHOT POD", 20000],
  "heavy_machine_gun": ["HEAVY MACHINE GUN", 10000],
  "main_tank_gun": ["MAIN TANK GUN", 100000],
  "mounted_autogun": ["MOUNTED AUTOGUN", 15000],
  "rocket_launcher": ["ROCKET LAUNCHER", 5000],
  "shrieker_gun": ["SHRIEKER GUN", 10000],
};

/** Built from the catalogues that already live on this side, so they are not typed twice. */
const fromList = (list, labelKey, priceKey) => {
  const out = {};
  for (const row of list || []) {
    const price = Number(row[priceKey]);
    if (Number.isFinite(price)) out[row.id] = [String(row[labelKey] ?? ''), price];
  }
  return out;
};

/**
 * Every catalogue a shop can deal in, by the same ids the window uses.
 *
 * Keyed by the catalogue id in buildingTypes.js, so a shop asking about a catalogue it
 * does not carry is caught by the caller rather than by a missing key here.
 */
const CATALOGUE = {
  cyberware: CYBERWARE,
  weapons: WEAPONS,
  armor: ARMOR,
  gear: GEAR,
  vehicles: VEHICLES,
  vehicle_fittings: VEHICLE_FITTINGS,
  vehicle_weapons: VEHICLE_WEAPONS,
  pharmaceuticals: fromList(cwnPharma.PHARMACEUTICALS, 'label', 'cost'),
  armor_mods: fromList(cwnGearMods.ARMOR_MODS, 'label', 'cost'),
  weapon_mods: fromList(cwnGearMods.WEAPON_MODS, 'label', 'cost'),
};

/** Prices only, in the shape the rest of the app already asks for. */
const PRICES = Object.fromEntries(
  Object.entries(CATALOGUE).map(([cat, table]) => [
    cat,
    Object.fromEntries(Object.entries(table).map(([id, [, price]]) => [id, price])),
  ]),
);

/**
 * What one of something costs, or null when nothing on the shelf answers to that.
 *
 * Null rather than 0, because "free" and "no such item" are different answers and only
 * one of them should let a purchase through.
 */
const priceOf = (catalogue, itemId) => {
  const table = CATALOGUE[String(catalogue || '')];
  if (!table) return null;
  const entry = table[String(itemId || '')];
  return entry && Number.isFinite(entry[1]) ? entry[1] : null;
};

/** What a catalogue entry is called, or null. */
const labelOf = (catalogue, itemId) => {
  const table = CATALOGUE[String(catalogue || '')];
  const entry = table && table[String(itemId || '')];
  return entry ? entry[0] : null;
};

/**
 * Names are matched loosely, and deliberately so.
 *
 * A sheet's copy of a name has been through an import, a PDF, somebody's typing, or all
 * three, so "Heavy  Pistol" and "heavy pistol" have to find the same entry. Case and
 * runs of whitespace are the only things ignored; nothing fuzzier, because a wrong match
 * here pays out for something the player does not own.
 */
const normaliseName = (name) => String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();

/** name -> [catalogue, id], built once. */
const BY_NAME = new Map();
for (const [catalogue, table] of Object.entries(CATALOGUE)) {
  for (const [id, [label]] of Object.entries(table)) {
    const key = normaliseName(label);
    // First catalogue wins where two tables share a name, which keeps the lookup
    // deterministic rather than dependent on key order.
    if (key && !BY_NAME.has(key)) BY_NAME.set(key, [catalogue, id]);
  }
}

/**
 * Which catalogue entry a thing on a sheet came from, or null for anything unrecognised.
 *
 * Null is a normal answer, not a failure: players rename things, write in homebrew, and
 * carry quest items. Those simply have no book price.
 */
const findByName = (name) => {
  const hit = BY_NAME.get(normaliseName(name));
  return hit ? { catalogue: hit[0], id: hit[1] } : null;
};

module.exports = { CATALOGUE, PRICES, priceOf, labelOf, findByName, normaliseName };
