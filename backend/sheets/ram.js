// Ramming: the driver's weapon.
//
// The one substantial vehicle mechanic Cyberpunk RED has that Cities Without Number does
// not, and the only place in CP:R where being in a vehicle changes what happens to you.
//
// Three things about it are easy to get wrong, so they are the shape of this module:
//
//   1. It is symmetric and self-harming. Your own vehicle takes the same damage. Ramming a
//      parked car to death costs you most of a hull, and a GM mid-chase forgets that.
//   2. Armour does not apply. Every other source of vehicle damage subtracts SP; this one
//      is flat by rule, which is exactly the kind of exception that gets "helpfully"
//      normalised away by whoever refactors next. It has a test.
//   3. Everyone aboard both vehicles takes a Critical Injury, which is why this needs the
//      seat roster at all. The app knows who is aboard, so it can name them rather than
//      leaving the GM to go round the table asking.
//
// There is no to-hit roll. Driving into something is not an attack in the engine's sense;
// it resolves and applies.

/** Both parties take this, flat. */
const RAM_FORMULA = '6d6';

/** Named in the result; the sheet's own critical injuries field is where it gets written. */
const RAM_INJURY = 'WHIPLASH';

/**
 * What a collision does to one damage pool.
 *
 * No armour term on purpose — see note 2 above. Clamped at zero because `destroyed` is
 * derived from the pool rather than stored, and a negative pool is a state with no name.
 */
const applyRamDamage = (hp, hpMax, damage) => {
  const from = Number.isFinite(hp) ? hp : Number(hpMax) || 0;
  return Math.max(0, from - Math.max(0, Math.trunc(damage)));
};

/**
 * Resolve a collision.
 *
 * `rammer` and `target` are `{ hp, hpMax }`. A pedestrian is a target with a pool like any
 * other — the rule treats "anything with HP" alike, and the only thing that differs is
 * whether the rammer may keep moving afterwards.
 *
 * Returns the new pools, who is wrecked, and whether the vehicle stops — reported rather
 * than enforced, since the app does not model movement.
 */
function resolveRam({ damage, rammer, target, targetIsPerson = false }) {
  const rammerHp = applyRamDamage(rammer.hp, rammer.hpMax, damage);
  const targetHp = applyRamDamage(target.hp, target.hpMax, damage);
  const targetDown = targetHp <= 0;

  return {
    damage,
    rammerHp,
    targetHp,
    rammerWrecked: rammerHp <= 0,
    targetDown,
    // Flatten what you hit and you drive on through; leave it standing and you stop dead.
    // A pedestrian never stops a vehicle, whether they survive it or not.
    movementContinues: targetIsPerson || targetDown,
    // A pedestrian still standing may choose to end up on the vehicle. Their call, at the
    // table — the app only says it is available.
    ridesAlong: targetIsPerson && !targetDown,
  };
}

/**
 * Everyone the crash injures: both crews, or the crew and the pedestrian.
 *
 * Deduplicated, because ramming your own second vehicle is legal and absurd and should not
 * give anyone Whiplash twice.
 */
const whiplashed = (rammerCrew = [], targetCrew = []) =>
  [...new Set([...rammerCrew, ...targetCrew].filter(Boolean))];

module.exports = { RAM_FORMULA, RAM_INJURY, applyRamDamage, resolveRam, whiplashed };
