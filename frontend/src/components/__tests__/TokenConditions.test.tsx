import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { TokenConditions } from '../TokenConditions';
import { StreamerOverlay } from '../StreamerOverlay';
import { HealthReviewPanel } from '../HitPoints';
import { CONDITIONS_CHANGED_EVENT, forgetConditionLists } from '../../hooks/useConditionList';
import type { Location } from '../../types';

/**
 * A token's CONDITIONS in its HEALTH folder (4e2b1). Approved mockup builder-conditions (2026-10-09):
 * any number as wrapping chips with their descriptions; whoever may change the token's health puts
 * them on and takes them off and sees rounds left and modifiers; everyone else sees which and what
 * they mean. The game's list comes from the server's own conditionsOf.
 */

const { conditionsOf } = createRequire(import.meta.url)('../../../../backend/systemBuilder/conditions.js');
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const GAME = conditionsOf({
  conditions: {
    poisoned: { ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }] },
    glitching: { name: 'Glitching', short: 'GLITCH', icon: 'signal', description: 'Chrome misfiring.' },
  },
});

/** The game's list the server answers; a case may swap it. */
let game = GAME;
let puts: { url: string; body: unknown; auth: string | null }[];
let putAnswer: { status: number; body: unknown };
let listAsked: { url: string; auth: string | null }[];

