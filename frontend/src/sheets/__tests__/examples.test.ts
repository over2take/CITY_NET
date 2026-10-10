import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { exampleFacts, suggestedName, isBrowseControl, lockControls, LOCKED_MESSAGE } from '../examples';
import type { Definition } from '../systemsApi';

/**
 * The built-in examples in the builder (4d1b). Approved mockup builder-examples (2026-10-08): a card
 * each saying what it holds, a name to copy it under, and every page locked but for moving around.
 */

const { exampleDefinition } = createRequire(import.meta.url)('../../../../backend/systemBuilder/examples.js');

describe('what an example\'s card says', () => {
  it('reads the server\'s own examples', () => {
    expect(exampleFacts(exampleDefinition('cwn'))).toEqual([
      ['HEALTH', 'One pool'], ['ADVANCES', 'XP levels'], ['STATS', '14 in 6 groups'], ['FORMULAS', '17'], ['DISTANCE', 'Meters'],
    ]);
    expect(exampleFacts(exampleDefinition('cpr'))).toEqual([
      ['HEALTH', 'One pool'], ['ADVANCES', 'Spend IMPROVEMENT POINTS'], ['STATS', '12 in 3 groups'], ['FORMULAS', '1'], ['DISTANCE', 'Meters'],
    ]);
    expect(exampleFacts(exampleDefinition('sr6'))).toEqual([
      ['HEALTH', 'Two tracks, overflow'], ['ADVANCES', 'Spend KARMA'], ['STATS', '11 in 3 groups'], ['FORMULAS', '6'], ['DISTANCE', 'Meters'],
    ]);
  });

  it('says what a system leaves out as the defaults, in the singular where it is one', () => {
    expect(exampleFacts({ format: 1, name: 'Bare' })).toEqual([
      ['HEALTH', 'One pool'], ['ADVANCES', 'None'], ['STATS', '0 in 0 groups'], ['FORMULAS', '0'], ['DISTANCE', 'Feet'],
    ]);
    const one: Definition = {
      format: 1, name: 'One', stats: [{ id: 'a', label: 'A', stats: [{ id: 'x', label: 'X' }] }], derived: [{ id: 'y', formula: '1' }],
      core: { health: { model: 'tracks', tracks: [] }, advancement: ['levels', 'use'] }, words: { xp: { singular: ' ', plural: '' } },
    };
    expect(exampleFacts(one)).toEqual([
      ['HEALTH', 'Two tracks'], ['ADVANCES', 'XP levels, Improve by use'], ['STATS', '1 in 1 group'], ['FORMULAS', '1'], ['DISTANCE', 'Feet'],
    ]);
  });

  it('says XP as the system says it, as many, or as one when that is all it gives', () => {
    const spending = (xp: Record<string, string>) => exampleFacts({ format: 1, name: 'W', core: { advancement: ['spend'] }, words: { xp } })[1][1];
    expect(spending({ singular: 'KARMA', plural: 'KARMA' })).toBe('Spend KARMA');
    expect(spending({ singular: 'MARK', plural: 'MARKS' })).toBe('Spend MARKS');
    expect(spending({ singular: 'MARK' })).toBe('Spend MARK');
  });

  it('suggests a name for a copy', () => {
    expect(suggestedName('Shadowrun 6E')).toBe('Shadowrun 6E (house rules)');
    expect(LOCKED_MESSAGE).toBe('This is an example: copy it to change it.');
  });
});

describe('locking a page', () => {
  const page = () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <input id="text"><select id="pick"></select><textarea id="notes"></textarea><button id="add">+</button>
      <button id="tab" role="tab">FORMULAS</button><button id="open" aria-expanded="false">SETTINGS</button>
      <button id="view" data-browse>OWNER</button><button id="already" disabled>X</button>`;
    return root;
  };
  const byId = (root: Element, id: string) => root.querySelector(`#${id}`) as HTMLButtonElement;

  it('locks every control but those that only move around', () => {
    const root = page();
    expect(lockControls(root)).toBe(4);
    for (const id of ['text', 'pick', 'notes', 'add', 'already']) expect(byId(root, id).disabled, id).toBe(true);
    for (const id of ['tab', 'open', 'view']) expect(byId(root, id).disabled, id).toBe(false);
  });

  it('touches only what isn\'t locked yet, so locking again changes nothing', () => {
    const root = page();
    lockControls(root);
    expect(lockControls(root)).toBe(0);
    byId(root, 'add').disabled = false;
    expect(lockControls(root)).toBe(1);
  });

  it('knows a browsing control by its role, its opening out, or its mark', () => {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild!; };
    expect(isBrowseControl(el('<button role="tab"></button>'))).toBe(true);
    expect(isBrowseControl(el('<button aria-expanded="true"></button>'))).toBe(true);
    expect(isBrowseControl(el('<button data-browse></button>'))).toBe(true);
    expect(isBrowseControl(el('<button role="switch" aria-checked="true"></button>'))).toBe(false);
    expect(isBrowseControl(el('<button aria-pressed="true"></button>'))).toBe(false);
  });
});
