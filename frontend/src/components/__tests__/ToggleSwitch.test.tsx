import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleSwitch } from '../ToggleSwitch';

/**
 * The one on/off switch (switches 1; approved mockup docs/mockups/toggle-switch.html, 2026-10-29): a
 * switch to assistive tech, named by its label or, with the words elsewhere, by `name`; the whole of
 * it one button that says what it becomes; the knob across and lit when on; nothing when disabled.
 */
describe('ToggleSwitch', () => {
  const knobOf = (sw: HTMLElement) => sw.querySelector('[data-toggle-track] > span') as HTMLElement;

  it('is a switch named by its label, saying whether it is on', () => {
    render(<ToggleSwitch label="LEVELLED" on onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'LEVELLED' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.hasAttribute('aria-label')).toBe(false);
  });

  it('takes its name from `name` when the words are elsewhere, and shows none', () => {
    render(<ToggleSwitch name="Short rest on" on={false} onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'Short rest on' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toBe('');
  });

  it('says what it becomes when clicked, the label included', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ToggleSwitch label="HAS USES" on={false} onChange={onChange} />);
    await userEvent.click(screen.getByText('HAS USES'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<ToggleSwitch label="HAS USES" on onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('slides the knob across and lights it when on', () => {
    const { rerender } = render(<ToggleSwitch label="X" on={false} onChange={() => {}} />);
    const off = knobOf(screen.getByRole('switch'));
    expect(off.style.left).toBe('2px');
    expect(off.style.background).toContain('color-mix');
    rerender(<ToggleSwitch label="X" on onChange={() => {}} />);
    const on = knobOf(screen.getByRole('switch'));
    expect(on.style.left).toBe('18px');
    expect(on.style.background).toBe('var(--cyan)');
  });

  it('draws in the color it is given, a theme variable', () => {
    render(<ToggleSwitch label="HURT" on color="var(--warning)" onChange={() => {}} />);
    const sw = screen.getByRole('switch');
    expect(sw.style.color).toBe('var(--warning)');
    expect(knobOf(sw).style.background).toBe('var(--warning)');
  });

  it('passes a button\'s own attributes through, but never its role or state', () => {
    render(<ToggleSwitch label="ANIMATION" on title="ANIMATION ON" className="win95-title-toggle" data-browse
      {...({ role: 'checkbox', 'aria-checked': false } as object)} onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'ANIMATION' });
    expect(sw.title).toBe('ANIMATION ON');
    expect(sw.className).toBe('win95-title-toggle');
    expect(sw.hasAttribute('data-browse')).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('lets a click be seen first, then says what it becomes (the graph keeps it off the map)', async () => {
    const seen: string[] = [];
    const outside = vi.fn();
    render(<div onClick={outside}><ToggleSwitch label="TRY" on={false} onClick={(e) => { e.stopPropagation(); seen.push('click'); }}
      onChange={(next) => seen.push(`change ${next}`)} /></div>);
    await userEvent.click(screen.getByRole('switch'));
    expect(seen).toEqual(['click', 'change true']);
    expect(outside).not.toHaveBeenCalled();
  });

  it('does nothing while disabled, and looks it', async () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="MORE THAN ONCE" on={false} disabled onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'MORE THAN ONCE' });
    await userEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    expect(sw).toHaveProperty('disabled', true);
    expect(sw.style.opacity).toBe('0.4');
  });
});
