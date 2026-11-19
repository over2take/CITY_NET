import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SheetRenderer } from '../SheetRenderer';

/**
 * A condition's change under the number it changes (8a5e3; approved mockup docs/mockups/condition-modifiers.html, 2026-11-18;
 * the user: "we just need to show the effect SLOWED: Speed ×0.5 and update the movement/speed on the sheet"): the number
 * changed, and the condition said under it, on a stat's box and a skill's line alike.
 */

afterEach(cleanup);

const template = {
  id: 'sys_x', name: 'Slow', items: { list: [] },
  sections: [
    { id: 'stats', label: 'STATS', layout: 'grid', fields: [{ id: 'speed', label: 'Speed', type: 'number' }, { id: 'might', label: 'Might', type: 'number' }] },
    { id: 'skills', label: 'SKILLS', layout: 'skills', fields: [{ id: 'climb', label: 'Climb', type: 'number' }] },
  ],
} as never;
const worked = (from: object) => ({ _worked: { picks: [], levels: {}, from, uses: {}, unmet: [] } });

describe('a condition on the token, on the sheet', () => {
  it('the changed number as the big one, SLOWED: Speed ×0.5 and what is typed under it; a stat it doesn\'t touch says nothing', () => {
    render(<SheetRenderer template={template} onFieldChange={() => {}}
      data={{ speed: 30, might: 12, climb: 4, ...worked({
        speed: [{ feature: 'Ring of Striding', amount: 5 }, { feature: 'Slowed', amount: 0.5, got: -18, condition: true, way: 'times' }],
        climb: [{ feature: 'Slowed', amount: -2, condition: true }],
      }) } as never} />);
    const note = screen.getByRole('note', { name: 'Conditions on Speed' });
    expect(note.textContent).toBe('SLOWED: Speed ×0.5 · typed 30');
    // The changed number is the big one (the user's pick, 2026-11-19), no badge beside the name.
    expect(screen.getByRole('button', { name: 'Speed 17, changed by a condition: edit what is typed' }).textContent).toBe('17');
    // The small badge (its "30 → 17" tooltip) is gone from the box.
    expect(note.parentElement!.querySelector('[title*="→"]')).toBeNull();
    expect(screen.queryByRole('note', { name: 'Conditions on Might' })).toBeNull();
    // A skill's line says it too.
    expect(screen.getByRole('note', { name: 'Conditions on Climb' }).textContent).toBe('SLOWED: Climb −2');
  });

  it('two on one number each said; in a system with no picks or items too', () => {
    const bare = { ...(template as object), items: undefined } as never;
    render(<SheetRenderer template={bare} onFieldChange={() => {}}
      data={{ speed: 30, ...worked({ speed: [
        { feature: 'Slowed', amount: 0.5, got: -15, condition: true, way: 'times' }, { feature: 'Weary', amount: 10, got: -5, condition: true, way: 'most' },
      ] }) } as never} />);
    expect(screen.getByRole('note', { name: 'Conditions on Speed' }).textContent).toBe('SLOWED: Speed ×0.5 · WEARY: Speed at most 10 · typed 30');
  });

  it('clicked, what is typed opens to edit, written as typed; it goes back once it loses focus; read only, it stays a number', () => {
    const typed: [string, unknown][] = [];
    const data = { speed: 30, ...worked({ speed: [{ feature: 'Slowed', amount: 0.5, got: -15, condition: true, way: 'times' }] }) } as never;
    const { unmount } = render(<SheetRenderer template={template} onFieldChange={(id, v) => typed.push([id, v])} data={data} />);
    fireEvent.click(screen.getByRole('button', { name: /^Speed 15, changed by a condition/ }));
    const box = screen.getByRole('spinbutton', { name: 'Speed' }) as HTMLInputElement;
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('30');
    fireEvent.change(box, { target: { value: '40' } });
    expect(typed.at(-1)).toEqual(['speed', 40]);
    fireEvent.blur(box);
    expect(screen.getByRole('button', { name: /^Speed 15/ })).toBeTruthy();
    unmount();
    render(<SheetRenderer template={template} onFieldChange={() => {}} readOnly data={data} />);
    expect((screen.getByRole('button', { name: 'Speed 15, changed by a condition' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('none on the token: no note at all', () => {
    render(<SheetRenderer template={template} onFieldChange={() => {}} data={{ speed: 30, ...worked({ speed: [{ feature: 'Ring of Striding', amount: 5 }] }) } as never} />);
    expect(screen.queryByRole('note', { name: /^Conditions on/ })).toBeNull();
  });
});
