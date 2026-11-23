import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { DrawPad } from '../DrawPad';
import { IconLook, Drawing } from '../IconLook';
import { BLANK_DRAWN, withSquare } from '../../sheets/drawings';

// The builder's 16 by 16 pad and a picture of any kind (8b0): shared by the dice's symbols and, next, the damage types.

afterEach(() => cleanup());
const UPLOAD = `/uploads/condition_icons/${'a'.repeat(64)}.png`;
const ONE = withSquare(BLANK_DRAWN, 2, 1, true);

describe('the pad', () => {
  it('a square drawn by keyboard is one edit; CLEAR empties it', () => {
    const onChange = vi.fn();
    render(<DrawPad drawn={BLANK_DRAWN} onChange={onChange} name="Fire" />);
    const pad = screen.getByRole('group', { name: 'Drawing of Fire' });
    expect(within(pad).getAllByRole('button')).toHaveLength(256);
    fireEvent.click(within(pad).getByRole('button', { name: 'Square 3, 2' }), { detail: 0 });
    expect(onChange).toHaveBeenLastCalledWith(ONE);
    fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
    expect(onChange).toHaveBeenLastCalledWith(BLANK_DRAWN);
  });

  it('shows what it is drawn for beside it, the rows drawn now; nothing of the dice\'s unless asked', () => {
    const preview = vi.fn((rows: string[]) => <span data-testid="preview">{rows[1]}</span>);
    render(<DrawPad drawn={ONE} onChange={() => {}} name="Fire" preview={preview} />);
    expect(screen.getByTestId('preview').textContent).toBe('2000');
    // Mid-stroke, before it is an edit: the preview follows the pen.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Square 1, 2' }));
    expect(screen.getByTestId('preview').textContent).toBe('a000');
    cleanup();
    render(<DrawPad drawn={ONE} onChange={() => {}} name="Fire" />);
    expect(screen.queryByText('ON A DIE')).toBeNull();
    expect(screen.getByRole('button', { name: 'Square 3, 2' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a picture of any kind', () => {
  it('a drawing as its squares; it wins over an icon', () => {
    const { container } = render(<IconLook drawn={ONE} icon="flame" />);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
    expect(['x', 'y', 'width', 'height'].map((a) => container.querySelector('rect')!.getAttribute(a))).toEqual(['2', '1', '1', '1']);
    cleanup();
    const { container: d } = render(<Drawing drawn={withSquare(ONE, 0, 0, true)} size={24} />);
    expect(d.querySelectorAll('rect')).toHaveLength(2);
    expect(d.querySelector('svg')!.getAttribute('width')).toBe('24');
  });

  it('an icon drawn or uploaded, named; neither, what it falls back to', () => {
    const { container } = render(<IconLook icon="flame" title="Fire" />);
    expect(container.querySelector('svg path')).not.toBeNull();
    expect(container.querySelector('rect')).toBeNull();
    cleanup();
    render(<IconLook icon={UPLOAD} title="Fire" />);
    expect(screen.getByRole('img', { name: 'Fire' }).getAttribute('src')).toBe(UPLOAD);
    cleanup();
    render(<IconLook fallback={<span>F</span>} />);
    expect(screen.getByText('F')).toBeTruthy();
  });
});
