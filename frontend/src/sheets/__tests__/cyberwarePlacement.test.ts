/**
 * Placement as its own stored fact.
 *
 * Whether a piece is in the body used to be worked out from its type, which made naming a
 * type install the piece: choosing "Fashionware" in the list fitted it on the spot, and
 * there was no way to own something you had not put anywhere yet. Saying what a piece is
 * and putting it somewhere are two decisions, and only the diagram makes the second.
 *
 * The mirrored server module has to reach the same answers, so it is checked against here.
 */

import { describe, it, expect } from 'vitest';
import { normaliseRow, needsPlacing, rowsForPanel, installedStrain, strainCeiling } from '../cyberwareRows';

describe('naming a type does not fit the piece', () => {
  it('leaves an unpaired type unplaced', () => {
    // The regression to guard: Fashionware has no side, so the old rule counted it placed
    // the instant it was typed.
    const row = normaliseRow({ name: 'Tattoo', type: 'fashionware', placed: false });
    expect(row.placed).toBe(false);
    expect(needsPlacing(row)).toBe(true);
  });

  it('leaves a paired type unplaced', () => {
    const row = normaliseRow({ name: 'eye thing', type: 'cybereye', placed: false });
    expect(needsPlacing(row)).toBe(true);
  });

  it('keeps it off the body diagram until it is placed', () => {
    const row = normaliseRow({ name: 'Tattoo', type: 'fashionware', placed: false });
    expect(rowsForPanel([row], 'fashionware', null)).toEqual([]);
  });

  it('puts it on the diagram once it is placed', () => {
    const row = normaliseRow({ name: 'Tattoo', type: 'fashionware', placed: true });
    expect(rowsForPanel([row], 'fashionware', null)).toEqual([row]);
  });

  it('keeps a placed piece off the panel for the other side', () => {
    const row = normaliseRow({ name: 'eye', type: 'cybereye', side: 'l', placed: true });
    expect(rowsForPanel([row], 'cybereye', 'l')).toEqual([row]);
    expect(rowsForPanel([row], 'cybereye', 'r')).toEqual([]);
  });

  it('believes what is stored over what the type would suggest', () => {
    // Both directions, so neither is an accident of the default.
    expect(normaliseRow({ type: 'fashionware', placed: false }).placed).toBe(false);
    expect(normaliseRow({ type: '', placed: true }).placed).toBe(true);
  });
});

describe('rows stored before placement was recorded', () => {
  // These have no `placed` field. Defaulting them to false would uninstall chrome nobody
  // touched, so the rule they were written under is kept for exactly those rows.
  it('treats an unpaired type as installed, as it was', () => {
    expect(normaliseRow({ name: 'Tattoo', type: 'fashionware' }).placed).toBe(true);
  });

  it('treats a paired type with a side as installed, as it was', () => {
    expect(normaliseRow({ name: 'arm', type: 'cyberarm', side: 'l' }).placed).toBe(true);
  });

  it('treats a paired type with no side as still waiting, as it was', () => {
    expect(normaliseRow({ name: 'arm', type: 'cyberarm' }).placed).toBe(false);
  });

  it('treats an untyped row as waiting, which is how every import arrived', () => {
    expect(normaliseRow({ name: 'Self ICE' }).placed).toBe(false);
  });
});

describe('agreeing with the server on what is installed', () => {
  const CASES = [
    { why: 'typed but not fitted', row: { type: 'fashionware', placed: false } },
    { why: 'fitted', row: { type: 'fashionware', placed: true } },
    { why: 'paired, fitted', row: { type: 'cyberarm', side: 'r', placed: true } },
    { why: 'paired, no side', row: { type: 'cyberarm', placed: false } },
    { why: 'legacy unpaired', row: { type: 'fashionware' } },
    { why: 'legacy paired with a side', row: { type: 'cyberleg', side: 'l' } },
    { why: 'legacy paired without one', row: { type: 'cyberleg' } },
    { why: 'legacy untyped', row: { name: 'Self ICE' } },
  ];

  it.each(CASES)('reaches the same answer for $why', async ({ row }) => {
    const backend = await import('../../../../backend/sheets/cyberware.js');
    expect(!needsPlacing(normaliseRow(row))).toBe(backend.default.isPlaced(backend.default.normaliseRow(row)));
  });
});

describe('the System Strain ceiling', () => {
  // CWN p40: maximum System Strain equals Constitution, and installed gear may not exceed
  // it. Owning chrome costs nothing - only what is in the body counts.
  const row = (name: string, hl: number, extra = {}) =>
    normaliseRow({ name, type: 'body', hl, equipped: true, placed: true, ...extra });

  it('counts only what is installed', () => {
    const rows = [row('In', 3), row('Owned', 5, { placed: false })];
    expect(installedStrain(rows)).toBe(3);
  });

  it('ignores chrome that is switched off', () => {
    expect(installedStrain([row('Off', 4, { equipped: false })])).toBe(0);
  });

  it('adds fractional strain without rounding it away', () => {
    // Four quarter-point implants are a whole point, not zero.
    expect(installedStrain([row('a', 0.25), row('b', 0.25), row('c', 0.25), row('d', 0.25)])).toBe(1);
  });

  it('sets the ceiling from Constitution', () => {
    const c = strainCeiling({ con: 13 }, [row('In', 3)]);
    expect(c.max).toBe(13);
    expect(c.load).toBe(3);
    expect(c.free).toBe(10);
  });

  it('gives a Full Body Conversion an effective Constitution of 20', () => {
    // p67, stated outright. Without this the characters built to carry the most chrome
    // would be the ones refused first.
    const rows = [row('Full Body Conversion', 0), row('Other', 5)];
    expect(strainCeiling({ con: 9 }, rows).max).toBe(20);
  });

  it('lets a Cybernetic Infrastructure Baseline ignore 12 minus Constitution', () => {
    // p66: a CON 9 character ignores three points of implant strain.
    const rows = [row('Cybernetic Infrastructure Baseline', 0), row('Heavy', 8)];
    expect(strainCeiling({ con: 9 }, rows).load).toBe(5);
  });

  it('never lets that ignore become a penalty', () => {
    // 12 minus a Constitution of 14 is negative; it ignores nothing rather than costing.
    const rows = [row('Cybernetic Infrastructure Baseline', 0), row('Heavy', 8)];
    expect(strainCeiling({ con: 14 }, rows).load).toBe(8);
  });

  it('reads an unset Constitution as no capacity at all', () => {
    // A blank sheet should refuse rather than silently permit everything.
    expect(strainCeiling({}, []).max).toBe(0);
  });
});
