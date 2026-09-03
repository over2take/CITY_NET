// Cyberware mods (CWN p71).
//
// The third and last of the book's mod tables. Armour and weapon mods (p58-59) modify gear
// you carry; these modify the chrome itself, and are fitted per implant rather than per
// character - the same mod can go on several systems if a tech will maintain them all.
//
// Applied on read like the other two, never written into the row, so taking one off gives
// back exactly what it took.
//
// Five of the ten change a number the app knows about. That took three pieces of
// groundwork to be true: body weaponry had to become a weapon before Monoblade and
// Targeting Processor had anything to modify, and implant AC had to become a field before
// Hardened Weave did. The other five are carried as chips - Quick Detach is about how long
// a limb takes to swap, and that is not a number this app should invent.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What a mod can change, and what it may be fitted to.
 *
 * `fits` is checked before anything applies: the book restricts most of these to a kind of
 * system, and a mod on the wrong implant does nothing rather than quietly working. It is a
 * predicate over the row so the rule lives with the mod that has it.
 */
const CYBER_MODS = [
  {
    id: 'biocapacitors', label: 'BIOCAPACITORS', skill: 'Fix-1/Heal-2', cost: 0.3, tech: 1,
    effect: 'Ignore first System Strain trigger cost per day',
    // Once a day, on a trigger the app does not track.
  },
  {
    id: 'durable_system', label: 'DURABLE SYSTEM', skill: 'Fix-1/Heal-1', cost: 0.2, tech: 0,
    effect: 'Sacrifice mod to negate a Major Injury',
  },
  {
    id: 'firewalled', label: 'FIREWALLED', skill: 'Fix-1/Heal-1', cost: 0.2, tech: 0,
    effect: '-2 penalty to all rolls to hack this cybersystem',
    // A roll someone else makes against the implant, which the app does not model.
  },
  {
    id: 'hardened_weave', label: 'HARDENED WEAVE', skill: 'Fix-2/Heal-1', cost: 0.3, tech: 0,
    effect: '+2 AC, but Obvious and +1 Readied enc.',
    // "Skin cyber that grants an improved base armor class such as Dermal Armor has any AC
    // it grants improved by +2." So it needs a base AC to improve; on anything else the
    // book gives it nothing to do.
    implantAc: 2,
    // It also makes the system Obvious, which is the one concealment change that goes the
    // wrong way. Applied, because the column exists and a player should not have to
    // remember that their armour plating is now visible.
    setConc: 'obvious',
    fits: (row) => baseAcOf(row) > 0,
    fitsNote: 'skin cyber that grants a base AC',
  },
  {
    id: 'low_maintenance', label: 'LOW MAINTENANCE', skill: 'Fix-2/Heal-2', cost: 0.1, tech: 1,
    effect: 'The cyber system has zero maintenance costs',
  },
  {
    id: 'monoblade', label: 'MONOBLADE', skill: 'Fix-2/Heal-1', cost: 0.2, tech: 0,
    effect: "+1 to weapon Trauma Die, -2 dmg/Shock",
    // A trade, not an upgrade: the edge cuts deeper when it lands and does less the rest
    // of the time. The bonus is to the trauma ROLL, not the die's size.
    traumaBonus: 1, damage: -2, shock: -2,
    fits: (row) => isCyberWeapon(row),
    fitsNote: 'a bladed cyber system',
  },
  {
    id: 'profile_adjustment', label: 'PROFILE ADJUSTMENT', skill: 'Fix-1/Heal-2', cost: 0.2, tech: 0,
    effect: 'Makes cybersystem one step less obvious',
    // "from Sight to Touch, or Touch to Medical. It has no benefit for a system that is
    // already at a Medical grade of concealment."
    concSteps: 1,
  },
  {
    id: 'quick_detach', label: 'QUICK DETACH', skill: 'Fix-2/Heal-2', cost: 0.3, tech: 0,
    effect: 'Detach or re-attach with 5 minutes of work',
  },
  {
    id: 'tailored_interface', label: 'TAILORED INTERFACE', skill: 'Fix-1/Heal-3', cost: 0.3, tech: 1,
    effect: '-1 System Strain for systems with 2+ Strain',
    // "only functions on cyber that inflicts 2+ points of permanent System Strain, but
    // lowers the strain cost by 1 point." Strain gates how much chrome fits, so this is
    // the one that changes what a character can carry.
    strain: -1,
    fits: (row) => num(row && row.hl) >= 2,
    fitsNote: 'a system costing 2 or more Strain',
  },
  {
    id: 'targeting_processor', label: 'TARGETING PROCESSOR', skill: 'Fix-2/Heal-1', cost: 0.3, tech: 0,
    effect: '+1 to hit with Gunlink or cyber weapon',
    hit: 1,
    fits: (row) => isCyberWeapon(row),
    fitsNote: 'a cyber weapon or a Gunlink',
  },
];

