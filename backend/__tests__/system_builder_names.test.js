/**
 * A system's name when another already has it (4a1a). DUPLICATE and keep-both installs name the
 * new system "<name> copy", then "<name> copy 02", "03"... (decided with the user, 2026-10-03).
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { uniqueName, sameName } = require_('../systemBuilder/names');
const { LIMITS } = require_('../systemBuilder/definition');

describe('sameName', () => {
  it('matches names trimmed and ignoring case, and nothing else', () => {
    expect(sameName('Hearth', ' hearth ')).toBe(true);
    expect(sameName('HEARTH', 'Hearth')).toBe(true);
    expect(sameName('Hearth', 'Hearthfire')).toBe(false);
    expect(sameName('Hearth copy', 'Hearth')).toBe(false);
  });
});

describe('uniqueName', () => {
  it('keeps a name no system has, trimmed', () => {
    expect(uniqueName('  Hearth ', [])).toBe('Hearth');
    expect(uniqueName('Hearth', ['Ember', 'Hearthstone'])).toBe('Hearth');
    expect(uniqueName('Hearth', undefined)).toBe('Hearth');
  });

  it('names the first copy "<name> copy"', () => {
    expect(uniqueName('Hearth', ['Hearth'])).toBe('Hearth copy');
  });

  it('counts on from 02, two digits', () => {
    expect(uniqueName('Hearth', ['Hearth', 'Hearth copy'])).toBe('Hearth copy 02');
    expect(uniqueName('Hearth', ['Hearth', 'Hearth copy', 'Hearth copy 02'])).toBe('Hearth copy 03');
    const many = ['Hearth', 'Hearth copy', ...Array.from({ length: 8 }, (_, i) => `Hearth copy 0${i + 2}`)];
    expect(uniqueName('Hearth', many)).toBe('Hearth copy 10');
  });

  it('fills the first gap', () => {
    expect(uniqueName('Hearth', ['Hearth', 'Hearth copy 02'])).toBe('Hearth copy');
    expect(uniqueName('Hearth', ['Hearth', 'Hearth copy', 'Hearth copy 03'])).toBe('Hearth copy 02');
  });

  it('compares trimmed and ignoring case', () => {
    expect(uniqueName('hearth', ['HEARTH '])).toBe('hearth copy');
    expect(uniqueName('Hearth', [' hearth', 'HEARTH COPY'])).toBe('Hearth copy 02');
  });

  it('counts on from a copy rather than stacking', () => {
    expect(uniqueName('Hearth copy', ['Hearth', 'Hearth copy'])).toBe('Hearth copy 02');
    expect(uniqueName('Hearth copy 02', ['Hearth', 'Hearth copy', 'Hearth copy 02'])).toBe('Hearth copy 03');
    expect(uniqueName('Hearth Copy', ['Hearth Copy'])).toBe('Hearth copy 02');
  });

  it('keeps a copy name nobody has as it is', () => {
    expect(uniqueName('Hearth copy 07', ['Hearth'])).toBe('Hearth copy 07');
  });

  it('only strips a whole copy suffix', () => {
    expect(uniqueName('Photocopy', ['Photocopy'])).toBe('Photocopy copy');
    expect(uniqueName('Hearth copy 7', ['Hearth copy 7'])).toBe('Hearth copy 7 copy');
    expect(uniqueName('copy', ['copy'])).toBe('copy copy');
  });

  it('shortens a long name to fit the limit', () => {
    const long = 'A'.repeat(LIMITS.name);
    expect(uniqueName(long, [long])).toBe(`${'A'.repeat(LIMITS.name - 5)} copy`);
    const second = uniqueName(long, [long, `${'A'.repeat(LIMITS.name - 5)} copy`]);
    expect(second).toBe(`${'A'.repeat(LIMITS.name - 8)} copy 02`);
    expect(second.length).toBe(LIMITS.name);
  });

  it('takes its limit from the caller', () => {
    expect(uniqueName('Hearthfire', ['Hearthfire'], 10)).toBe('Heart copy');
  });

  it('never leaves a space before the suffix, nor splits a character', () => {
    expect(uniqueName('Hearth fire', ['Hearth fire'], 12)).toBe('Hearth copy');
    // 🔥 is two UTF-16 units, as the name limit counts them: cutting at 3 would leave half of one.
    expect(uniqueName('Ab🔥🔥', ['Ab🔥🔥'], 8)).toBe('Ab copy');
    expect(uniqueName('Ab🔥🔥', ['Ab🔥🔥'], 9)).toBe('Ab🔥 copy');
  });
});
