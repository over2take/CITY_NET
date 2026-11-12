import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SheetRenderer } from '../SheetRenderer';
import { templateFromRender } from '../../sheets/customTemplates';

/**
 * A ranked stat on the sheet (7f1c1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): the server draws it as a
 * select on its step with the ranks by name (backend ranks.js withRankFields); the sheet shows its worth beside it, starts
 * it at the lowest rather than a blank, and saves the step picked.
 */

afterEach(() => cleanup());

const RENDER = {
  id: 'sys_aaaaaaaaaaaaaaaa', name: 'Hearth', derived: [], parts: {}, words: {},
  sheet: { sections: [{ id: 'skills', label: 'SKILLS', layout: 'list', fields: [
    { id: 'athletics_rank', label: 'Athletics', type: 'select', worthField: 'athletics',
      options: [{ value: '0', label: 'UNTRAINED' }, { value: '1', label: 'TRAINED' }, { value: '2', label: 'EXPERT' }] },
    { id: 'mood', label: 'Mood', type: 'select', options: [{ value: 'calm', label: 'CALM' }] },
  ] }] },
};

const draw = (data: Record<string, unknown>) => {
  const onFieldChange = vi.fn();
  render(<SheetRenderer template={templateFromRender(RENDER as never)} data={data as never} readOnly={false} onFieldChange={onFieldChange} />);
  return onFieldChange;
};

describe('the rank picker', () => {
  it('the rank by name with its worth beside it; picked, its step saved', () => {
    const onFieldChange = draw({ athletics_rank: '2', athletics: 7 });
    const pick = screen.getByRole('combobox', { name: 'Athletics' }) as HTMLSelectElement;
    expect(pick.value).toBe('2');
    expect([...pick.options].map((o) => o.textContent)).toEqual(['UNTRAINED', 'TRAINED', 'EXPERT']);
    expect(screen.getByTestId('worth-athletics').textContent).toBe('= 7');
    fireEvent.change(pick, { target: { value: '1' } });
    expect(onFieldChange).toHaveBeenCalledWith('athletics_rank', '1');
  });

  it('no step yet: its lowest, no blank to pick, a worth of 0; any other select keeps its blank', () => {
    draw({});
    expect([...(screen.getByRole('combobox', { name: 'Athletics' }) as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['UNTRAINED', 'TRAINED', 'EXPERT']);
    expect(screen.getByTestId('worth-athletics').textContent).toBe('= 0');
    expect([...(screen.getByRole('combobox', { name: 'Mood' }) as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['—', 'CALM']);
    // Only the ranked stat has a worth beside it.
    expect(screen.getAllByTestId(/^worth-/).map((w) => w.getAttribute('data-testid'))).toEqual(['worth-athletics']);
  });
});
