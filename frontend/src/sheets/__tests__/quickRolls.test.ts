/**
 * What a player can roll from their token's QUICK ACTIONS, read off each system's template.
 *
 * Checked against the real templates, so a roll added to or taken off a sheet shows up here
 * without anyone remembering to - and a test fails if a system loses its quick rolls.
 */

import { describe, it, expect } from 'vitest';
import { getTemplate } from '..';
import { quickRolls } from '../quickRolls';

const ids = (rolls: { fieldId: string }[]) => rolls.map((r) => r.fieldId);

describe('quickRolls', () => {
  it("CWN: the four saves as buttons, every skill in the picker", () => {
    const { checks, skills } = quickRolls(getTemplate('cities_without_number'), ['DELUXE']);
    expect(ids(checks)).toEqual(['save_physical', 'save_evasion', 'save_mental', 'save_luck']);
    expect(checks[0].label).toBe('PHYSICAL SAVE');
    const all = skills.flatMap((g) => ids(g.rolls));
    expect(all.length).toBeGreaterThan(10);
    expect(all).not.toContain('save_physical');
  });

  it("CWN Deluxe's casting and summoning come only when the house rule shows that tab", () => {
    const off = quickRolls(getTemplate('cities_without_number'), ['DELUXE']);
    const on = quickRolls(getTemplate('cities_without_number'), undefined);
    expect(ids(off.checks)).not.toContain('cast_skill');
    expect(ids(on.checks)).toEqual(expect.arrayContaining(['cast_skill', 'summon_skill']));
  });

  it('CP:R: the rollable stats as buttons, and never MOVE or LUCK', () => {
    const { checks, skills } = quickRolls(getTemplate('cyberpunk_red'));
    expect(ids(checks)).toEqual(['int', 'ref', 'dex', 'tech', 'cool', 'will', 'body', 'emp']);
    expect(ids(checks)).not.toContain('move');
    expect(ids(checks)).not.toContain('luck');
    expect(skills.length).toBeGreaterThan(1);
  });

  it('SR6: initiative and composure as buttons, skills in the picker', () => {
    const { checks, skills } = quickRolls(getTemplate('shadowrun_6e'));
    expect(ids(checks)).toEqual(['initiative_score', 'composure']);
    expect(skills.flatMap((g) => g.rolls).length).toBeGreaterThan(5);
  });

  it('a system with no rolls, or no template, offers none', () => {
    expect(quickRolls(getTemplate('generic'))).toEqual({ checks: [], skills: [] });
    expect(quickRolls(null)).toEqual({ checks: [], skills: [] });
  });
});
