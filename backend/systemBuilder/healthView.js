// What the HEALTH folder is shown of a token's health under a custom system's model.
//
// Two views. The full one goes to whoever may change the token's health: the GM, a player the
// GM has granted editing, and the token's owner. It has the numbers and the notes. Everyone
// else gets the description only, the same rule the heart monitor keeps: a second track as a
// fill with no numbers, damage split light and heavy, the worst harm's name but never its
// notes, WOUNDED rather than a count, which locations are hurt but not how.
//
// Pure: sockets/index.js reads the token and the sheet behind it and sends what this returns.
// The heart monitor itself reads the token's HP, as it does for every system.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const whole = (v) => Math.max(0, Math.floor(num(v)));
const list = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e === 'object') : []);
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const fraction = (part, of) => (of > 0 ? Math.max(0, Math.min(1, part / of)) : 0);

const harmLevels = (health, sheet) => list(health.levels).map((l) => ({
  id: l.id,
  label: l.label,
  penalty: l.penalty || '',
  slots: Array.from({ length: Math.max(1, whole(l.slots)) }, (_, i) => {
    const v = sheet[`${l.id}_${i + 1}`];
    return blank(v) ? '' : String(v);
  }),
}));

/**
 * The view of a token's health.
 *
 *   health  the running system's core.health, or null for a built-in system
 *   token   { current, max, temp }
 *   sheet   the data of the sheet behind the token ({} when there is none)
 *   full    true for the GM, a granted editor, or the token's owner
 *   hpWord  the system's own word for hit points, for a pool with no label of its own
 *
 * Returns { model, full, ... } with the model's detail, or { model: null } when the system's
 * health is not a custom model (the built-in systems draw their own).
 */
const healthView = (health, token, sheet, { full = false, hpWord = 'HP' } = {}) => {
  if (!health || typeof health !== 'object' || typeof health.model !== 'string') return { model: null };
  const s = sheet && typeof sheet === 'object' ? sheet : {};
  const t = { current: num(token && token.current), max: num(token && token.max) };
  const base = { model: health.model, full: !!full };

  switch (health.model) {
    case 'pool':
      return { ...base, label: health.label || hpWord };

    case 'tracks': {
      const [first, second] = list(health.tracks);
      if (!first || !second) return { model: null };
      const current = whole(s[second.id]);
      const max = whole(s[`${second.id}_max`]);
      const tracks = [{ id: first.id, label: first.label }, { id: second.id, label: second.label }];
      const secondView = full
        ? { id: second.id, label: second.label, current, max }
        : { label: second.label, fill: fraction(current, max), full: max > 0 && current >= max };
      return { ...base, tracks, second: secondView, overflow: health.overflow === true };
    }

    case 'typed': {
      const types = list(health.types);
      const boxes = whole(t.max);
      const marks = types.map((ty) => whole(s[ty.id]));
      if (full) return { ...base, boxes, types: types.map((ty, i) => ({ id: ty.id, label: ty.label, marks: marks[i] })) };
      // The heaviest type against everything lighter, as a share of the track.
      const heavy = marks.length ? marks[marks.length - 1] : 0;
      const light = marks.slice(0, -1).reduce((a, b) => a + b, 0);
      return { ...base, light: fraction(light, boxes), heavy: fraction(heavy, boxes) };
    }

    case 'harm': {
      const levels = harmLevels(health, s);
      const filled = levels.flatMap((l) => l.slots).filter((v) => v !== '').length;
      const total = levels.reduce((a, l) => a + l.slots.length, 0);
      const out = total > 0 && filled >= total && t.current <= 0;
      let worst = -1;
      levels.forEach((l, i) => { if (l.slots.some((v) => v !== '')) worst = i; });
      if (full) return { ...base, levels, worst, out };
      return { ...base, levelCount: levels.length, worst, worstLabel: worst >= 0 ? levels[worst].label : null, out };
    }

    case 'wounds': {
      const max = t.max > 0 ? t.max : whole(health.count);
      const taken = Math.max(0, max - t.current);
      if (full) return { ...base, penalty: taken * num(health.penalty) };
      return { ...base, state: t.current <= 0 ? 'incapacitated' : taken > 0 ? 'wounded' : 'unhurt' };
    }

    case 'locations':
      return {
        ...base,
        locations: list(health.locations).map((l) => (full
          ? { id: l.id, label: l.label, note: blank(s[l.id]) ? '' : String(s[l.id]) }
          : { id: l.id, label: l.label, hit: !blank(s[l.id]) })),
      };

    case 'none':
      return base;

    default:
      return { model: null };
  }
};

module.exports = { healthView };
