/**
 * The CWN work must not reach the other systems.
 *
 * Most of it landed in shared files - the row model, the effects engine, the augmentation
 * window, the install locations - because one engine with a profile per system beats four
 * copies of it. That is the right shape and it is also exactly how bleed happens: a
 * vocabulary, a field or a control added for one game quietly showing up in another.
 *
 * These are the boundary. Each asserts that something built for Cities Without Number is
 * absent under Cyberpunk RED, Shadowrun or generic - so a future change that widens it has
 * to do so deliberately rather than by forgetting.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CyberwareWindow } from '../CyberwareWindow';
import { getTemplate } from '../../sheets';
import { typesFor, CWN_TYPES, CPR_TYPES } from '../../sheets/cyberwareLocations';
import { sheetEffects } from '../../sheets/cyberwareEffects';
import { shopsAvailable } from '../../data/buildingTypes';

const CWN = getTemplate('cities_without_number');
const CPR = getTemplate('cyberpunk_red');
const SR6 = getTemplate('shadowrun_6e');
const GENERIC = getTemplate('generic');

const sheet = (rows: unknown[], fields = {}) => ({ ...fields, cyberware: rows });
const piece = (mods: unknown[], type = 'neural') =>
  ({ name: 'P', equipped: true, type, side: null, placed: true, hl: 1, mods });

describe('install locations stay with their own system', () => {
  it('offers Cyberpunk RED none of the CWN types', () => {
    const cprIds = typesFor('cyberpunk_red').map((t) => t.id);
    for (const t of CWN_TYPES) expect(cprIds).not.toContain(t.id);
  });

  it('offers CWN none of the Cyberpunk RED types', () => {
    const cwnIds = typesFor('cities_without_number').map((t) => t.id);
    for (const t of CPR_TYPES) expect(cwnIds).not.toContain(t.id);
  });

  it('offers a system with no cyberware rules nothing at all', () => {
    expect(typesFor('shadowrun_6e')).toEqual([]);
    expect(typesFor('generic')).toEqual([]);
    expect(typesFor('')).toEqual([]);
  });
});

describe('the effects engine answers only for the system asked', () => {
  it('does nothing at all for Shadowrun or generic', () => {
    const data = sheet([piece([{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    expect(sheetEffects(data, SR6).fields).toEqual({});
    expect(sheetEffects(data, GENERIC).fields).toEqual({});
  });

  it('leaves a CWN attribute unmatched on a Cyberpunk RED sheet', () => {
    // Constitution and Wisdom are CWN's; CP:R has neither.
    for (const target of ['Constitution', 'Wisdom']) {
      const data = sheet([piece([{ kind: 'stat', target, value: 2 }])], { cool: 5 });
      const out = sheetEffects(data, CPR);
      expect(out.fields).toEqual({});
      expect(out.unmatched.map((u) => u.target)).toEqual([target]);
    }
  });

  it('leaves Trauma Target unmatched on a Cyberpunk RED sheet', () => {
    // Reachable on CWN through the profile's extra fields. CP:R has no such stat, so a
    // modifier naming it must fail loudly rather than land on something else.
    const data = sheet([piece([{ kind: 'stat', target: 'Trauma Target', value: 1 }])], { cool: 5 });
    const out = sheetEffects(data, CPR);
    expect(out.fields).toEqual({});
    expect(out.unmatched.map((u) => u.target)).toEqual(['Trauma Target']);
  });

  it('runs no recompute for Cyberpunk RED', () => {
    // CWN derives attribute modifiers and saves from the overlaid copy. CP:R has no such
    // layer, and inventing one would put fields on the sheet that system does not have.
    const data = sheet([piece([{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    const ids = Object.keys(sheetEffects(data, CPR).fields);
    expect(ids).toEqual(['cool']);
  });
});

describe('the augmentation window speaks each system on its own terms', () => {
  const open = (template: typeof CPR, data: Record<string, unknown>) =>
    render(<CyberwareWindow data={data} template={template}
      onFieldChange={vi.fn()} onClose={vi.fn()} />);

  it('says Humanity and eddies on Cyberpunk RED, never Strain', () => {
    open(CPR, { humanity: 40, cyberware: [{ ...piece([]), cost: 500 }] });
    expect(screen.getByText(/HUMANITY LOSS/)).toBeInTheDocument();
    expect(screen.queryByText(/STRAIN/)).not.toBeInTheDocument();
  });

  it('shows no System Strain ceiling on Cyberpunk RED', () => {
    // The ceiling refuses installs. Applying CWN's limit to a system that does not have it
    // would block a legal Cyberpunk RED character.
    open(CPR, { con: 10, cyberware: [{ ...piece([]), hl: 9 }] });
    expect(screen.queryByText(/\/ 10/)).not.toBeInTheDocument();
  });

  it('offers no book catalogue on Cyberpunk RED', async () => {
    open(CPR, { cyberware: [] });
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    expect(screen.queryByLabelText('Pick from catalogue')).not.toBeInTheDocument();
  });

  it('offers the CWN-only modifier kind only under CWN', async () => {
    // statFloor exists for "Dex 14, or +2 if higher", which is a CWN shape. The engine
    // still understands it everywhere so a stored row never breaks, but a system whose
    // book has no such rule should not be offering it in the picker.
    for (const [template, expected] of [[CWN, true], [CPR, false]] as const) {
      const { unmount } = render(<CyberwareWindow data={{ cyberware: [] }} template={template}
        onFieldChange={vi.fn()} onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
      await userEvent.click(screen.getByRole('button', { name: '+ MODIFIER' }));
      const kinds = [...screen.getByLabelText('Modifier 1 kind').querySelectorAll('option')]
        .map((o) => (o as HTMLOptionElement).value);
      expect(kinds.includes('statFloor')).toBe(expected);
      unmount();
    }
  });
});

describe('shops are Cities Without Number only', () => {
  it('is unavailable everywhere else', () => {
    expect(shopsAvailable('cities_without_number')).toBe(true);
    for (const s of ['cyberpunk_red', 'shadowrun_6e', 'generic', '', null]) {
      expect(shopsAvailable(s)).toBe(false);
    }
  });
});

describe('the ranged AC link is CWN alone', () => {
  const sourcesOf = (t: typeof CPR) =>
    t.sections.flatMap((s) => (s.fields ?? []).map((f) => f.source)).filter(Boolean);

  it('is declared by CWN and by nobody else', () => {
    // A template that links only `token_ac` means both token columns by it, which is
    // what a system with one Armor Class means. Declaring the ranged link is what
    // splits them, so it must not appear on a sheet whose rules do not split.
    expect(sourcesOf(CWN)).toContain('token_ac_ranged');
    for (const t of [CPR, SR6, GENERIC]) {
      expect(sourcesOf(t)).not.toContain('token_ac_ranged');
    }
  });
});

describe('CWN fields exist on no other sheet', () => {
  const idsOf = (t: typeof CPR) =>
    t.sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));

  it('keeps Lifestyle, TT Mod and Trauma Target off the other templates', () => {
    const cwnOnly = ['strain_mod', 'armor_trauma_mod', 'trauma_target', 'system_strain',
      'soak_current', 'armor_soak', 'armor_ac_melee', 'shield_bonus_melee', 'ac_ranged'];
    for (const t of [CPR, SR6, GENERIC]) {
      for (const id of cwnOnly) expect(idsOf(t)).not.toContain(id);
    }
  });

  it('still has them on the CWN sheet', () => {
    // Guards the guard: a typo in the ids above would make the test above pass for free.
    const ids = idsOf(CWN);
    for (const id of ['strain_mod', 'armor_trauma_mod', 'trauma_target', 'system_strain',
      'soak_current', 'armor_soak', 'armor_ac_melee', 'shield_bonus_melee', 'ac_ranged']) {
      expect(ids).toContain(id);
    }
  });
});
