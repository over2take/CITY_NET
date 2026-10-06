import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SetupPage } from '../SetupPage';
import { systemsApi, type Definition } from '../../sheets/systemsApi';
import { SYSTEMS_CHANGED_EVENT } from '../../sheets/systemsLibrary';

/**
 * The builder's SETUP page (4a3b). Approved mockup builder-setup (2026-10-06): five questions on one
 * page, each saved as answered; the name editable here, refused like RENAME; a warning on the
 * health question when characters already play the system.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
let renameAnswer: { status: number; body: unknown };
let characterCount: number;

const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (status: number, b: unknown) => ({ ok: status < 300, status, json: async () => b }) as unknown as Response;
  if (url === '/api/systems') return json(200, [{ id: HEARTH, name: 'Hearth', characterCount }]);
  if (url === `/api/systems/${HEARTH}/name` && init?.method === 'PUT') return json(renameAnswer.status, renameAnswer.body);
  return json(404, { error: 'No such route' });
});

beforeEach(() => { renameAnswer = { status: 200, body: { name: 'Emberhold' } }; characterCount = 0; });
afterEach(() => cleanup());

/** The page, holding its definition the way the builder does; `edits` is every change it made. */
const open = (start: Definition = { format: 1, name: 'Hearth' }) => {
  const edits: Definition[] = [];
  const say = vi.fn();
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <SetupPage api={systemsApi('gm', fakeServer as typeof fetch)} systemId={HEARTH} definition={def} say={say}
      edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { edits, say, last: () => edits[edits.length - 1] };
};
const question = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;
const model = (label: string) => within(screen.getByRole('radiogroup', { name: 'Health model' })).getByText(label).closest('button')!;
const preview = () => screen.getByTestId('setup-preview').textContent;

