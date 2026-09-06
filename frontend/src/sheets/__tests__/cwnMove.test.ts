import { describe, it, expect } from 'vitest';
import { cwnMoveRate, cwnMoveBonus, CWN_BASE_MOVE } from '../cyberwareEffects';
import { getTemplate } from '../index';

/**
 * Move rate, on the sheet's side of the mirror.
 *
 * The server owns the number and writes it into the sheet on every save, which is where
 * the STATS field reads it from - the same arrangement every other derived field has. This
 * side exists so there is one definition here too, and the first block runs the real server
 * module over the same data to keep them honest.
 *
 * Worth stating because it is not what you would guess: CWN derives Move from no attribute
 * at all. A flat 10 meters for a normal human, and the only implant in the book that
 * changes it is Coordination Augment II.
 */

const CWN = getTemplate('cities_without_number');

const implant = (over = {}) => ({
  name: 'Coordination Augment II', type: 'nerve', side: null, hl: 3,
  placed: true, equipped: true,
  mods: [{ kind: 'note', target: 'Move (meters)', value: 10 }], ...over,
});

describe('the sheet agrees with the server', () => {
  const cases: Record<string, unknown>[] = [
    {},
    { move_mod: 5 },
    { move_mod: -4 },
    { move_mod: -50 },
    { cyberware: [implant()] },
    { cyberware: [implant()], move_mod: 5 },
    { cyberware: [implant(), implant()] },
    { cyberware: [implant({ placed: false })] },
    { cyberware: [implant({ equipped: false })] },
    { cyberware: [implant({ mods: [{ kind: 'note', target: 'Move (metres)', value: 10 }] })] },
    { cyberware: [implant({ mods: 'nonsense' })] },
    { cyberware: 'nonsense' },
    { dex: 18, str: 18 },
  ];

  it('computes the same Move for every shape of sheet', async () => {
    const backend = await import('../../../../backend/sheets/templates.js');
    for (const c of cases) {
      const server: Record<string, unknown> = { ...c };
      backend.applyDerived('cities_without_number', server);
      expect(cwnMoveRate(c), JSON.stringify(c)).toBe(server.move);
    }
  });

  it('reads the same bonus off the chrome', async () => {
    const backend = await import('../../../../backend/sheets/templates.js');
    for (const c of cases) {
      expect(cwnMoveBonus(c), JSON.stringify(c)).toBe(backend.cwnMoveBonus(c));
    }
  });

  it('starts from the same base', async () => {
    const backend = await import('../../../../backend/sheets/templates.js');
    expect(CWN_BASE_MOVE).toBe(10);
    expect(backend.CWN_BASE_MOVE).toBe(CWN_BASE_MOVE);
  });
});

describe('what the STATS block shows', () => {
  it('is ten meters for an ordinary character', () => {
    expect(cwnMoveRate({})).toBe(10);
  });

  it('takes it from no attribute', () => {
    // A Dex 18 sprinter and a Dex 3 one both cover 10 meters. The book says so, and the
    // sheet should not invent a rule the table would then have to argue with.
    for (const dex of [3, 10, 18]) expect(cwnMoveRate({ dex, str: dex })).toBe(10);
  });

  it('is twenty with a Coordination Augment II fitted', () => {
    expect(cwnMoveRate({ cyberware: [implant()] })).toBe(20);
  });

  it('goes back to ten when it comes out', () => {
    // Computed on read, never written in as a new base.
    expect(cwnMoveRate({ cyberware: [] })).toBe(10);
  });

  it('counts only chrome that is installed and switched on', () => {
    expect(cwnMoveRate({ cyberware: [implant({ placed: false })] })).toBe(10);
    expect(cwnMoveRate({ cyberware: [implant({ equipped: false })] })).toBe(10);
  });

  it('takes the table modifier, for the rules the app cannot work out', () => {
    // Encumbrance costs 30% (p48) and prone halves it (p35). There is no inventory to
    // weigh and no posture to read, so a GM applies those here.
    expect(cwnMoveRate({ move_mod: -3 })).toBe(7);
  });

  it('never goes below zero', () => {
    expect(cwnMoveRate({ move_mod: -50 })).toBe(0);
  });
});

describe('the fields exist to be shown', () => {
  const fields = CWN.sections.flatMap((s) => s.fields ?? []);

  it('puts MOVE on the STATS tab, derived', () => {
    expect(fields.find((f) => f.id === 'move')!.derived).toBe(true);
    const section = CWN.sections.find((s) => (s.fields ?? []).some((f) => f.id === 'move'))!;
    expect(section.tab).toBe('STATS');
  });

  it('gives the table a modifier for the rules the app cannot work out', () => {
    expect(fields.some((f) => f.id === 'move_mod')).toBe(true);
  });

  it('keeps MOVE MOD off every other system', () => {
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const ids = getTemplate(id).sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
      expect(ids, id).not.toContain('move_mod');
    }
  });

  it("leaves Cyberpunk RED's own MOVE alone, which is a different stat", () => {
    // CP:R has a MOVE attribute the player sets and which its own rules multiply. It
    // shares an id with the CWN field and means something else, so it must stay typed
    // rather than picking up a derivation from another game's book.
    const cpr = getTemplate('cyberpunk_red').sections.flatMap((s) => s.fields ?? []);
    expect(cpr.find((f) => f.id === 'move')!.derived).toBeUndefined();
  });
});
