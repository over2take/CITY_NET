import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFormulaBox } from '../useFormulaBox';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import type { FormulaKind, FormulaRead } from '../../sheets/formulaBox';

/**
 * The formula box (formula box 1; approved mockup docs/mockups/formula-box.html, 2026-10-29): the
 * words line under it with the server's sample value, a mistake in red with USE @name, an answer
 * for older text never shown; the FORMULA button alone opening SHAPE and INSERT; a shape writing
 * the formula; INSERT putting a name at the cursor.
 */
const DEF = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [] }] }],
} as unknown as Definition;

const apiAnswering = (answer: (text: string) => FormulaRead) => ({
  previewFormulas: vi.fn(async (_d: Definition, formulas: { text: string }[]) => ({ ok: true, value: { results: formulas.map((f) => answer(f.text)), sampleLevel: 3 } })),
}) as unknown as ReturnType<typeof systemsApi> & { previewFormulas: ReturnType<typeof vi.fn> };

function Harness({ kind = 'amount', start = '', api, roll }: { kind?: FormulaKind; start?: string; api?: ReturnType<typeof systemsApi>; roll?: string }) {
  const [text, setText] = useState(start);
  const box = useFormulaBox({ definition: DEF, api, kind, roll, value: text, onChange: setText, label: 'Modifier 1: by', inputStyle: {} });
  return <div>{box.field}{box.help}</div>;
}
const textbox = () => screen.getByRole('textbox', { name: 'Modifier 1: by' }) as HTMLInputElement;
const words = () => screen.getByTestId('formula-words');

describe('the formula box', () => {
  it('says it in words, then what the server makes of it for the sample', async () => {
    const api = apiAnswering(() => ({ ok: true, value: 6, reads: [{ id: 'level', label: 'Level', value: 3 }] }));
    render(<Harness start="2 * @level" api={api} />);
    expect(words().textContent).toBe('+2 for each level');
    await waitFor(() => expect(words().textContent).toBe('+2 for each level · sample Level 3: +6'));
    expect(api.previewFormulas).toHaveBeenCalledWith(DEF, [{ text: '2 * @level', kind: 'amount' }]);
  });

  it('says nothing under an empty box, and asks the server nothing', async () => {
    const api = apiAnswering(() => ({ ok: true, value: 0, reads: [] }));
    render(<Harness api={api} />);
    expect(screen.queryByTestId('formula-words')).toBeNull();
    await new Promise((r) => setTimeout(r, 450));
    expect(api.previewFormulas).not.toHaveBeenCalled();
  });

  it('shows a mistake in red, the box marked, and USE @name fixes it', async () => {
    const api = apiAnswering((text) => (text.includes('@lvl')
      ? { ok: false, problem: "@lvl isn't one of this system's names", name: 'lvl', suggest: 'level' }
      : { ok: true, value: 6, reads: [{ id: 'level', label: 'Level', value: 3 }] }));
    render(<Harness start="2 * @lvl" api={api} />);
    await waitFor(() => expect(words().textContent).toContain("@lvl isn't one of this system's names"));
    expect(textbox().getAttribute('aria-invalid')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'USE @level' }));
    expect(textbox().value).toBe('2 * @level');
    await waitFor(() => expect(words().textContent).toBe('+2 for each level · sample Level 3: +6'));
    expect(textbox().hasAttribute('aria-invalid')).toBe(false);
  });

  it('never shows an answer for text that has since changed', async () => {
    const api = apiAnswering(() => ({ ok: true, value: 99, reads: [] }));
    render(<Harness start="99" api={api} />);
    await waitFor(() => expect(words().textContent).toBe('+99, always · +99'));
    fireEvent.change(textbox(), { target: { value: '5' } });
    expect(words().textContent).toBe('+5, always');
  });

  it('opens SHAPE and INSERT only by the FORMULA button, which says it is open', async () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Help writing Modifier 1: by' });
    await userEvent.click(textbox());
    expect(screen.queryByRole('group', { name: 'Help writing Modifier 1: by' })).toBeNull();
    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const help = screen.getByRole('group', { name: 'Help writing Modifier 1: by' });
    expect(within(help).getByText('SHAPE')).toBeTruthy();
    expect(within(help).getByText('LEVELS')).toBeTruthy();
    await userEvent.click(button);
    expect(screen.queryByRole('group', { name: 'Help writing Modifier 1: by' })).toBeNull();
  });

  it('writes a shape, and rewrites it as its number changes', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Help writing Modifier 1: by' }));
    await userEvent.click(screen.getByRole('button', { name: 'PER LEVEL' }));
    expect(textbox().value).toBe('2 * @level');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'How many' }), { target: { value: '3' } });
    expect(textbox().value).toBe('3 * @level');
    await userEvent.click(screen.getByRole('button', { name: 'PER CLASS LEVEL' }));
    expect(textbox().value).toBe('2 * @classes_level');
    fireEvent.change(screen.getByRole('combobox', { name: 'Which level' }), { target: { value: '@fighter_level' } });
    expect(textbox().value).toBe('2 * @fighter_level');
    await userEvent.click(screen.getByRole('button', { name: 'HALF LEVEL' }));
    expect(textbox().value).toBe('floor(@level / 2)');
    expect(screen.queryByRole('spinbutton', { name: 'How many' })).toBeNull();
  });

  it('writes a requirement on a stat', async () => {
    render(<Harness kind="requires" />);
    await userEvent.click(screen.getByRole('button', { name: 'Help writing Modifier 1: by' }));
    await userEvent.click(screen.getByRole('button', { name: 'AT LEAST' }));
    expect(textbox().value).toBe('@str >= 13');
    expect(screen.queryByRole('button', { name: 'PER LEVEL' })).toBeNull();
  });

  it('puts an INSERT name at the cursor', async () => {
    render(<Harness start="2 *  + 1" />);
    textbox().setSelectionRange(4, 4);
    fireEvent.select(textbox());
    await userEvent.click(screen.getByRole('button', { name: 'Help writing Modifier 1: by' }));
    await userEvent.click(screen.getByRole('button', { name: /^@fighter_level/ }));
    expect(textbox().value).toBe('2 * @fighter_level + 1');
    expect(textbox().selectionStart).toBe(18);
  });
});

