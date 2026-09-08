import { describe, it, expect } from 'vitest';
import {
  CWN_PHARMACEUTICALS, PHARMA_FIELD, pharmaById, activeDrugs, writeActive,
  pharmaEffects, endScene, describePharma, carriedDoses, consumeDose,
} from '../cwnPharma';

/**
 * Pharmaceuticals (p60-61).
 *
 * The first block is why mirroring is safe: it walks both copies entry by entry, so a drug
 * edited on one side and not the other fails here rather than in somebody's game. The rest
 * is the stacking rule, which is the only real arithmetic in the feature - and the one
 * place a plausible-looking implementation (summing) would be wrong.
 */

describe('the mirror agrees with the server', () => {
  it('carries the same drugs, with the same numbers', async () => {
    const backend = await import('../../../../backend/sheets/cwnPharma.js');
    expect(CWN_PHARMACEUTICALS.map((p) => p.id)).toEqual(
      backend.PHARMACEUTICALS.map((p: { id: string }) => p.id),
    );
    const sorted = (o: object) => Object.fromEntries(Object.entries(o).sort());
    for (const [i, drug] of CWN_PHARMACEUTICALS.entries()) {
      // The whole object, not the fields this side happens to know about: a key present
      // on one side and absent on the other is exactly the drift worth catching.
      expect(sorted(drug), drug.id).toEqual(sorted(backend.PHARMACEUTICALS[i]));
    }
  });

  it('reads the same sheet field', async () => {
    const backend = await import('../../../../backend/sheets/cwnPharma.js');
    expect(PHARMA_FIELD).toBe(backend.FIELD);
  });

  it('computes the same effects from the same sheet', async () => {
    const backend = await import('../../../../backend/sheets/cwnPharma.js');
    const shapes = [
      {},
      { [PHARMA_FIELD]: [] },
      { [PHARMA_FIELD]: ['boneshaker'] },
      { [PHARMA_FIELD]: ['olympus'] },
      { [PHARMA_FIELD]: ['boneshaker', 'olympus'] },
      { [PHARMA_FIELD]: ['boneshaker', 'olympus', 'avalanche'] },
      { [PHARMA_FIELD]: ['avalanche', 'psycho'] },
      { [PHARMA_FIELD]: JSON.stringify(['boneshaker', 'window']) },
      { [PHARMA_FIELD]: ['boneshaker', 'boneshaker'] },
      { [PHARMA_FIELD]: ['not_a_drug'] },
      { [PHARMA_FIELD]: 'nonsense' },
    ];
    for (const data of shapes) {
      const mine = pharmaEffects(data as never);
      const theirs = backend.activeEffects(data);
      const strip = (e: { active: { id: string }[] }) => ({ ...e, active: e.active.map((d) => d.id) });
      expect(strip(mine), JSON.stringify(data)).toEqual(strip(theirs));
      expect(endScene(data as never), JSON.stringify(data)).toEqual(backend.endScene(data));
    }
  });
});

describe('the book table', () => {
  it('has all sixteen', () => {
    expect(CWN_PHARMACEUTICALS).toHaveLength(16);
  });

  it('marks Reset as the one needing a Contact', () => {
    // The book's @ against $1,000. It is the only row carrying the marker.
    expect(CWN_PHARMACEUTICALS.filter((p) => p.rare).map((p) => p.id)).toEqual(['reset']);
  });

  it('prices the cheap habit and the desperate one', () => {
    expect(pharmaById('sand')!.cost).toBe(2);
    expect(pharmaById('reset')!.cost).toBe(1000);
  });

  it('records which drugs anyone can administer', () => {
    // "None" in the Heal column means user-friendly enough to shoot up yourself.
    expect(pharmaById('boneshaker')!.heal).toBeNull();
    expect(pharmaById('avalanche')!.heal).toBe(0);
    expect(pharmaById('panacea')!.heal).toBe(1);
  });

  it('only ever gives a number to the three the app can actually apply', () => {
    const numeric = CWN_PHARMACEUTICALS.filter(
      (p) => p.hit || p.damage || p.shock || p.grantsHp || p.incomingTrauma,
    );
    expect(numeric.map((p) => p.id).sort()).toEqual(['avalanche', 'boneshaker', 'olympus']);
  });
});

