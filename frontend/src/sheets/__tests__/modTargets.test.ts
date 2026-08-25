/**
 * What a cyberware modifier can point at.
 *
 * Derived from each system's sheet template rather than listed, so these tests are mostly
 * about the derivation holding up across three templates that are shaped differently — and
 * about it not offering a target that could never work.
 */

import { describe, it, expect } from 'vitest';
import { getTemplate } from '../index';
import { statFields, skillFields, targetOptions } from '../modTargets';

const labels = (system: string, pick: typeof statFields) =>
  pick(getTemplate(system)).map((f) => f.label);

describe('stats, per system', () => {
  it('finds them through the skills rather than a section named STATS', () => {
    // Each skill names the stat it keys off, so the stat block is wherever those live.
    expect(labels('cyberpunk_red', statFields))
      .toEqual(['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'BODY', 'EMP', 'LUCK', 'MOVE']);
  });

  it('works on a system whose skills key off a modifier rather than the score', () => {
    // CWN skills key off `int_mod`, not `int`. Following the reference still lands in the
    // attribute block, and what comes back is the scores.
    expect(labels('cities_without_number', statFields))
      .toEqual(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
  });

  it('leaves out derived fields, which could never hold a modifier', () => {
    // STR MOD is recomputed from STR on every save, so a modifier aimed at it is
    // overwritten before anyone reads it.
    expect(labels('cities_without_number', statFields)).not.toContain('STR MOD');
  });

  it('leaves out maximums, which are a ceiling rather than a stat', () => {
    const cpr = labels('cyberpunk_red', statFields);
    expect(cpr).toContain('EMP');
    expect(cpr).not.toContain('EMP MAX');
    expect(cpr).not.toContain('LUCK MAX');
  });

  it('keeps the stats no skill happens to key off', () => {
    // MOVE and LUCK are not any skill's stat, and chrome can plausibly modify both.
    expect(labels('cyberpunk_red', statFields)).toEqual(expect.arrayContaining(['MOVE', 'LUCK']));
  });

  it('offers nothing for a system with no skills at all', () => {
    expect(labels('generic', statFields)).toEqual([]);
  });
});

describe('skills, per system', () => {
  it('offers this system\'s skills and not another\'s', () => {
    const cpr = labels('cyberpunk_red', skillFields);
    const sr6 = labels('shadowrun_6e', skillFields);
    expect(cpr).toContain('Business');
    expect(sr6).not.toContain('Business');
    expect(sr6).toContain('Sorcery');
    expect(cpr).not.toContain('Sorcery');
  });
});

describe('choosing a target', () => {
  const cpr = getTemplate('cyberpunk_red');

  it('offers skills for a skill modifier and stats for a stat one', () => {
    expect(targetOptions('skill', cpr).map((o) => o.value)).toContain('Business');
    expect(targetOptions('stat', cpr).map((o) => o.value)).toContain('COOL');
    expect(targetOptions('stat', cpr).map((o) => o.value)).not.toContain('Business');
  });

  it('treats setting and adjusting as the same list', () => {
    // What you may point at does not depend on whether you are adding to it or replacing
    // it; only the arithmetic differs.
    expect(targetOptions('skillSet', cpr)).toEqual(targetOptions('skill', cpr));
    expect(targetOptions('statSet', cpr)).toEqual(targetOptions('stat', cpr));
  });

  it('keeps an imported target the system does not have', () => {
    // The Companion calls it "Initiative Roll"; this list says "Initiative". Dropping the
    // difference would quietly change what an imported piece does the first time someone
    // opened the form on it.
    const opts = targetOptions('roll', cpr, 'Initiative Roll').map((o) => o.value);
    expect(opts[0]).toBe('Initiative Roll');
    expect(opts).toContain('Initiative');
  });

  it('does not list a known target twice', () => {
    const opts = targetOptions('skill', cpr, 'Business').map((o) => o.value);
    expect(opts.filter((v) => v === 'Business')).toHaveLength(1);
  });

  it('offers nothing rather than throwing when there is no template', () => {
    // The window takes the template as optional, and a sheet can render before one is known.
    expect(targetOptions('stat', undefined)).toEqual([]);
    expect(targetOptions('roll', undefined, 'Initiative Roll')[0].value).toBe('Initiative Roll');
  });
});