describe('on a roll and a rest (formula box 2)', () => {
  it('names its roll to the server, which says the stat the sample rolls', async () => {
    const api = apiAnswering(() => ({ ok: true, value: 13, reads: [{ id: 'this', label: 'rolled stat', value: 13 }], rolling: 'Strength' }));
    render(<Harness kind="against" start="@this" roll="save" api={api} />);
    await waitFor(() => expect(words().textContent).toBe('against your rolled stat · sample, rolling Strength, rolled stat 13: target 13'));
    expect(api.previewFormulas).toHaveBeenCalledWith(DEF, [{ text: '@this', kind: 'against', roll: 'save' }]);
  });

  it('AGAINST\'s A NUMBER starts at 13; THE STAT ROLLED writes @this', async () => {
    render(<Harness kind="against" />);
    await userEvent.click(screen.getByRole('button', { name: 'Help writing Modifier 1: by' }));
    const help = within(screen.getByRole('group', { name: 'Help writing Modifier 1: by' }));
    await userEvent.click(help.getByRole('button', { name: 'A NUMBER' }));
    expect(textbox().value).toBe('13');
    expect(help.getByText(/AGAINST/)).toBeTruthy();
    await userEvent.click(help.getByRole('button', { name: 'THE STAT ROLLED' }));
    expect(textbox().value).toBe('@this');
  });

  it('a rest\'s DICE and DICE AND A STAT, with how many, which die and which stat or formula', async () => {
    const def = { ...DEF, derived: [{ id: 'con_mod', label: 'CON modifier', formula: '1' }] } as unknown as Definition;
    function Rest() {
      const [text, setText] = useState('');
      const box = useFormulaBox({ definition: def, kind: 'refill', value: text, onChange: setText, label: 'Modifier 1: by', inputStyle: {}, maxLength: 200 });
      return <div>{box.field}{box.help}</div>;
    }
    render(<Rest />);
    expect(textbox().maxLength).toBe(200);
    await userEvent.click(screen.getByRole('button', { name: 'Help writing Modifier 1: by' }));
    const help = within(screen.getByRole('group', { name: 'Help writing Modifier 1: by' }));
    await userEvent.click(help.getByRole('button', { name: 'DICE' }));
    expect(textbox().value).toBe('1d8');
    fireEvent.change(help.getByRole('spinbutton', { name: 'How many' }), { target: { value: '2' } });
    await userEvent.selectOptions(help.getByRole('combobox', { name: 'Which die' }), 'D6');
    expect(textbox().value).toBe('2d6');
    await userEvent.click(help.getByRole('button', { name: 'DICE AND A STAT' }));
    expect(textbox().value).toBe('1d8 + @str');
    await userEvent.selectOptions(help.getByRole('combobox', { name: 'Which' }), 'CON MODIFIER');
    expect(textbox().value).toBe('1d8 + @con_mod');
    expect(words().textContent).toBe('1d8 + con_mod');
  });
});
