import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';

import { OnlyWith } from '../OnlyWith';
import { HINTS } from '../../sheets/builderHelp';
import type { Definition } from '../../sheets/systemsApi';

/**
 * ONLY WITH (4j4a; approved mockup docs/mockups/optional-rules.html, 2026-10-14): the house rule a
 * part, a sheet section or a condition waits on, picked where it lives.
 */

afterEach(() => cleanup());

const RULED = { format: 1, name: 'Hearth', house_rules: [{ id: 'magic', name: 'magic' }, { id: 'gritty', name: '' }] } as unknown as Definition;
const draw = (definition: Definition, value?: string) => {
  const onChange = vi.fn();
  render(<div><OnlyWith definition={definition} value={value} onChange={onChange} /></div>);
  return onChange;
};

describe('ONLY WITH', () => {
  it('offers always and each house rule by name, its "?" beside it', () => {
    draw(RULED);
    const box = screen.getByRole('combobox', { name: 'ONLY WITH' }) as HTMLSelectElement;
    expect(within(box).getAllByRole('option').map((o) => o.textContent)).toEqual(['— always —', 'MAGIC', 'GRITTY']);
    expect(box.value).toBe('');
    expect(screen.getByRole('note', { name: HINTS['only.with'] })).toBeTruthy();
  });

  it('picks a rule, or none for always', () => {
    const onChange = draw(RULED, 'magic');
    const box = screen.getByRole('combobox', { name: 'ONLY WITH' }) as HTMLSelectElement;
    expect(box.value).toBe('magic');
    fireEvent.change(box, { target: { value: 'gritty' } });
    fireEvent.change(box, { target: { value: '' } });
    expect(onChange.mock.calls).toEqual([['gritty'], [null]]);
  });

  it('shows nothing in a system with no house rules', () => {
    draw({ format: 1, name: 'Hearth' } as Definition);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('still shows one naming a rule since deleted, GONE, to clear', () => {
    const onChange = draw({ format: 1, name: 'Hearth' } as Definition, 'magic');
    const box = screen.getByRole('combobox', { name: 'ONLY WITH' }) as HTMLSelectElement;
    expect(within(box).getAllByRole('option').map((o) => o.textContent)).toEqual(['— always —', 'MAGIC (GONE)']);
    fireEvent.change(box, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
