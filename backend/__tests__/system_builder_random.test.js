/**
 * The random-system generator (4k1; plan row 4k random-system-soak): a whole custom system from a
 * seed, for the soak runs that publish and play them (4k2, 4k3). Held here to making only systems
 * the server would publish, the same one from the same seed, and between them, everything the
 * builder can make. SOAK_SEEDS=500 checks more seeds than CI's fixed ones; a failure names its seed.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { randomSystem } = require_('./helpers/randomSystem');
const { checkDefinition } = require_('../systemBuilder/definition');
const { HEALTH_MODELS } = require_('../systemBuilder/core');
const { PARTS, partOn } = require_('../systemBuilder/parts');

const SEEDS = Array.from({ length: Number(process.env.SOAK_SEEDS) || 300 }, (_, i) => i + 1);
const systems = SEEDS.map((seed) => [seed, randomSystem(seed)]);

describe('a random system', () => {
  it('is one the server would publish, for every seed', () => {
    for (const [seed, def] of systems) {
      const checked = checkDefinition(def);
      expect(checked.fatal, `seed ${seed}`).toBeUndefined();
      expect(checked.problems, `seed ${seed}`).toEqual([]);
    }
  });

  it('is what it would be once stored: nothing JSON would change, such as -0', () => {
    for (const [seed, def] of systems) expect(JSON.parse(JSON.stringify(def)), `seed ${seed}`).toEqual(def);
  });
  it('is the same from the same seed, and another from another', () => {
    expect(randomSystem(42)).toEqual(randomSystem(42));
    expect(JSON.stringify(randomSystem(42))).not.toBe(JSON.stringify(randomSystem(43)));
    expect(new Set(systems.map(([, d]) => d.name)).size).toBe(systems.length);
  });

  it('keeps every part on when asked to, for runs that need the game whole', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const def = randomSystem(seed, { parts: false });
      for (const p of PARTS) expect(partOn(def, p), `seed ${seed} ${p}`).toBe(true);
      expect(checkDefinition(def).problems, `seed ${seed}`).toEqual([]);
    }
  });
});

describe('between them, the seeds make', () => {
  const all = systems.map(([, d]) => d);
  const some = (test) => all.some(test);
  const own = (d) => Object.entries(d.conditions || {}).filter(([id]) => /^cond/.test(id)).map(([, c]) => c);

  it('every health model, and every part turned off', () => {
    expect(new Set(all.map((d) => d.core.health.model))).toEqual(new Set(HEALTH_MODELS.map((m) => m.id)));
    for (const p of PARTS) expect(some((d) => d.parts && d.parts[p] && d.parts[p].on === false), p).toBe(true);
  });

  it('renamed words, buildings renamed and off, catalogues priced in their own currency', () => {
    expect(some((d) => d.words)).toBe(true);
    expect(some((d) => d.buildings && d.buildings.types && Object.values(d.buildings.types).some((b) => b.on === false))).toBe(true);
    expect(some((d) => d.buildings && d.buildings.catalogues && Object.values(d.buildings.catalogues).some((b) => b.currency))).toBe(true);
  });

  it('money counted whole, in decimals and in coins, and none', () => {
    expect(some((d) => !d.currencies)).toBe(true);
    expect(some((d) => (d.currencies || []).some((c) => c.denominations))).toBe(true);
    expect(some((d) => (d.currencies || []).some((c) => c.decimals))).toBe(true);
    expect(some((d) => (d.currencies || []).some((c) => !c.decimals && !c.denominations))).toBe(true);
  });

  it('stats tied, formulas reading tables and each other, and tables', () => {
    expect(some((d) => d.stats.some((g) => g.stats.some((s) => s.tie)))).toBe(true);
    expect(some((d) => d.lookups)).toBe(true);
    expect(some((d) => d.derived.some((f) => /tbl\d\(/.test(f.formula)))).toBe(true);
    expect(some((d) => d.derived.some((f) => /@fx\d/.test(f.formula)))).toBe(true);
  });

  it('sheets automatic and laid out by hand, NPCs with a stat block of their own, and tiers', () => {
    expect(some((d) => !d.sheet)).toBe(true);
    expect(some((d) => d.sheet)).toBe(true);
    expect(some((d) => d.npc && d.npc.sheet)).toBe(true);
    expect(some((d) => d.npc && d.npc.tiers && d.npc.tiers.some((t) => typeof t.hp === 'string' && Object.keys(t.values).length))).toBe(true);
  });

  it('conditions of their own ending every way, and rests of their own refilling', () => {
    for (const ends of ['rounds', 'rest']) expect(some((d) => own(d).some((c) => c.ends === ends)), ends).toBe(true);
    expect(some((d) => own(d).some((c) => !c.ends && c.modifiers))).toBe(true);
    expect(some((d) => d.rests && Object.values(d.rests).some((r) => (r.refills || []).some((x) => x.what === 'health')))).toBe(true);
    expect(some((d) => d.rests && Object.values(d.rests).some((r) => (r.refills || []).some((x) => x.what !== 'health')))).toBe(true);
    expect(some((d) => d.rests && Object.entries(d.rests).some(([id, r]) => /^rest\d/.test(id) && r.refills.length))).toBe(true);
  });

  it('house rules with something of every kind waiting on them', () => {
    expect(some((d) => d.house_rules)).toBe(true);
    expect(some((d) => Object.values(d.parts || {}).some((p) => p.only_with))).toBe(true);
    expect(some((d) => d.sheet && d.sheet.sections.some((s) => s.only_with))).toBe(true);
    expect(some((d) => Object.values(d.conditions || {}).some((c) => c.only_with))).toBe(true);
    expect(some((d) => d.derived.some((f) => f.alternative))).toBe(true);
  });
});
