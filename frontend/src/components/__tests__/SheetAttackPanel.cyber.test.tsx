import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SheetAttackPanel } from '../Sidebar';

/**
 * Attacking with body weaponry.
 *
 * The server resolves it from installed chrome and takes a `cyberIndex`; this is the only
 * way a player reaches that. Without it the implant is stats nobody can roll, which is
 * where it was before.
 */

const blade = (name: string, over = {}) =>
  ({ name, type: 'limb', side: null, placed: true, equipped: true, hl: 1, mods: [], ...over });

let emit: ReturnType<typeof vi.fn>;
let handlers: Record<string, (d: unknown) => void>;

const socketRef = () => ({
  current: {
    emit,
    on: (e: string, fn: (d: unknown) => void) => { handlers[e] = fn; },
    off: vi.fn(),
  },
});

beforeEach(() => {
  emit = vi.fn();
  handlers = {};
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

/** Render the panel, then feed it the sheet the way the socket would. */
const open = async (data: Record<string, unknown>, system = 'cities_without_number') => {
  render(
    <SheetAttackPanel
      system={system}
      userName="GHOST"
      socketRef={socketRef() as never}
      targetId={7}
      rhombusState={{ color: '#00ff00' }}
      setIsDiceTrayOpen={vi.fn()}
    />
  );
  await vi.waitFor(() => expect(handlers.sheetData).toBeTruthy());
  handlers.sheetData({ username: 'GHOST', data });
  await vi.waitFor(() => expect(screen.queryByRole('combobox')).toBeTruthy());
};

const options = () =>
  [...(screen.getByRole('combobox') as HTMLSelectElement).options].map((o) => o.textContent);

const attackEmits = () => emit.mock.calls.filter((c) => c[0] === 'sheetAttack');

/** The fire button, whose label follows the chosen weapon rather than being fixed. */
const fireButton = () => screen.getByRole('button', { name: /^(STRIKE|SWING|FIRE)$/ });

const PISTOL = {
  weapon1_name: 'Heavy Pistol', weapon1_dmg: '1d8', weapon1_skill: 'shoot', weapon1_atk: 0,
};

describe('body weaponry in the attack picker', () => {
  it('is offered alongside the carried weapons', async () => {
    await open({ ...PISTOL, stab: 2, punch: 0, cyberware: [blade('Body Blades I')] });
    expect(options().some((o) => o?.includes('HEAVY PISTOL'))).toBe(true);
    expect(options().some((o) => o?.includes('BODY BLADES I'))).toBe(true);
  });

  it('shows the damage and the skill it will roll', async () => {
    await open({ stab: 0, punch: 4, cyberware: [blade('Body Blades II')] });
    const line = options().find((o) => o?.includes('BODY BLADES II'));
    expect(line).toContain('2d6');
    expect(line).toContain('PUNCH'); // better of Stab 0 / Punch 4
  });

  it('sends cyberIndex rather than a weapon row', async () => {
    await open({ ...PISTOL, stab: 2, cyberware: [blade('Body Blades I')] });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'c:1');
    await userEvent.click(fireButton());

    expect(attackEmits()).toHaveLength(1);
    expect(attackEmits()[0][1]).toMatchObject({ targetId: 7, cyberIndex: 1 });
  });

  it('sends no cyberIndex when an ordinary weapon is chosen', async () => {
    // The regression that matters: every attack anyone was already making.
    await open({ ...PISTOL, cyberware: [blade('Body Blades I')] });
    await userEvent.selectOptions(screen.getByRole('combobox'), '1');
    await userEvent.click(fireButton());

    expect(attackEmits()[0][1].cyberIndex).toBeUndefined();
    expect(attackEmits()[0][1].weaponIndex).toBe(1);
  });

  it('offers a blade even to a character with no weapon rows at all', async () => {
    // Chrome is a weapon you cannot be disarmed of, and the panel used to say
    // "NO USABLE WEAPONS" to someone with blades in their arms.
    await open({ stab: 1, cyberware: [blade('Body Blades I')] });
    expect(screen.queryByText(/NO USABLE WEAPONS/i)).toBeNull();
    expect(options().some((o) => o?.includes('BODY BLADES I'))).toBe(true);
  });

  it('does not offer a piece that is owned but not fitted', async () => {
    await open({ ...PISTOL, cyberware: [blade('Body Blades I', { placed: false })] });
    expect(options().some((o) => o?.includes('BODY BLADES'))).toBe(false);
  });
});

describe('body weaponry is a Cities Without Number thing', () => {
  it('is not offered on Cyberpunk RED, which does not stat it', async () => {
    // CP:R has body weaponry in its own book, but the app does not model its numbers, so
    // offering the picker an entry it cannot roll would be a lie.
    await open({ weapon1_name: 'Gun', weapon1_dmg: '3d6', weapon1_skill: 'handgun',
      cyberware: [blade('Body Blades I')] }, 'cyberpunk_red');
    expect(options().some((o) => o?.includes('BODY BLADES'))).toBe(false);
  });

  it('is not offered on Shadowrun', async () => {
    await open({ weapon1_name: 'Predator', weapon1_dmg: '3P', weapon1_skill: 'firearms',
      cyberware: [blade('Body Blades I')] }, 'shadowrun_6e');
    expect(options().some((o) => o?.includes('BODY BLADES'))).toBe(false);
  });
});
