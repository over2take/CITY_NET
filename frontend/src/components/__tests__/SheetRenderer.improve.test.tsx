// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { templateFromRender, type CustomRender } from '../../sheets/customTemplates';
import type { ImproveShown } from '../../sheets/improveShown';

/**
 * IMPROVE BY USE's marks on the sheet (7f3b): a mark beside each stat that improves, filled once marked, ticked or cleared
 * with a click that asks the server; none on a stat that doesn't improve; where the sheet can't be changed, only a mark
 * that is on; and the template carrying it from the server's render.
 */

const IMPROVE: ImproveShown = { stats: [{ id: 'lore', label: 'Lore' }, { id: 'spot', label: 'Spot' }], marked: 'success', at: { id: 'end_of_session', name: 'End of session' } };
const RENDER = {
  id: 'sys_0000000000000ibu', name: 'Used', words: {}, parts: {}, derived: [],
  sheet: { tabs: ['STATS'], sections: [{ id: 'skills', label: 'SKILLS', layout: 'grid', tab: 'STATS', fields: [
    { id: 'lore', label: 'Lore', type: 'number' }, { id: 'spot', label: 'Spot', type: 'number' }, { id: 'str', label: 'Strength', type: 'number' },
  ] }] },
  improve: IMPROVE,
} as unknown as CustomRender;
const DATA = { lore: 40, spot: 30, str: 10, _marks: { lore: true } };

afterEach(cleanup);

describe('IMPROVE BY USE on the sheet', () => {
  it('the template carries it from the server; none where stats don\'t improve', () => {
    expect(templateFromRender(RENDER).improve).toEqual(IMPROVE);
    expect(templateFromRender({ ...RENDER, improve: null } as unknown as CustomRender)).not.toHaveProperty('improve');
  });

  it('a mark beside each stat that improves, filled once marked; a click asks the server', async () => {
    const onImprove = vi.fn();
    render(<SheetRenderer template={templateFromRender(RENDER)} data={DATA as never} readOnly={false} onFieldChange={() => {}} onImprove={onImprove} />);
    const lore = screen.getByRole('button', { name: 'Lore marked' });
    expect(lore.getAttribute('aria-pressed')).toBe('true');
    expect(lore.getAttribute('title')).toBe('MARKED: it rolls to improve at END OF SESSION. Click to clear.');
    expect(screen.getByRole('button', { name: 'Spot marked' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Strength marked' })).toBeNull();
    await userEvent.click(lore);
    await userEvent.click(screen.getByRole('button', { name: 'Spot marked' }));
    expect(onImprove.mock.calls.map((c) => c[0])).toEqual([{ kind: 'mark', stat: 'lore', on: false }, { kind: 'mark', stat: 'spot', on: true }]);
  });

  it('where it can\'t be changed, only a mark that is on, and it can\'t be clicked', () => {
    render(<SheetRenderer template={templateFromRender(RENDER)} data={DATA as never} readOnly onFieldChange={() => {}} onImprove={vi.fn()} />);
    const lore = screen.getByRole('button', { name: 'Lore marked' }) as HTMLButtonElement;
    expect(lore.disabled).toBe(true);
    expect(lore.getAttribute('title')).toBe('MARKED: it rolls to improve at END OF SESSION.');
    expect(screen.queryByRole('button', { name: 'Spot marked' })).toBeNull();
  });

  it('no marks at all where stats don\'t improve by use', () => {
    render(<SheetRenderer template={templateFromRender({ ...RENDER, improve: null } as unknown as CustomRender)} data={DATA as never} readOnly={false} onFieldChange={() => {}} onImprove={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /marked$/ })).toBeNull();
  });
});
