import { describe, it, expect } from 'vitest';
import {
  CWN_LANGUAGES, CWN_LANGUAGE_GROUPS, CWN_LANGUAGE_OPTIONS,
  languageAllowance, summariseLanguages, CWN_BASE_LANGUAGES,
} from '../cwnLanguages';
import { getTemplate } from '../index';

/**
 * Languages (CWN p26).
 *
 * The list is a convenience; the allowance is the rule. How many you may know comes off
 * Connect and Know, and the book works one example through, which is the case pinned
 * below.
 */

describe('the list', () => {
  it('covers every region it claims to', () => {
    expect(CWN_LANGUAGE_GROUPS.map((g) => g.region)).toEqual([
      'Americas', 'Europe', 'Middle East & North Africa', 'Africa',
      'South Asia', 'East Asia', 'Southeast Asia',
    ]);
    for (const g of CWN_LANGUAGE_GROUPS) expect(g.languages.length, g.region).toBeGreaterThan(0);
  });

  it('names each language once', () => {
    expect(new Set(CWN_LANGUAGES).size).toBe(CWN_LANGUAGES.length);
  });

  it('offers the two Englishes as a labelled pair', () => {
    // A bare "English" beside "English (GB)" reads as though one of them is the real one.
    expect(CWN_LANGUAGES).toContain('English (US)');
    expect(CWN_LANGUAGES).toContain('English (GB)');
    expect(CWN_LANGUAGES).not.toContain('English');
  });

  it('stores a language as its own name', () => {
    // No catalogue to look one up in and no stats hanging off it, so an id layer would
    // exist only to be translated back - and a typed language has no id to invent.
    for (const o of CWN_LANGUAGE_OPTIONS) expect(o.value).toBe(o.label);
  });
});

describe('how many you may know', () => {
  it("starts with your city's tongue and your own", () => {
    expect(CWN_BASE_LANGUAGES).toBe(2);
    // Untrained is -1 in CWN and grants nothing.
    expect(languageAllowance({ connect: -1, know: -1 })).toBe(2);
  });

  it('works the example the book prints', () => {
    // "a PC with Connect-1 and Know-1 skills would start fluent in their native tongue,
    // the city's common language, and four additional languages of their choice."
    expect(languageAllowance({ connect: 1, know: 1 })).toBe(6);
  });

  it('grants one at level-0 and two at level-1, per skill', () => {
    expect(languageAllowance({ connect: 0, know: -1 })).toBe(3);
    expect(languageAllowance({ connect: 1, know: -1 })).toBe(4);
  });

  it('grants another for every level after that', () => {
    expect(languageAllowance({ connect: 4, know: -1 })).toBe(7);
  });

  it('reads a blank skill as level-0, the way the rest of the sheet does', () => {
    // The two readings are indistinguishable in the data: a character who really is
    // Connect-0 types nothing different from one who never took the skill. Every other
    // reader treats blank as 0 - rolls included - so this does too rather than inventing
    // a second convention. Genuinely untrained is -1, which the skill hint asks for.
    expect(languageAllowance({})).toBe(4);
    expect(languageAllowance(null)).toBe(4);
    expect(languageAllowance({ connect: -1, know: -1 })).toBe(2);
  });
});

describe('the line under the list', () => {
  it('counts what is known against what is allowed', () => {
    const out = summariseLanguages(['English (GB)', 'Cantonese'], { connect: 0, know: -1 });
    expect(out.text).toContain('2 / 3');
    expect(out.warn).toBeFalsy();
  });

  it('flags going over without pretending it is illegal', () => {
    // The book lets months inside a culture earn one, so this is a note, not a block.
    const out = summariseLanguages(['a', 'b', 'c', 'd'], { connect: -1, know: -1 });
    expect(out.warn).toBe(true);
    expect(out.text).toContain('2 more than');
    expect(out.text).toMatch(/GM can grant more/);
  });
});

describe('where it lives', () => {
  const CWN = getTemplate('cities_without_number');
  const field = CWN.sections.flatMap((s) => s.fields ?? []).find((f) => f.id === 'languages')!;

  it('sits on the NOTES tab, not SKILLS', () => {
    // A language is not something you roll, and SKILLS is a grid of numbers you click.
    const section = CWN.sections.find((s) => (s.fields ?? []).some((f) => f.id === 'languages'))!;
    expect(section.tab).toBe('NOTES');
  });

  it('takes a typed entry as well as a listed one', () => {
    // Required, not a nicety: the two you start with are your city's common tongue and
    // your enclave's, and the city is invented per campaign.
    expect(field.allowCustom).toBeTruthy();
  });

  it('is on no other system', () => {
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const ids = getTemplate(id).sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
      expect(ids, id).not.toContain('languages');
    }
  });
});
