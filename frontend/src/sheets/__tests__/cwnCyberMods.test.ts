import { describe, it, expect } from 'vitest';
import { rowStrain, rowConc, fittedModIds, CONC_ORDER, CWN_CYBER_MOD_SHEET_EFFECTS } from '../cwnCyberMods';

/**
 * The sheet's half of the cyberware mod table (p71).
 *
 * The server owns the whole table; this mirrors only the effects the *client* computes -
 * System Strain, which gates installing, and concealment. The first block is what makes
 * that safe, and it exists because the file claimed a cross-check that had not been
 * written: a comment asserting a test is worse than no comment at all.
 */

const row = (over = {}) => ({
  name: 'Enhanced Reflexes', hl: 3, conc: 'touch', mods: [], cyberMods: [], ...over,
});
const derm = (over = {}) =>
  row({ name: 'Dermal Armor I', conc: 'medical', mods: [{ kind: 'note', target: 'Base AC', value: 16 }], ...over });

describe('the mirror agrees with the server', () => {
  it('steps concealment in the same order', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberMods.js');
    expect(CONC_ORDER).toEqual(backend.CONC_ORDER);
  });

  it('reads a fitted list the same way', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberMods.js');
    for (const v of [undefined, null, '', 'nonsense', 42, {}, ['quick_detach'], '["monoblade"]']) {
      expect(fittedModIds({ cyberMods: v } as never), String(v))
        .toEqual(backend.fittedIds({ cyberMods: v }));
    }
  });

  it('costs a system the same Strain', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberMods.js');
    const cases = [
      row({ hl: 3, cyberMods: ['tailored_interface'] }),
      row({ hl: 2, cyberMods: ['tailored_interface'] }),
      row({ hl: 1, cyberMods: ['tailored_interface'] }),  // too cheap for it
      row({ hl: 0, cyberMods: ['tailored_interface'] }),  // never below zero
      row({ hl: 3, cyberMods: ['quick_detach'] }),        // a mod with no numbers
      row({ hl: 3, cyberMods: [] }),
    ];
    for (const r of cases) {
      expect(rowStrain(r), `${r.hl} ${JSON.stringify(r.cyberMods)}`).toBe(backend.strainOf(r));
    }
  });

  it('hides a system by the same amount', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberMods.js');
    const cases = [
      row({ conc: 'sight', cyberMods: ['profile_adjustment'] }),
      row({ conc: 'touch', cyberMods: ['profile_adjustment'] }),
      row({ conc: 'medical', cyberMods: ['profile_adjustment'] }),
      row({ conc: '', cyberMods: ['profile_adjustment'] }),
      derm({ cyberMods: ['hardened_weave'] }),
      derm({ cyberMods: ['hardened_weave', 'profile_adjustment'] }),
      // Hardened Weave on a system granting no AC does not fit, so nothing is forced.
      row({ conc: 'touch', cyberMods: ['hardened_weave'] }),
    ];
    for (const r of cases) {
      expect(rowConc(r), `${r.conc} ${JSON.stringify(r.cyberMods)}`).toBe(backend.concOf(r));
    }
  });

  it('mirrors only the effects the sheet computes, and says which', async () => {
    // Monoblade, Targeting Processor and Hardened Weave's +2 all land on the server, in an
    // attack roll and in the token's AC. Duplicating them here would be a second place to
    // get them wrong, so the mirror deliberately carries none of them.
    const backend = await import('../../../../backend/sheets/cwnCyberMods.js');
    expect(Object.keys(CWN_CYBER_MOD_SHEET_EFFECTS).sort())
      .toEqual(['hardened_weave', 'profile_adjustment', 'tailored_interface']);
    // Every id it does carry must be a real mod on the server.
    for (const id of Object.keys(CWN_CYBER_MOD_SHEET_EFFECTS)) {
      expect(backend.BY_ID[id], id).toBeDefined();
    }
  });
});

describe('what the sheet does with them', () => {
  it('lowers a 2+ system by a point', () => {
    expect(rowStrain(row({ hl: 3, cyberMods: ['tailored_interface'] }))).toBe(2);
  });

  it('leaves a system too cheap for it alone', () => {
    expect(rowStrain(row({ hl: 1, cyberMods: ['tailored_interface'] }))).toBe(1);
  });

  it('steps concealment one grade, and stops at Medical', () => {
    expect(rowConc(row({ conc: 'sight', cyberMods: ['profile_adjustment'] }))).toBe('touch');
    expect(rowConc(row({ conc: 'medical', cyberMods: ['profile_adjustment'] }))).toBe('medical');
  });

  it('forces Obvious for Hardened Weave, but only where it fits', () => {
    expect(rowConc(derm({ cyberMods: ['hardened_weave'] }))).toBe('obvious');
    // No base AC to improve, so the mod does not apply and the rating stands.
    expect(rowConc(row({ conc: 'touch', cyberMods: ['hardened_weave'] }))).toBe('touch');
  });
});
