/**
 * The shared terminal layout, for the parts the building window does not already exercise:
 * a window with one folder, arrow keys while a field has focus, and buttons that are
 * disabled or dangerous.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalWindow, useFolder, type TerminalFolder, type TerminalAction } from '../TerminalWindow';

function Harness({ folders, actions = [], resetKey = 1 }: { folders: TerminalFolder[]; actions?: TerminalAction[]; resetKey?: number }) {
  const [open, setOpen] = useFolder(folders, resetKey);
  const [text, setText] = useState('');
  return (
    <TerminalWindow title="TEST" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
      folders={folders} open={open} onOpen={setOpen} actions={actions} panelMode="controls">
      <span>open: {open}</span>
      <input aria-label="field" value={text} onChange={(e) => setText(e.target.value)} />
    </TerminalWindow>
  );
}

const TWO: TerminalFolder[] = [{ id: 'a', label: 'ALPHA' }, { id: 'b', label: 'BETA' }];
const keys = (k: string) => fireEvent.keyDown(screen.getByLabelText('TEST information'), { key: k });

describe('folders', () => {
  it('opens the first, and walks with the arrow keys', () => {
    render(<Harness folders={TWO} />);
    expect(screen.getByText('open: a')).toBeInTheDocument();
    keys('ArrowDown');
    expect(screen.getByText('open: b')).toBeInTheDocument();
  });

  it('leaves the arrows to a text field that has focus', () => {
    render(<Harness folders={TWO} />);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'ArrowDown' });
    expect(screen.getByText('open: a')).toBeInTheDocument();
  });

  it('shows no key hint when there is nothing to move between', () => {
    render(<Harness folders={[{ id: 'only', label: 'ONLY' }]} />);
    expect(screen.queryByText('UP, DOWN: select folder')).toBeNull();
    keys('ArrowDown');
    expect(screen.getByText('open: only')).toBeInTheDocument();
  });

  it('falls back to the first folder when the open one disappears', () => {
    const { rerender } = render(<Harness folders={TWO} />);
    keys('ArrowDown');
    rerender(<Harness folders={[TWO[0]]} />);
    expect(screen.getByText('open: a')).toBeInTheDocument();
  });

  it('starts over when the subject changes', () => {
    const { rerender } = render(<Harness folders={TWO} resetKey={1} />);
    keys('ArrowDown');
    rerender(<Harness folders={TWO} resetKey={2} />);
    expect(screen.getByText('open: a')).toBeInTheDocument();
  });
});

describe('buttons', () => {
  it('can be disabled, and a dangerous one looks it', () => {
    const purge = vi.fn();
    render(<Harness folders={TWO} actions={[
      { key: 'x', label: 'LOCKED', onClick: vi.fn(), disabled: true },
      { key: 'p', label: 'PURGE', onClick: purge, tone: 'danger' },
    ]} />);
    expect(screen.getByRole('button', { name: 'LOCKED' })).toBeDisabled();
    const btn = screen.getByRole('button', { name: 'PURGE' });
    expect(btn.style.color).toBe('var(--danger)');
    fireEvent.click(btn);
    expect(purge).toHaveBeenCalledOnce();
  });
});
