import { describe, it, expect } from 'vitest';
import {
  VEHICLE_FITTINGS, getFitting, describeFitting, fittingFitsVehicle, budgetFor, parseFittings,
} from '../vehicleFittings';

/** The fitting table, p.84. CC BY-NC 4.0 by 0frames. */

describe('vehicle fittings', () => {
  it('has all twenty-four', () => {
    expect(VEHICLE_FITTINGS).toHaveLength(24);
  });

  it('matches the book for a few rows', () => {
    expect(getFitting('extra_durability')).toMatchObject({ cost: 5000, power: 0, mass: 4, minSize: 'M' });
    expect(getFitting('ecm_emitter')).toMatchObject({ cost: 10000, power: 2, mass: 0, minSize: 'M' });
    // Cargo Space is the one the book prices as None.
    expect(getFitting('cargo_space')!.cost).toBe(0);
  });

  it('gives Power Systems a negative drain, since they supply it', () => {
    // The only entries that hand Power back. A consistent sign keeps the budget a sum
    // rather than two special cases.
    expect(getFitting('power_small')!.power).toBe(-2);
    expect(getFitting('power_medium')!.power).toBe(-4);
    expect(getFitting('power_large')!.power).toBe(-8);
    for (const f of VEHICLE_FITTINGS.filter(f => !f.id.startsWith('power_'))) {
      expect(f.power, `${f.label} should not supply power`).toBeGreaterThanOrEqual(0);
    }
  });

  it('flags the fitting whose cost the book gives two ways', () => {
    expect(getFitting('limpet_mount')!.note).toMatch(/10,000/);
  });

  it('gates by hull size', () => {
    const livingQuarters = getFitting('living_quarters')!; // L
    expect(fittingFitsVehicle(livingQuarters, 'L')).toBe(true);
    expect(fittingFitsVehicle(livingQuarters, 'M')).toBe(false);
    expect(fittingFitsVehicle(getFitting('cargo_space')!, 'S')).toBe(true);
    // An unset size should not filter everything out.
    expect(fittingFitsVehicle(livingQuarters, '')).toBe(true);
  });

  it('says what a chip costs, and nothing for a free one', () => {
    expect(describeFitting('ecm_emitter')).toBe('2pow');
    expect(describeFitting('extra_durability')).toBe('4mass');
    expect(describeFitting('medbay')).toBe('1pow 2mass');
    // A supplier reads as a gain, not a spend.
    expect(describeFitting('power_small')).toBe('+2pow 2mass');
  });
});

describe('the power and mass budget', () => {
  it('counts mounted weapons alongside fittings', () => {
    // The book is explicit that a hardpoint costs Power and Mass just as a fitting does,
    // so leaving weapons out would flatter every armed vehicle.
    const b = budgetFor(['medbay'], 1, 4, 3, 7); // Car: 3 power, 7 mass
    expect(b.spentPower).toBe(2);
    expect(b.spentMass).toBe(6);
    expect(b.powerLeft).toBe(1);
    expect(b.massLeft).toBe(1);
    expect(b.over).toBe(false);
  });

  it('notices an overloaded vehicle', () => {
    const b = budgetFor(['living_quarters', 'medbay'], 0, 0, 3, 5);
    expect(b.spentMass).toBe(6);
    expect(b.over).toBe(true);
  });

  it('lets a power system pay for the thing that needed it', () => {
    // 2 power of kit on a 1 power hull is over budget; a small power system covers it.
    expect(budgetFor(['ecm_emitter'], 0, 0, 1, 10).over).toBe(true);
    expect(budgetFor(['ecm_emitter', 'power_small'], 0, 0, 1, 10).over).toBe(false);
  });
});

describe('reading the stored list', () => {
  it('reads a JSON array of ids', () => {
    expect(parseFittings('["medbay","tool_rack"]')).toEqual(['medbay', 'tool_rack']);
  });

  it('treats anything unreadable as nothing installed', () => {
    // The field is hand-editable in the database and arrives over a socket.
    for (const raw of ['', '   ', 'not json', '{"a":1}', '[1,2]', null, undefined, 42]) {
      expect(parseFittings(raw as never)).toEqual([]);
    }
  });

  it('keeps duplicates, because two cargo holds are legitimate', () => {
    expect(parseFittings('["cargo_space","cargo_space"]')).toHaveLength(2);
  });
});
