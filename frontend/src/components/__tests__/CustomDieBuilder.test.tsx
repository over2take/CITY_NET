import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title, onClose }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      <button onClick={onClose}>close</button>
      {children}
    </div>
  ),
}));

import { CustomDieBuilder } from '../CustomDieBuilder';
import type { CustomDie } from '../../types';

const PUNK: CustomDie = {
  id: 1, name: 'punk', sides: 4,
  faces: [{ value: 'apple' }, { value: 'bannana' }, { value: 'oragne' }, { value: 'peach' }],
};

const FATE: CustomDie = {
  id: 2, name: 'Fate', sides: 6,
  faces: [{ value: '+1' }, { value: '+1' }, { value: '-1' }, { value: '-1' }, { value: '0' }, { value: '0' }],
};

const basePos = { x: 0, y: 0 };
const noop = () => {};

const renderBuilder = (props: Partial<React.ComponentProps<typeof CustomDieBuilder>> = {}) =>
  render(
    <CustomDieBuilder
      pos={basePos}
      setPos={noop}
      onClose={vi.fn()}
      onCreate={vi.fn().mockResolvedValue(true)}
      onUpdate={vi.fn().mockResolvedValue(true)}
      existingDice={[PUNK, FATE]}
      {...props}
    />
  );

const faceInputs = () => screen.getAllByPlaceholderText('value or symbol') as HTMLInputElement[];
const nameInput = () => screen.getByPlaceholderText('die name') as HTMLInputElement;

beforeEach(() => vi.clearAllMocks());

// ─── Create mode ──────────────────────────────────────────────────────────────

describe('CustomDieBuilder — create mode', () => {
  it('opens blank with no face rows until sides are set', () => {
    renderBuilder();
    expect(nameInput().value).toBe('');
    expect(screen.queryAllByPlaceholderText('value or symbol')).toHaveLength(0);
  });

  it('titles the window CUSTOM_DIE.EXE', () => {
    renderBuilder();
    expect(screen.getByTestId('window-title').textContent).toBe('CUSTOM_DIE.EXE');
  });

  it('generates one face row per side after SET', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.type(screen.getByPlaceholderText('##'), '4');
    await user.click(screen.getByText('SET'));
    expect(faceInputs()).toHaveLength(4);
  });
});

// ─── Edit mode ────────────────────────────────────────────────────────────────

describe('CustomDieBuilder — edit mode', () => {
  it('prefills name, sides and every face from the die', () => {
    renderBuilder({ editingDie: PUNK });
    expect(nameInput().value).toBe('punk');
    expect((screen.getByPlaceholderText('##') as HTMLInputElement).value).toBe('4');
    expect(faceInputs().map(i => i.value)).toEqual(['apple', 'bannana', 'oragne', 'peach']);
  });

  it('marks the window as editing', () => {
    renderBuilder({ editingDie: PUNK });
    expect(screen.getByTestId('window-title').textContent).toBe('CUSTOM_DIE.EXE — EDIT');
  });

  it('labels the action SAVE rather than CREATE', () => {
    renderBuilder({ editingDie: PUNK });
    expect(screen.getByText('SAVE')).toBeInTheDocument();
  });

  it('lets a die keep its own name without a clash error', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderBuilder({ editingDie: PUNK, onUpdate });
    await user.click(screen.getByText('SAVE'));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'punk' }));
  });

  it('blocks taking a name another die already holds', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderBuilder({ editingDie: PUNK, onUpdate });
    await user.clear(nameInput());
    await user.type(nameInput(), 'Fate');
    await user.click(screen.getByText('SAVE'));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/already in use/i)).toBeInTheDocument();
  });

  it('blocks a name reserved by a standard die', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderBuilder({ editingDie: PUNK, onUpdate });
    await user.clear(nameInput());
    await user.type(nameInput(), 'd20');
    await user.click(screen.getByText('SAVE'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps entered face values when the side count grows', async () => {
    const user = userEvent.setup();
    renderBuilder({ editingDie: PUNK });
    const sides = screen.getByPlaceholderText('##');
    await user.clear(sides);
    await user.type(sides, '6');
    await user.click(screen.getByText('SET'));
    const values = faceInputs().map(i => i.value);
    expect(values.slice(0, 4)).toEqual(['apple', 'bannana', 'oragne', 'peach']);
    expect(values).toHaveLength(6);
  });
});

