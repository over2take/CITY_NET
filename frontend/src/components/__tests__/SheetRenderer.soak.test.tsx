import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import { cyberpunkRed } from '../../sheets/templates/cyberpunk_red';
import { shadowrun6e } from '../../sheets/templates/shadowrun_6e';
import { generic } from '../../sheets/templates/generic';

/**
 * Damage Soak refills all at once, so it gets a button rather than arithmetic.
 *
 * The server spends the pool on every hit and writes what is left back to the sheet. What
 * it cannot know is when a scene ends — that is a call at the table. So the way back to
 * full is one click, the same shape as CLEAR FRAIL: the game decides, the sheet obeys.
 */

const combat = citiesWithoutNumber.sections.find(s => s.id === 'combat')!;

const renderCombat = (data: Record<string, unknown>, onFieldChange = vi.fn(), readOnly = false) => {
  render(
    <SheetRenderer
      template={{ ...citiesWithoutNumber, tabs: ['COMBAT'], sections: [{ ...combat, tab: 'COMBAT' }] }}
      data={data as never}
      readOnly={readOnly}
      onFieldChange={onFieldChange}
    />
  );
  return onFieldChange;
};

describe('the soak refill button', () => {
  it('puts the pool back to the armor rating', async () => {
    // Refills to the modded total, not the printed number: Absorption Pads are five more
    // points of soak per fight, and refilling to the bare armor value would drop them.
    const onFieldChange = renderCombat({ soak_current: 2, armor_soak: 5, armor_soak_total: 10 });
    await userEvent.click(screen.getByRole('button', { name: 'REFILL' }));
    expect(onFieldChange).toHaveBeenCalledWith('soak_current', 10);
  });

  it('refills from an armor rating the wearer has not set yet', async () => {
    // No armor block filled in: the button is honest about it rather than guessing.
    const onFieldChange = renderCombat({ soak_current: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'REFILL' }));
    expect(onFieldChange).toHaveBeenCalledWith('soak_current', 0);
  });

  it('does not fire on a sheet the viewer cannot edit', async () => {
    const onFieldChange = renderCombat({ soak_current: 2, armor_soak_total: 10 }, vi.fn(), true);
    const button = screen.getByRole('button', { name: 'REFILL' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('leaves the other fields in the block alone', () => {
    // One button, on one field. STRAIN is a pool too and recovers 1 per rest, not all at
    // once, so it must not have picked the button up.
    renderCombat({ soak_current: 2, armor_soak_total: 10, system_strain: 3, system_strain_max: 12 });
    expect(screen.getAllByRole('button', { name: 'REFILL' })).toHaveLength(1);
  });
});

describe('refill is offered nowhere else', () => {
  const fieldsOf = (t: typeof citiesWithoutNumber) => t.sections.flatMap((s) => s.fields ?? []);

  it('is on the CWN sheet for Soak alone', () => {
    const refillable = fieldsOf(citiesWithoutNumber).filter((f) => f.refillFrom);
    expect(refillable.map((f) => f.id)).toEqual(['soak_current']);
    expect(refillable[0].refillFrom).toBe('armor_soak_total');
  });

  it('is on no other system sheet', () => {
    for (const t of [cyberpunkRed, shadowrun6e, generic]) {
      expect(fieldsOf(t).filter((f) => f.refillFrom)).toHaveLength(0);
    }
  });

  it('is the only pool whose maximum lives in another block', () => {
    // The renderer looks a `maxField` up across the whole sheet so SOAK, spent in COMBAT
    // and set in ARMOR, still renders as CUR / MAX. Every other pair is inside one block,
    // where the narrower lookup and the wider one agree. A new cross-block pair should be
    // a decision someone made, not one this test let through.
    const crossBlock = ([citiesWithoutNumber, cyberpunkRed, shadowrun6e, generic] as const)
      .flatMap((t) => t.sections.flatMap((s) => {
        const here = new Set((s.fields ?? []).map((f) => f.id));
        return (s.fields ?? [])
          .filter((f) => f.maxField && !here.has(f.maxField))
          .map((f) => `${f.id} -> ${f.maxField}`);
      }));
    expect(crossBlock).toEqual(['soak_current -> armor_soak_total']);
  });

  it('points at a field that exists', () => {
    // A typo here would render a button that quietly refills to zero.
    const ids = new Set(fieldsOf(citiesWithoutNumber).map((f) => f.id));
    for (const f of fieldsOf(citiesWithoutNumber)) {
      if (f.refillFrom) expect(ids.has(f.refillFrom)).toBe(true);
    }
  });
});
