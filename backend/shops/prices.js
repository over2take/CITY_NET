// What a shop may charge, and the only place that decides it.
//
// Money is the one thing a client must never be trusted with. The shop window knows every
// price already - it prints them - but a purchase arrives here as "this catalogue, this
// id" and the amount is looked up on this side. A modified client can ask to buy a Tank;
// it cannot ask to buy one for nothing.
//
// **Mirrored from the frontend catalogues, and cross-checked by a test.** Two of the nine
// already had a server-side copy and are reused rather than duplicated - pharmaceuticals
// and the two mod tables. The other seven are transcribed here. The mirror is only worth
// having if it agrees, so shopPrices.test.ts walks every frontend catalogue against this
// file and fails naming the entry that drifted.
//
// Every figure is the book's. Per-store markup does not exist yet and is not snuck in
// here: see the note in ShopWindow.tsx about inventing numbers nobody chose.

const cwnPharma = require('../sheets/cwnPharma');
const cwnGearMods = require('../sheets/cwnGearMods');

const CYBERWARE = {
  "aesthetic-augmentation-suite": 50000,
  "assisted-glide-system": 50000,
  "banshee-module": 30000,
  "cybernetic-infrastructure-baseline": 20000,
  "deadman-circuit": 10000,
  "dermal-armor-trauma-shielding": 100000,
  "emergency-stabilization-factor": 30000,
  "fleshmod": 20000,
  "full-body-conversion": 6000000,
  "hemosynthetic-filter-system": 25000,
  "holdout-cavity": 10000,
  "medical-support-readout": 10000,
  "recovery-support-unit": 30000,
  "redundant-systems": 15000,
  "retribution-shield": 50000,
  "therapeutic-control-dampers": 25000,
  "titan-gun-system": 100000,
  "viper-sting": 25000,
  "courier-memory": 10000,
  "cranial-jack": 1000,
  "discretion-insurance-unit": 10000,
  "eye-mod-dazzler": 15000,
  "eye-mod-flechette-launcher": 20000,
  "funes-complex": 40000,
  "medusa-implant": 20000,
  "neural-buffer": 40000,
  "skillplug-jack-i": 10000,
  "skillplug-jack-ii": 25000,
  "skull-citadel": 100000,
  "body-blades-i": 10000,
  "body-blades-ii": 25000,
  "cyberlimb": 10000,
  "iron-hand-aegis": 40000,
  "limbgun": 30000,
  "muscle-fiber-replacement-i": 50000,
  "muscle-fiber-replacement-ii": 200000,
  "neolimb": 25000,
  "omnihand": 10000,
  "shock-fists": 10000,
  "stick-pads": 15000,
  "synthlimb": 25000,
  "coordination-augment-i": 50000,
  "coordination-augment-ii": 200000,
  "enhanced-reflexes-i": 100000,
  "enhanced-reflexes-ii": 250000,
  "enhanced-reflexes-iii": 750000,
  "reaction-booster-i": 50000,
  "reaction-booster-ii": 100000,
  "remote-control-unit": 10000,
  "skillplug-wiring": 50000,
  "trajectory-optimization-node": 50000,
  "zombie-wires": 60000,
  "dermal-armor-i": 40000,
  "dermal-armor-ii": 80000,
  "dermal-armor-iii": 200000,
  "poseidon-implants": 30000,
  "sealed-systems-implant": 15000,
  "sharkskin-electrodes": 20000,
  "skinmod": 250,
  "skyborn-shielding": 40000,
};

const WEAPONS = {
  "light_pistol": 200,
  "heavy_pistol": 200,
  "advanced_bow": 500,
  "rifle": 1000,
  "combat_rifle": 2500,
  "smg": 2000,
  "shotgun": 200,
  "semi_auto_shotgun": 1000,
  "combat_shotgun": 3000,
  "sniper_rifle": 3000,
  "taser_pistol": 500,
  "automatic_rifle": 10000,
  "knife": 20,
  "club": 0,
  "spear": 50,
  "sword": 200,
  "big_sword": 500,
  "big_club": 100,
  "advanced_knife": 200,
  "advanced_sword": 1000,
  "advanced_big_sword": 2500,
  "advanced_club": 500,
  "grenade_frag": 100,
  "grenade_gas": 50,
  "grenade_smoke": 25,
  "anti_materiel_rifle": 8000,
  "heavy_machine_gun": 10000,
  "mortar": 5000,
  "rocket_launcher": 5000,
  "demo_charge": 1000,
  "land_mine_ap": 150,
  "land_mine_av": 1000,
};

