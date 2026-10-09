/**
 * The TRY IT page as logic (4c2). Approved mockup builder-try-it (2026-10-08): a throwaway
 * character starting from the sample, formulas worked out from what is typed by the server's own
 * engine, SAVE AS THE SAMPLE CHARACTER and RESET, and a pretend token for health.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  sampleCharacter, withTyped, withCharacterAsData, differsFromSample, withCharacterAsSample,
  startingToken, asLocation, withMax, SAMPLE_NAME,
} from '../tryIt';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { previewDerived } = req('../../../../backend/systemBuilder/derived.js');
const { tryHealth } = req('../../../../backend/systemBuilder/tryHealth.js');

const H: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'level', label: 'Level' }, { id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - (@level + @str)' }],
  samples: { level: 3, str: 2 },
};
const NUMBER = { id: 'str', type: 'number' as const };
const TEXT = { id: 'name', type: 'text' as const };

describe('the made-up character', () => {
  it('starts from the sample, named', () => {
    expect(sampleCharacter(H)).toEqual({ name: SAMPLE_NAME, level: 3, str: 2 });
    expect(sampleCharacter({ format: 1, name: 'X' })).toEqual({ name: SAMPLE_NAME });
    // A stat with no sample is left out, not written as nothing.
    expect(sampleCharacter({ ...H, samples: { level: 3 } })).toEqual({ name: SAMPLE_NAME, level: 3 });
  });

  it('takes typed numbers as numbers, text as written, blanks as nothing', () => {
    let c = withTyped(sampleCharacter(H), NUMBER, '5');
    c = withTyped(c, TEXT, 'Vex');
    expect(c).toEqual({ name: 'Vex', level: 3, str: 5 });
    expect(withTyped(c, NUMBER, '')).toEqual({ name: 'Vex', level: 3 });
    expect(withTyped(c, NUMBER, 'x')).toEqual({ name: 'Vex', level: 3 });
    expect(withTyped(c, NUMBER, 7)).toMatchObject({ str: 7 });
    expect(withTyped(c, TEXT, '')).toEqual({ level: 3, str: 5 });
    expect(withTyped(c, TEXT, 42)).toMatchObject({ name: '42' });
  });

  it('is worked out by the server\'s engine from what is typed', () => {
    const c = withTyped(withTyped(sampleCharacter(H), NUMBER, '6'), TEXT, 'Vex');
    const data = withCharacterAsData(H, c);
    expect(data.samples).toEqual({ level: 3, str: 6 });
    expect(previewDerived({ lookups: data.lookups, derived: data.derived }, data.samples).values).toEqual({ save: 7 });
    // The draft's own sample is untouched.
    expect(H.samples).toEqual({ level: 3, str: 2 });
  });
});

describe('the sample', () => {
  it('is offered for saving only when the stats differ from it', () => {
    expect(differsFromSample(H, sampleCharacter(H))).toBe(false);
    expect(differsFromSample(H, withTyped(sampleCharacter(H), TEXT, 'Vex'))).toBe(false);
    expect(differsFromSample(H, withTyped(sampleCharacter(H), NUMBER, '9'))).toBe(true);
    expect(differsFromSample(H, withTyped(sampleCharacter(H), NUMBER, ''))).toBe(true);
  });

  it('takes the character\'s stats when saved, and nothing else, as the server accepts', () => {
    let c = withTyped(sampleCharacter(H), NUMBER, '9');
    c = withTyped(c, TEXT, 'Vex');
    c = { ...c, notes: 4 };
    const saved = withCharacterAsSample(H, c);
    expect(saved.samples).toEqual({ level: 3, str: 9 });
    expect(checkDefinition(saved).problems).toEqual([]);
    expect(differsFromSample(saved, c)).toBe(false);
    // A stat left blank clears its sample.
    expect(withCharacterAsSample(H, withTyped(c, NUMBER, '')).samples).toEqual({ level: 3 });
  });
});

describe('the pretend token', () => {
  it('starts full at 10, or at the wound count where wounds are the token', () => {
    expect(startingToken(H)).toEqual({ current: 10, max: 10, temp: 0 });
    expect(startingToken({ ...H, core: { health: { model: 'wounds', count: 3, penalty: -1 } } })).toEqual({ current: 3, max: 3, temp: 0 });
    expect(startingToken({ ...H, core: { health: { model: 'wounds' } } })).toEqual({ current: 10, max: 10, temp: 0 });
  });

  it('reads as a token to the HEALTH panels', () => {
    expect(asLocation({ current: 4, max: 9, temp: 2 })).toEqual({ id: -1, hp_current: 4, hp_max: 9, hp_temp: 2 });
  });

  it('sets its maximum as the game does: a token at 0 fills, current never above', () => {
    expect(withMax({ current: 8, max: 10, temp: 1 }, 5)).toEqual({ current: 5, max: 5, temp: 1 });
    expect(withMax({ current: 3, max: 10, temp: 0 }, 20)).toEqual({ current: 3, max: 20, temp: 0 });
    expect(withMax({ current: 0, max: 10, temp: 0 }, 12)).toEqual({ current: 12, max: 12, temp: 0 });
    expect(withMax({ current: 4, max: 10, temp: 0 }, -3)).toEqual({ current: 0, max: 0, temp: 0 });
    expect(withMax({ current: 4, max: 10, temp: 0 }, NaN)).toEqual({ current: 0, max: 0, temp: 0 });
  });

  it('is what the server tries health on', () => {
    const r = tryHealth(H, { token: startingToken(H), action: { kind: 'damage', amount: 4 } });
    expect(r.token).toEqual({ current: 6, max: 10, temp: 0 });
  });
});