describe('the stacking rule', () => {
  const on = (...ids: string[]) => pharmaEffects({ [PHARMA_FIELD]: ids } as never);

  it('takes the highest bonus, not the sum', () => {
    // p60: "in the case that multiple drugs are taken at once, only the highest bonus
    // applies". Boneshaker +2 and Olympus +2 is +2 to hit, and summing would give +4.
    expect(on('boneshaker', 'olympus').hit).toBe(2);
  });

  it('takes the highest of each channel separately', () => {
    // Olympus beats nothing on damage, so Boneshaker's +2 still stands there.
    const e = on('boneshaker', 'olympus');
    expect([e.hit, e.damage, e.shock]).toEqual([2, 2, 2]);
  });

  it('does not stack a drug with itself', () => {
    expect(on('boneshaker', 'boneshaker').hit).toBe(2);
  });

  it('sums the Strain, because that is a price and not a bonus', () => {
    // Boneshaker 2 + Olympus 1. Capping this would let a character run two scene drugs
    // for the price of the dearer one.
    expect(on('boneshaker', 'olympus').sceneStrain).toBe(3);
  });

  it('carries the incoming Trauma penalty', () => {
    expect(on('boneshaker').incomingTrauma).toBe(2);
    expect(on('olympus').incomingTrauma).toBe(0);
  });

  it('takes the worst Major Injury penalty rather than the largest number', () => {
    expect(on('avalanche').majorInjury).toBe(-1);
    expect(on('avalanche', 'boneshaker').majorInjury).toBe(-1);
  });

  it('gives nothing at all on a clean sheet', () => {
    expect(pharmaEffects({} as never).active).toEqual([]);
    expect(pharmaEffects({} as never).hit).toBe(0);
  });
});

describe('reading what is running', () => {
  it('accepts an array or the JSON string the sheet stores', () => {
    expect(activeDrugs({ [PHARMA_FIELD]: ['olympus'] } as never).map((d) => d.id)).toEqual(['olympus']);
    expect(activeDrugs({ [PHARMA_FIELD]: '["olympus"]' } as never).map((d) => d.id)).toEqual(['olympus']);
  });

  it('drops what it does not recognise instead of guessing', () => {
    expect(activeDrugs({ [PHARMA_FIELD]: ['olympus', 'aspirin'] } as never).map((d) => d.id))
      .toEqual(['olympus']);
  });

  it('survives broken JSON on a hand-edited sheet', () => {
    expect(activeDrugs({ [PHARMA_FIELD]: '[' } as never)).toEqual([]);
    expect(activeDrugs({ [PHARMA_FIELD]: 42 } as never)).toEqual([]);
    expect(activeDrugs(null)).toEqual([]);
  });

  it('round-trips through what it writes', () => {
    const written = writeActive(['boneshaker', 'avalanche']);
    expect(activeDrugs({ [PHARMA_FIELD]: written } as never).map((d) => d.id))
      .toEqual(['boneshaker', 'avalanche']);
  });
});

describe('ending the scene', () => {
  const at = (...ids: string[]) => endScene({ [PHARMA_FIELD]: ids } as never);

  it('ends the scene-length doses and bills their Strain', () => {
    expect(at('boneshaker', 'olympus')).toEqual({
      remaining: [], ended: ['boneshaker', 'olympus'], strain: 3,
    });
  });

  it('leaves an hour-long dose running, because a fight is not an hour', () => {
    // Avalanche lasts an hour. Clearing it with the scene would be the easy implementation
    // and the wrong one.
    expect(at('boneshaker', 'avalanche')).toEqual({
      remaining: ['avalanche'], ended: ['boneshaker'], strain: 2,
    });
  });

  it('charges nothing for Window, which bills per use instead', () => {
    // "Each time this is done in a scene, the user gains one System Strain" - so the
    // Strain follows the action, and ending the scene must not charge for a dose nobody
    // spent an action on.
    expect(at('window')).toEqual({ remaining: [], ended: ['window'], strain: 0 });
  });

  it('does nothing to a character on nothing', () => {
    expect(at()).toEqual({ remaining: [], ended: [], strain: 0 });
  });
});