const ARMOR = {
  "ordinary_clothing": 25,
  "reinforced_clothing": 100,
  "war_harness": 200,
  "street_leathers": 250,
  "reinforced_longcoat": 500,
  "armored_clothing": 1000,
  "plated_longcoat": 2000,
  "impact_jacket": 1000,
  "light_armored_suit": 5000,
  "medium_armored_suit": 10000,
  "heavy_armored_suit": 20000,
  "riot_shield": 1000,
  "absorption_plates": 500,
  "joint_reinforcement": 250,
};

const GEAR = {
  "hearing_protection": 250,
  "ammo_magazine": 10,
  "ammo_round": 1,
  "backpack": 25,
  "binoculars": 100,
  "bus_pass": 50,
  "climbing_kit": 150,
  "clothing_fashionable": 500,
  "clothing_couture": 10000,
  "clothing_ordinary": 25,
  "gas_mask": 1000,
  "goggles_antiflash": 100,
  "goggles_ir": 1000,
  "kit_basic_tools": 100,
  "kit_cyberdoc": 500,
  "kit_medkit": 100,
  "kit_survival": 100,
  "lockpicks": 100,
  "military_ration": 20,
  "video_camera": 300,
  "radio_handheld": 50,
  "radio_tab": 500,
  "smartphone_plan": 10,
  "smartphone_basic": 50,
  "smartphone_fashionable": 2000,
  "vr_crown": 50,
  "wearable_light": 25,
};

const VEHICLES = {
  "motorcycle": 1000,
  "micro_flyer": 3000,
  "car": 5000,
  "truck": 7500,
  "helicopter": 50000,
  "tank": 500000,
  "apc": 60000,
  "gev": 100000,
  "casra": 200000,
  "dropcraft": 1000000,
};

const VEHICLE_FITTINGS = {
  "advanced_sensors": 8000,
  "afterburners": 5000,
  "armor_plating": 5000,
  "cargo_space": 0,
  "crash_pod": 2500,
  "ecm_emitter": 10000,
  "emissions_cloaking": 10000,
  "extra_durability": 5000,
  "extra_passengers": 2500,
  "field_portable": 1000,
  "ghost_driver": 2500,
  "hardpoint_support": 5000,
  "jack_control_port": 5000,
  "limpet_mount": 5000,
  "living_quarters": 8000,
  "medbay": 10000,
  "offroad_package": 5000,
  "power_small": 1000,
  "power_medium": 5000,
  "power_large": 10000,
  "sealed_atmosphere": 5000,
  "smugglers_hold": 1000,
  "targeting_board": 2500,
  "tool_rack": 2500,
};

const VEHICLE_WEAPONS = {
  "anti_materiel_rifle": 8000,
  "drone_cannon": 5000,
  "grenade_launcher": 3000,
  "headshot_pod": 20000,
  "heavy_machine_gun": 10000,
  "main_tank_gun": 100000,
  "mounted_autogun": 15000,
  "rocket_launcher": 5000,
  "shrieker_gun": 10000,
};

/** Built from the catalogues that already live on this side, so they are not typed twice. */
const fromList = (list, key) => {
  const out = {};
  for (const row of list || []) {
    const price = Number(row[key]);
    if (Number.isFinite(price)) out[row.id] = price;
  }
  return out;
};

/**
 * Every catalogue a shop can sell from, by the same ids the window uses.
 *
 * Keyed by the catalogue id in buildingTypes.js, so a shop asking to sell from a
 * catalogue it does not carry is caught by the caller rather than by a missing key here.
 */
const PRICES = {
  cyberware: CYBERWARE,
  weapons: WEAPONS,
  armor: ARMOR,
  gear: GEAR,
  vehicles: VEHICLES,
  vehicle_fittings: VEHICLE_FITTINGS,
  vehicle_weapons: VEHICLE_WEAPONS,
  pharmaceuticals: fromList(cwnPharma.PHARMACEUTICALS, 'cost'),
  armor_mods: fromList(cwnGearMods.ARMOR_MODS, 'cost'),
  weapon_mods: fromList(cwnGearMods.WEAPON_MODS, 'cost'),
};

/**
 * What one of something costs, or null when nothing on the shelf answers to that.
 *
 * Null rather than 0, because "free" and "no such item" are different answers and only
 * one of them should let a purchase through.
 */
const priceOf = (catalogue, itemId) => {
  const table = PRICES[String(catalogue || '')];
  if (!table) return null;
  const price = table[String(itemId || '')];
  return Number.isFinite(price) ? price : null;
};

module.exports = { PRICES, priceOf };