// ─── Switching edit target while open ─────────────────────────────────────────

/**
 * Regression: the form's state initializers only run on mount, so changing
 * `editingDie` on an already-open window left the previous values on screen.
 * App fixes this by keying the component on the die; this harness reproduces
 * that arrangement.
 */
describe('CustomDieBuilder — switching target while open', () => {
  const Harness = ({ dice }: { dice: (CustomDie | null)[] }) => {
    const [i, setI] = useState(0);
    const die = dice[i];
    return (
      <>
        <button onClick={() => setI(n => n + 1)}>next</button>
        <CustomDieBuilder
          key={die ? `edit-${die.id}` : 'new'}
          pos={basePos}
          setPos={noop}
          onClose={vi.fn()}
          onCreate={vi.fn().mockResolvedValue(true)}
          onUpdate={vi.fn().mockResolvedValue(true)}
          existingDice={[PUNK, FATE]}
          editingDie={die}
        />
      </>
    );
  };

  it('loads the new die when switching from blank to editing', async () => {
    const user = userEvent.setup();
    render(<Harness dice={[null, PUNK]} />);
    expect(nameInput().value).toBe('');

    await user.click(screen.getByText('next'));
    expect(nameInput().value).toBe('punk');
    expect(faceInputs().map(i => i.value)).toEqual(['apple', 'bannana', 'oragne', 'peach']);
  });

  it('swaps every field when switching between two dice', async () => {
    const user = userEvent.setup();
    render(<Harness dice={[PUNK, FATE]} />);
    expect(nameInput().value).toBe('punk');
    expect(faceInputs()).toHaveLength(4);

    await user.click(screen.getByText('next'));
    expect(nameInput().value).toBe('Fate');
    expect(faceInputs()).toHaveLength(6);
    expect(faceInputs().map(i => i.value)).toEqual(['+1', '+1', '-1', '-1', '0', '0']);
  });

  it('discards unsaved edits to the previous die', async () => {
    const user = userEvent.setup();
    render(<Harness dice={[PUNK, FATE]} />);
    await user.clear(nameInput());
    await user.type(nameInput(), 'scribble');

    await user.click(screen.getByText('next'));
    expect(nameInput().value).toBe('Fate');
  });

  it('clears a validation error carried from the previous die', async () => {
    const user = userEvent.setup();
    render(<Harness dice={[PUNK, FATE]} />);
    await user.clear(nameInput());
    await user.type(nameInput(), 'Fate');
    await user.click(screen.getByText('SAVE'));
    expect(screen.getByText(/already in use/i)).toBeInTheDocument();

    await user.click(screen.getByText('next'));
    expect(screen.queryByText(/already in use/i)).not.toBeInTheDocument();
  });
});

// ─── Locked (system) dice ─────────────────────────────────────────────────────

describe('CustomDieBuilder — server errors', () => {
  it('surfaces a server error and keeps the form open', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    renderBuilder({ editingDie: PUNK, onUpdate, onClose, serverError: 'a die with that name already exists' });
    await user.click(screen.getByText('SAVE'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/a die with that name already exists/i)).toBeInTheDocument();
  });

  it('closes on a successful save', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderBuilder({ editingDie: PUNK, onUpdate: vi.fn().mockResolvedValue(true), onClose });
    await user.click(screen.getByText('SAVE'));
    expect(onClose).toHaveBeenCalled();
  });
});