const BY_ID = Object.fromEntries(CYBER_MODS.map((m) => [m.id, m]));

/** Concealment, least obvious last - the order the book steps along. */
const CONC_ORDER = ['obvious', 'sight', 'touch', 'medical'];

/** The base AC an implant grants, read the same way cwnImplantAc reads it. */
function baseAcOf(row) {
  let mods = row && row.mods;
  if (typeof mods === 'string') { try { mods = JSON.parse(mods); } catch { mods = []; } }
  if (!Array.isArray(mods)) return 0;
  let best = 0;
  for (const m of mods) {
    if (!m || typeof m !== 'object') continue;
    if (String(m.target || '').trim().toLowerCase() !== 'base ac') continue;
    const v = num(m.value);
    if (v > best) best = v;
  }
  return best;
}

/** Whether this row is an implant you attack with. Kept here to avoid a circular require. */
function isCyberWeapon(row) {
  const name = String((row && row.name) || '').trim().toLowerCase();
  return name === 'body blades i' || name === 'body blades ii';
}

/** A row's fitted mod ids, defensively - the field is free-form JSON. */
const fittedIds = (row) => {
  let value = row && row.cyberMods;
  if (typeof value === 'string') {
    if (value.trim() === '') return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.map(String) : [];
};

/**
 * The mods actually doing something on this row.
 *
 * A mod whose `fits` fails is dropped rather than applied: the book restricts most of them
 * to a kind of system, and one on the wrong implant should be visibly inert rather than
 * quietly working. The UI says so too, so this is not the only place a player finds out.
 */
const activeMods = (row) =>
  fittedIds(row)
    .map((id) => BY_ID[id])
    .filter((m) => m && (!m.fits || m.fits(row)));

/** What one row's mods add up to. */
const rowEffects = (row) => {
  const mods = activeMods(row);
  const sum = (k) => mods.reduce((n, m) => n + (Number(m[k]) || 0), 0);
  return {
    strain: sum('strain'),
    implantAc: sum('implantAc'),
    traumaBonus: sum('traumaBonus'),
    damage: sum('damage'),
    shock: sum('shock'),
    // "An attack can only ever benefit from one instance of this mod" - so the hit bonus
    // does not stack even if two somehow ended up on the same system.
    hit: Math.min(sum('hit'), 1),
    concSteps: sum('concSteps'),
    setConc: mods.reduce((c, m) => m.setConc || c, null),
    installed: mods,
  };
};

/**
 * A row's concealment after its mods.
 *
 * Hardened Weave forces Obvious whatever else is fitted - it bolts plating on - and
 * Profile Adjustment steps the other way. Applied in that order so a system with both is
 * Obvious stepped down rather than its original rating stepped down.
 */
const concOf = (row) => {
  const eff = rowEffects(row);
  const start = eff.setConc || String((row && row.conc) || '').trim().toLowerCase();
  const i = CONC_ORDER.indexOf(start);
  if (i < 0) return String((row && row.conc) || '');
  return CONC_ORDER[Math.min(CONC_ORDER.length - 1, i + eff.concSteps)];
};

/** What a row's Strain costs once its mods are counted. Never below zero. */
const strainOf = (row) => Math.max(0, num(row && row.hl) + rowEffects(row).strain);

module.exports = {
  CYBER_MODS, BY_ID, CONC_ORDER,
  fittedIds, activeMods, rowEffects, concOf, strainOf, baseAcOf, isCyberWeapon,
};