beforeEach(() => {
  // The game's list is shared between windows: each case asks afresh.
  forgetConditionLists();
  game = GAME;
  puts = [];
  listAsked = [];
  putAnswer = { status: 200, body: {} };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    if (url.startsWith('/api/systems/conditions/')) {
      listAsked.push({ url, auth });
      return { ok: true, status: 200, json: async () => game } as Response;
    }
    puts.push({ url, body: JSON.parse(String(init!.body)), auth });
    return { ok: putAnswer.status < 300, status: putAnswer.status, json: async () => putAnswer.body } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/**
 * A socket that answers requestTokenConditions with `detail`, or as for someone else when null
 * (with `partial` as what that partial answer carries). `after` replies are sent once it has answered.
 */
const fakeSocket = (detail: unknown[] | null, { partial = [] as unknown[], after = [] as unknown[] } = {}) => {
  const listeners: Record<string, ((d: any) => void)[]> = {};
  const asked: unknown[] = [];
  return {
    asked,
    on: (e: string, fn: (d: any) => void) => { (listeners[e] ??= []).push(fn); },
    off: (e: string, fn: (d: any) => void) => { listeners[e] = (listeners[e] ?? []).filter((f) => f !== fn); },
    emit: (e: string, data: { location_id: number }) => {
      asked.push(data);
      if (e !== 'requestTokenConditions') return;
      const reply = detail
        ? { location_id: data.location_id, full: true, conditions: detail }
        : { location_id: data.location_id, full: false, conditions: partial };
      setTimeout(() => [reply, ...after].forEach((r) => (listeners.tokenConditions ?? []).forEach((fn) => fn(r))), 0);
    },
  };
};
const token = (conditions: string) => ({ id: 7, name: 'GANGER', shape: 'enemy_rhombus', conditions } as unknown as Location & { conditions: string });
const section = () => within(screen.getByRole('region', { name: 'Conditions' }));

describe('for whoever may change the token\'s health', () => {
  it('shows each condition as a chip with rounds left, its description and modifiers', async () => {
    const socket = fakeSocket([{ id: 'poisoned', left: 2, modifiers: [{ target: 'all_rolls', amount: -1 }] }, { id: 'glitching', modifiers: [] }]);
    render(<TokenConditions location={token('[{"id":"poisoned"},{"id":"glitching"}]')} gameSystem={HEARTH} socket={socket} canChange authToken="gm-token" />);
    // The chips draw at once from the token; the rounds left arrive after, with the server's reply.
    // Waited for, since on a busy machine the reply can land after the chips first appear.
    const chips = () => within(section().getByRole('group', { name: 'On this token' })).getAllByRole('button');
    await waitFor(() => expect(chips().map((c) => c.textContent)).toEqual(['POISON2R', 'GLITCH']));
    expect(chips()[1].getAttribute('title')).toBe('GLITCHING\nChrome misfiring.');
    // The details folded away until a chip is clicked (8a6d), then under the chips: name, rounds, words, modifiers.
    expect(section().queryByText('Sickened by a toxin.')).toBeNull();
    await userEvent.click(section().getByRole('button', { name: 'Poisoned' }));
    expect(section().getByRole('button', { name: 'Poisoned' }).getAttribute('aria-expanded')).toBe('true');
    const open = section().getByRole('group', { name: 'Poisoned' });
    expect(open.textContent).toBe('POISONED· 2 ROUNDS LEFTSickened by a toxin.ALL ROLLS −1CLOSETAKE OFF');
    // One open at a time: another clicked takes its place; clicked again, closed.
    await userEvent.click(section().getByRole('button', { name: 'Glitching' }));
    expect(section().queryByRole('group', { name: 'Poisoned' })).toBeNull();
    expect(section().getByRole('group', { name: 'Glitching' }).textContent).toContain('Chrome misfiring.');
    await userEvent.click(section().getByRole('button', { name: 'Glitching' }));
    expect(section().queryByRole('group', { name: 'Glitching' })).toBeNull();
    expect(listAsked[0]).toEqual({ url: `/api/systems/conditions/${HEARTH}`, auth: 'Bearer gm-token' });
    expect(socket.asked).toEqual([{ location_id: 7 }]);
  });

  it('a chip opened closes with CLOSE, Escape or + CONDITION, and the list closes when one is opened (8a6d)', async () => {
    render(<TokenConditions location={token('[{"id":"poisoned"}]')} gameSystem={HEARTH} socket={fakeSocket([{ id: 'poisoned', left: 2, modifiers: [] }])} canChange authToken="t" />);
    const chip = await section().findByRole('button', { name: 'Poisoned' });
    await userEvent.click(chip);
    await userEvent.click(section().getByRole('button', { name: 'CLOSE' }));
    expect(section().queryByRole('group', { name: 'Poisoned' })).toBeNull();
    await userEvent.click(chip);
    await userEvent.keyboard('{Escape}');
    expect(section().queryByRole('group', { name: 'Poisoned' })).toBeNull();
    await userEvent.click(chip);
    await userEvent.click(section().getByRole('button', { name: '+ CONDITION' }));
    expect(section().queryByRole('group', { name: 'Poisoned' })).toBeNull();
    expect(section().getByRole('listbox', { name: 'Put on a condition' })).toBeTruthy();
    await userEvent.click(chip);
    expect(section().queryByRole('listbox', { name: 'Put on a condition' })).toBeNull();
    expect(section().getByRole('group', { name: 'Poisoned' })).toBeTruthy();
  });

  it('puts one on from the game\'s list, sending every other with its rounds left', async () => {
    const changed = vi.fn();
    render(<TokenConditions location={token('[{"id":"poisoned"}]')} gameSystem={HEARTH} socket={fakeSocket([{ id: 'poisoned', left: 2, modifiers: [] }])} canChange authToken="vex-token" onChanged={changed} />);
    await waitFor(() => expect(section().getByRole('button', { name: 'Poisoned' }).textContent).toBe('POISON2R'));
    await userEvent.click(section().getByRole('button', { name: '+ CONDITION' }));
    const picker = within(section().getByRole('listbox', { name: 'Put on a condition' }));
    expect(picker.queryByRole('option', { name: /POISONED/ })).toBeNull();
    await userEvent.click(picker.getByRole('option', { name: 'GLITCHING' }));
    expect(puts).toEqual([{ url: '/api/locations/7/conditions', body: { conditions: [{ id: 'poisoned', left: 2 }, { id: 'glitching' }] }, auth: 'Bearer vex-token' }]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('takes one off, and says why the server refused', async () => {
    putAnswer = { status: 403, body: { error: 'You can only change your own token' } };
    const changed = vi.fn();
    render(<TokenConditions location={token('[{"id":"prone"},{"id":"glitching"}]')} gameSystem={HEARTH} socket={fakeSocket([{ id: 'prone' }, { id: 'glitching' }])} canChange authToken="t" onChanged={changed} />);
    // Opened, then TAKE OFF, where its × was (8a6d).
    await userEvent.click(await section().findByRole('button', { name: 'Prone' }));
    await userEvent.click(section().getByRole('button', { name: 'Take Prone off' }));
    expect(puts[0].body).toEqual({ conditions: [{ id: 'glitching' }] });
    expect((await section().findByRole('alert')).textContent).toBe('You can only change your own token');
    expect(changed).not.toHaveBeenCalled();
  });

  it('says none, and still offers + CONDITION, on a token with nothing', async () => {
    render(<TokenConditions location={token('[]')} gameSystem={HEARTH} canChange />);
    expect(section().getByText('None.')).toBeTruthy();
    expect(section().getByRole('button', { name: '+ CONDITION' })).toBeTruthy();
  });
});

describe('for everyone else', () => {
  it('shows which conditions and what they mean, never rounds, modifiers or the controls', async () => {
    render(<TokenConditions location={token('[{"id":"poisoned"},{"id":"glitching"}]')} gameSystem={HEARTH} socket={fakeSocket(null)} canChange={false} />);
    // Drawn once the game's list arrives: until then there is nothing to name.
    await screen.findByRole('region', { name: 'Conditions' });
    const chips = within(section().getByRole('group', { name: 'On this token' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['POISON', 'GLITCH']);
    // Opened to read what it means (8a6d): no rounds, no TAKE OFF, no + CONDITION.
    await userEvent.click(section().getByRole('button', { name: 'Glitching' }));
    expect(section().getByRole('group', { name: 'Glitching' }).textContent).toBe('GLITCHINGChrome misfiring.CLOSE');
    expect(section().queryByRole('button', { name: /^Take / })).toBeNull();
    expect(section().queryByRole('button', { name: '+ CONDITION' })).toBeNull();
    expect(listAsked[0].auth).toBeNull();
  });

  it('uses only a full answer\'s rounds and modifiers, and only the answer about this token', async () => {
    const socket = fakeSocket(null, {
      partial: [{ id: 'poisoned', left: 5, modifiers: [{ target: 'all_rolls', amount: -1 }] }],
      after: [{ location_id: 99, full: true, conditions: [{ id: 'poisoned', left: 4, modifiers: [{ target: 'all_rolls', amount: -1 }] }] }],
    });
    render(<TokenConditions location={token('[{"id":"poisoned"}]')} gameSystem={HEARTH} socket={socket} canChange={false} />);
    await screen.findByRole('region', { name: 'Conditions' });
    await new Promise((r) => setTimeout(r, 20));
    expect(section().getByRole('button', { name: 'Poisoned' }).textContent).toBe('POISON');
    await userEvent.click(section().getByRole('button', { name: 'Poisoned' }));
    expect(section().getByRole('group', { name: 'Poisoned' }).textContent).toBe('POISONEDSickened by a toxin.CLOSE');
  });

  it('never offers changes in the folder that only watches someone else\'s health', async () => {
    render(<HealthReviewPanel location={{ ...token('[{"id":"prone"}]'), hp_current: 5, hp_max: 10 } as any} gameSystem={HEARTH} socket={fakeSocket(null)} />);
    await screen.findByRole('region', { name: 'Conditions' });
    expect(within(section().getByRole('group', { name: 'On this token' })).getAllByRole('button').map((c) => c.textContent)).toEqual(['PRONE']);
    // Only the chip, to read it: no + CONDITION, and opened, no TAKE OFF.
    expect(section().getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Prone']);
    await userEvent.click(section().getByRole('button', { name: 'Prone' }));
    expect(section().queryByRole('button', { name: /^Take / })).toBeNull();
  });

  it('draws nothing at all on a token with no conditions', () => {
    render(<TokenConditions location={token('[]')} gameSystem={HEARTH} canChange={false} />);
    expect(screen.queryByRole('region', { name: 'Conditions' })).toBeNull();
  });

  it('leaves out a condition the game no longer has', async () => {
    render(<TokenConditions location={token('[{"id":"hungry"},{"id":"prone"}]')} gameSystem={HEARTH} canChange={false} />);
    await screen.findByRole('region', { name: 'Conditions' });
    expect(within(section().getByRole('group', { name: 'On this token' })).getAllByRole('button').map((c) => c.textContent)).toEqual(['PRONE']);
  });
});

describe('on the stream overlay', () => {
  it('shows the selected token\'s conditions by name and icon, BLIND and BLEED among them now', async () => {
    const selected = { id: 7, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, name: 'GANGER', color: '#00ff00', shape: 'enemy_rhombus',
      hp_current: 6, hp_max: 10, hp_temp: 0, owner: 'gm', conditions: '[{"id":"blinded"},{"id":"glitching","left":2}]' } as any;
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    render(<StreamerOverlay socket={socket} directorState={{} as any} selectedLocation={selected} gameSystem={HEARTH} />);
    const shown = await screen.findByTestId('overlay-conditions');
    expect(shown.textContent).toBe('BLINDGLITCH');
    expect(shown.querySelectorAll('svg')).toHaveLength(2);
    expect(listAsked[0].auth).toBeNull();
  });
});

describe('the game\'s list', () => {
  it('is asked for again when a published system changes', async () => {
    render(<TokenConditions location={token('[]')} gameSystem={HEARTH} canChange />);
    await waitFor(() => expect(listAsked).toHaveLength(1));
    act(() => { window.dispatchEvent(new Event(CONDITIONS_CHANGED_EVENT)); });
    await waitFor(() => expect(listAsked).toHaveLength(2));
  });
});

describe('a condition drawn on the pad (8b1b)', () => {
  it('its chip draws the drawing, as it does an icon', async () => {
    game = conditionsOf({ conditions: { hacked: { name: 'Hacked', short: 'HACK', drawn: [...Array(15).fill('0000'), '0ff0'] } } });
    render(<TokenConditions location={token('[{"id":"hacked"}]')} gameSystem={HEARTH} socket={fakeSocket(null)} canChange={false} />);
    const chip = await within(await screen.findByRole('group', { name: 'On this token' })).findByText('HACK');
    expect(chip.parentElement!.querySelectorAll('rect')).toHaveLength(8);
    // Opened: drawn beside its name too.
    await userEvent.click(screen.getByRole('button', { name: 'Hacked' }));
    expect(screen.getByRole('group', { name: 'Hacked' }).querySelectorAll('rect')).toHaveLength(8);
  });

  it('drawn in the list a GM puts one on from', async () => {
    game = conditionsOf({ conditions: { hacked: { name: 'Hacked', short: 'HACK', drawn: [...Array(15).fill('0000'), '0ff0'] } } });
    render(<TokenConditions location={token('[]')} gameSystem={HEARTH} socket={fakeSocket([])} canChange authToken="gm-token" />);
    await userEvent.click(await screen.findByRole('button', { name: '+ CONDITION' }));
    const option = await within(screen.getByRole('listbox', { name: 'Put on a condition' })).findByRole('option', { name: /HACKED/ });
    expect(option.querySelectorAll('rect')).toHaveLength(8);
  });
});