describe('doses live in the inventory', () => {
  // A dose is a countable miscellaneous thing, which is exactly what the inventory is for.
  // Keeping quantities in a second place would be the same fact stored twice.
  const kit = (...rows: { name: string; qty: number; carry?: string }[]) => ({
    inventory: JSON.stringify(rows.map((r) => ({ carry: 'stowed', ...r }))),
  });

  it('counts what the character is carrying', () => {
    const doses = carriedDoses(kit({ name: 'Boneshaker', qty: 3 }) as never);
    expect(doses.get('boneshaker')).toBe(3);
  });

  it('matches however the row was written', () => {
    // A player types, and an importer writes whatever was on the form.
    for (const name of ['TRAUMA PATCH', 'trauma patch', 'Trauma-Patch']) {
      expect(carriedDoses(kit({ name, qty: 1 }) as never).get('trauma_patch')).toBe(1);
    }
  });

  it('adds up two rows of the same drug', () => {
    const doses = carriedDoses(kit(
      { name: 'Olympus', qty: 1 }, { name: 'Olympus', qty: 2 },
    ) as never);
    expect(doses.get('olympus')).toBe(3);
  });

  it('does not count a stashed dose, which is not on you', () => {
    const doses = carriedDoses(kit({ name: 'Boneshaker', qty: 5, carry: 'stash' }) as never);
    expect(doses.get('boneshaker')).toBeUndefined();
  });

  it('ignores rows that are not drugs', () => {
    expect(carriedDoses(kit({ name: 'Rope', qty: 1 }) as never).size).toBe(0);
  });

  it('spends one dose and leaves the rest', () => {
    const next = consumeDose(kit({ name: 'Boneshaker', qty: 3 }) as never, 'boneshaker');
    expect(next).toEqual([expect.objectContaining({ name: 'Boneshaker', qty: 2 })]);
  });

  it('drops the row when the last one is used', () => {
    // A row reading zero is not an item you have, and the inventory's normaliser would
    // read the zero back as a one anyway.
    const next = consumeDose(kit({ name: 'Olympus', qty: 1 }) as never, 'olympus');
    expect(next).toEqual([]);
  });

  it('leaves other rows untouched', () => {
    const next = consumeDose(
      kit({ name: 'Rope', qty: 1 }, { name: 'Olympus', qty: 2 }) as never, 'olympus',
    );
    expect(next!.map((i) => [i.name, i.qty])).toEqual([['Rope', 1], ['Olympus', 1]]);
  });

  it('says so when none is carried, rather than inventing one', () => {
    expect(consumeDose(kit({ name: 'Rope', qty: 1 }) as never, 'olympus')).toBeNull();
    expect(consumeDose({} as never, 'olympus')).toBeNull();
  });

  it('will not spend a stashed dose', () => {
    expect(consumeDose(kit({ name: 'Olympus', qty: 2, carry: 'stash' }) as never, 'olympus'))
      .toBeNull();
  });
});

describe('the line under a drug', () => {
  it('says the price, who can give it, and how long it lasts', () => {
    expect(describePharma(pharmaById('boneshaker')!)).toBe('$10 · anyone · one scene');
    expect(describePharma(pharmaById('avalanche')!)).toBe('$100 · Heal-0 · an hour');
  });

  it('flags the one you need a Contact for', () => {
    expect(describePharma(pharmaById('reset')!)).toContain('needs a Contact');
  });
});