describe('what it is', () => {
  it('shows and changes the description, author and license, leaving a blank one out', async () => {
    const { last } = open({ format: 1, name: 'Hearth', author: 'Cody' });
    const q = question('WHAT IS IT?');
    expect((within(q).getByLabelText('AUTHOR') as HTMLInputElement).value).toBe('Cody');
    await userEvent.type(within(q).getByLabelText('DESCRIPTION'), 'By one fire.');
    expect(last().description).toBe('By one fire.');
    await userEvent.type(within(q).getByLabelText('LICENSE'), 'CC BY 4.0');
    expect(last().license).toBe('CC BY 4.0');
    await userEvent.clear(within(q).getByLabelText('AUTHOR'));
    expect('author' in last()).toBe(false);
  });

  it('renames, keeping the builder\'s copy in step and telling the picker', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    const { last, say } = open();
    const name = within(question('WHAT IS IT?')).getByLabelText('NAME') as HTMLInputElement;
    expect((screen.getByText('RENAME') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(name);
    await userEvent.type(name, 'Emberhold{Enter}');
    await waitFor(() => expect(say).toHaveBeenCalledWith('Renamed to Emberhold.'));
    expect(last().name).toBe('Emberhold');
    expect(told).toHaveBeenCalledTimes(1);
    expect((screen.getByText('RENAME') as HTMLButtonElement).disabled).toBe(true);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('refuses a name in use where it was typed, changing nothing', async () => {
    renameAnswer = { status: 409, body: { error: 'Another system is already called Ember.' } };
    const { edits } = open();
    const name = within(question('WHAT IS IT?')).getByLabelText('NAME') as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'ember');
    await userEvent.click(screen.getByText('RENAME'));
    expect((await screen.findByRole('alert')).textContent).toBe('Another system is already called Ember.');
    expect(name.value).toBe('ember');
    expect(document.activeElement).toBe(name);
    expect(edits).toEqual([]);
    await userEvent.type(name, 's');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('how characters get hurt', () => {
  it('starts on one pool, previewing the starter sheet and the token', () => {
    open();
    expect(model('ONE POOL').getAttribute('aria-checked')).toBe('true');
    expect(preview()).toBe('THE STARTER SHEET GETSHEALTHHPHP MAXThe token\'s monitor shows HP.');
  });

  it('picks another model in its usual shape, and coming back keeps what was set', async () => {
    const { last } = open();
    await userEvent.type(screen.getByPlaceholderText('HP'), 'VIGOR');
    expect(last().core).toEqual({ health: { model: 'pool', label: 'VIGOR' } });
    await userEvent.click(model('TWO TRACKS'));
    expect((last().core as { health: unknown }).health).toEqual({ model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true });
    expect(preview()).toContain('PHYSICAL MAXSTUNSTUN MAX');
    await userEvent.click(model('ONE POOL'));
    expect((last().core as { health: unknown }).health).toEqual({ model: 'pool', label: 'VIGOR' });
    await userEvent.clear(screen.getByPlaceholderText('HP'));
    expect((last().core as { health: unknown }).health).toEqual({ model: 'pool' });
  });

  it('renames a track, keeping its id, and turns overflow off', async () => {
    const { last } = open();
    await userEvent.click(model('TWO TRACKS'));
    const second = screen.getByLabelText('SECOND TRACK');
    await userEvent.clear(second);
    await userEvent.type(second, 'STRAIN');
    await userEvent.click(screen.getByRole('checkbox'));
    expect((last().core as { health: unknown }).health).toEqual({ model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STRAIN' }], overflow: false });
    expect(preview()).toContain('The token\'s monitor shows PHYSICAL; STRAIN lives on the sheet.');
  });

  it('edits harm levels: add, slots, penalty, remove, within one to six', async () => {
    const { last } = open();
    await userEvent.click(model('HARM LEVELS'));
    await userEvent.click(screen.getByText('+ ADD'));
    const levels = () => ((last().core as { health: { levels: { id: string; label: string; slots: number; penalty?: string }[] } }).health.levels);
    expect(levels().map((l) => l.id)).toEqual(['lesser', 'moderate', 'severe', 'new_level']);
    fireEvent.change(screen.getByLabelText('LESSER slots'), { target: { value: '9' } });
    expect(levels()[0].slots).toBe(4);
    await userEvent.clear(screen.getByLabelText('LESSER penalty'));
    expect('penalty' in levels()[0]).toBe(false);
    await userEvent.type(screen.getByLabelText('NEW penalty'), '-2d');
    expect(levels()[3].penalty).toBe('-2d');
    await userEvent.click(screen.getByLabelText('Remove MODERATE'));
    expect(levels().map((l) => l.id)).toEqual(['lesser', 'severe', 'new_level']);
    expect(preview()).toContain('HARMLESSERLESSER 2LESSER 3LESSER 4SEVERE');
    await userEvent.click(screen.getByLabelText('Remove LESSER'));
    await userEvent.click(screen.getByLabelText('Remove SEVERE'));
    expect((screen.getByLabelText('Remove NEW') as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 5; i += 1) await userEvent.click(screen.getByText('+ ADD'));
    expect(levels()).toHaveLength(6);
    expect((screen.getByText('+ ADD') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps wounds within what the server takes', async () => {
    const { last } = open();
    await userEvent.click(model('WOUND COUNT'));
    fireEvent.change(screen.getByLabelText('Wounds before out'), { target: { value: '25' } });
    expect((last().core as { health: unknown }).health).toEqual({ model: 'wounds', count: 10, penalty: -1 });
    fireEvent.change(screen.getByLabelText('Penalty per wound'), { target: { value: '3' } });
    expect((last().core as { health: { penalty: number } }).health.penalty).toBe(0);
    fireEvent.change(screen.getByLabelText('Wounds before out'), { target: { value: '' } });
    expect((last().core as { health: { count: number } }).health.count).toBe(1);
  });

  it('adds a location with an id of its own, and has nothing to set for none', async () => {
    const { last } = open();
    await userEvent.click(model('HIT LOCATIONS'));
    await userEvent.click(screen.getByText('+ ADD'));
    const ids = (last().core as { health: { locations: { id: string }[] } }).health.locations.map((l) => l.id);
    expect(ids.at(-1)).toBe('new_location');
    await userEvent.click(model('NONE'));
    expect(screen.getByText('Nothing to set.')).toBeTruthy();
    expect(preview()).toBe('THE STARTER SHEET GETSNo health section. Consequences are written in as conditions.');
  });

  it('warns that characters already play it, only when some do', async () => {
    characterCount = 5;
    open();
    expect(await screen.findByText('5 characters play Hearth. Changing how they get hurt changes their sheets once you publish; the numbers already on them are kept.')).toBeTruthy();
    cleanup();
    characterCount = 1;
    open();
    expect(await screen.findByText(/^1 character plays Hearth\./)).toBeTruthy();
    cleanup();
    characterCount = 0;
    open();
    await waitFor(() => expect(fakeServer).toHaveBeenCalled());
    expect(screen.queryByText(/play Hearth|plays Hearth/)).toBeNull();
  });
});

describe('how characters grow, the dice, and distance', () => {
  it('turns advancement on and off, saying what is chosen', async () => {
    const { last } = open();
    expect(within(question('HOW DO CHARACTERS GROW?')).getByText('None: characters don\'t advance.')).toBeTruthy();
    await userEvent.click(screen.getByText('SPEND XP'));
    await userEvent.click(screen.getByText('XP LEVELS'));
    expect((last().core as { advancement: string[] }).advancement).toEqual(['levels', 'spend']);
    expect(screen.getByText('Chosen: XP levels, Spend XP.')).toBeTruthy();
  });

  it('toggles dice, adds others, and stops at eight', async () => {
    const { last } = open({ format: 1, name: 'Hearth', core: { dice: ['d20'] } });
    const dice = () => (last().core as { dice: string[] }).dice;
    await userEvent.click(screen.getByText('d6'));
    expect(dice()).toEqual(['d20', 'd6']);
    await userEvent.type(screen.getByLabelText('Another die'), 'd7{Enter}');
    expect(dice()).toEqual(['d20', 'd6', 'd7']);
    expect(screen.getByText('d7').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Another die') as HTMLInputElement).value).toBe('');
    await userEvent.type(screen.getByLabelText('Another die'), 'six{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('six is not a die (d2 to d100, or dF, with a count: 2d6)');
    for (const d of ['d4', 'd8', 'd10', 'd12', 'd100']) await userEvent.click(screen.getByText(d));
    expect(dice()).toHaveLength(8);
    expect(screen.getByText('8 of 8.')).toBeTruthy();
    expect((screen.getByText('2d6') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByText('d20'));
    expect(dice()).toEqual(['d6', 'd7', 'd4', 'd8', 'd10', 'd12', 'd100']);
  });

  it('picks the distance unit, feet unless told', async () => {
    const { last } = open();
    const units = within(screen.getByRole('radiogroup', { name: 'Distance' })).getAllByRole('radio');
    expect(units.find((b) => b.getAttribute('aria-checked') === 'true')!.textContent).toMatch(/^FEET/);
    await userEvent.click(units.find((b) => b.textContent!.startsWith('ZONES'))!);
    expect((last().core as { distance: string }).distance).toBe('zones');
  });
});
