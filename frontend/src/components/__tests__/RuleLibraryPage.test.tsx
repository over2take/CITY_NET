import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { RuleLibraryPage } from '../RuleLibraryPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';

/**
 * The builder's RULE LIBRARY page (8c2; approved mockup docs/mockups/rule-library.html, 2026-11-26): WHEN HEALTH RUNS OUT, its
 * switch (DEATH SAVES on PARTS), its presets, and each number shown for the way picked. Every change held to the server's checks.
 */

const { checkDefinition } = createRequire(import.meta.url)('../../../../backend/systemBuilder/definition.js');
afterEach(cleanup);

const H: Definition = { format: 1, name: 'Hearth', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'body', label: 'Body' }] }] };
const open = (start: Definition = H) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <RuleLibraryPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const card = () => within(screen.getByRole('region', { name: 'When health runs out' }));
const pressed = (group: string) => card().getByRole('group', { name: group }).querySelector('[aria-pressed="true"]')?.textContent;
const dying = (def: Definition) => def.dying as Record<string, unknown>;
const turnOn = () => userEvent.click(card().getByRole('switch', { name: 'When health runs out' }));

describe('the card', () => {
  it('off to start, saying what it is and what starts it; nothing to fill in', () => {
    open();
    expect(card().getByRole('switch', { name: 'When health runs out' }).getAttribute('aria-checked')).toBe('false');
    expect(card().getByText(/It starts when this game's health runs out/).textContent).toContain('0 HP');
    expect(card().queryByRole('group', { name: 'Presets' })).toBeNull();
  });

  it('on: D&D 5E, its numbers shown, each with its "?"', async () => {
    const { last } = open();
    await turnOn();
    expect(dying(last()).way).toBe('count');
    expect(pressed('Presets')).toBe('D&D 5E');
    expect(pressed('How it goes')).toBe('SAVES COUNTED');
    expect((card().getByLabelText('THE SHEET SAYS') as HTMLInputElement).value).toBe('DYING');
    expect((card().getByRole('textbox', { name: 'The save\'s dice' }) as HTMLInputElement).value).toBe('1d20');
    expect((card().getByRole('textbox', { name: 'The save\'s target' }) as HTMLInputElement).value).toBe('10');
    expect(pressed('The save is')).toBe('AT LEAST');
    expect((card().getByLabelText('SUCCESSES TO LIVE') as HTMLInputElement).value).toBe('3');
    expect((card().getByLabelText('Natural 1') as HTMLInputElement).value).toBe('20');
    expect((card().getByLabelText('Natural 1 does') as HTMLSelectElement).value).toBe('back_up');
    expect(pressed('Hurt while down')).toBe('A FAILURE');
    expect(card().queryByLabelText('TURNS LEFT')).toBeNull();
    expect(card().queryByLabelText('GETS HARDER')).toBeNull();
    for (const k of ['library.presets', 'library.word', 'library.way', 'library.save', 'library.count', 'library.naturals', 'library.hurt', 'library.who'] as const) {
      expect(screen.getAllByLabelText(HINTS[k]).length, k).toBeGreaterThan(0);
    }
  });

  it('a preset writes its numbers; Cyberpunk RED under BODY, harder each save, no count', async () => {
    const { last } = open();
    await turnOn();
    await userEvent.click(card().getByRole('button', { name: 'CYBERPUNK RED' }));
    expect(dying(last())).toMatchObject({ way: 'once', word: 'MORTALLY WOUNDED', harder: 1, save: { dice: '1d10', way: 'under', target: '@body' } });
    expect(pressed('How it goes')).toBe('ONE FAIL IS DEATH');
    expect((card().getByLabelText('GETS HARDER') as HTMLInputElement).value).toBe('1');
    expect(card().queryByLabelText('SUCCESSES TO LIVE')).toBeNull();
    expect(checkDefinition(last()).problems).toEqual([]);
  });

  it('TURNS LEFT asks only for the turns; NO ROLL for neither', async () => {
    const { last } = open();
    await turnOn();
    await userEvent.click(within(card().getByRole('group', { name: 'How it goes' })).getByRole('button', { name: 'TURNS LEFT' }));
    expect(card().queryByRole('textbox', { name: 'The save\'s dice' })).toBeNull();
    expect(card().queryByRole('group', { name: 'On a natural' })).toBeNull();
    const turns = card().getByLabelText('TURNS LEFT') as HTMLInputElement;
    await userEvent.clear(turns);
    await userEvent.type(turns, '4');
    expect(dying(last()).turns).toBe(4);
    expect(pressed('Presets')).toBeUndefined();
    await userEvent.click(within(card().getByRole('group', { name: 'How it goes' })).getByRole('button', { name: 'NO ROLL' }));
    expect(card().queryByLabelText('TURNS LEFT')).toBeNull();
    expect(card().getByText(/the table decides what happens/)).toBeTruthy();
    expect(checkDefinition(last()).problems).toEqual([]);
  });

  it('the word, the save, the count, a natural and HURT WHILE DOWN, each as typed or picked', async () => {
    const { last, edits } = open();
    await turnOn();
    const word = card().getByLabelText('THE SHEET SAYS');
    await userEvent.clear(word);
    expect(word.getAttribute('aria-invalid')).toBe('true');
    await userEvent.type(word, 'Bleeding Out');
    expect(dying(last()).word).toBe('Bleeding Out');
    await userEvent.click(within(card().getByRole('group', { name: 'The save is' })).getByRole('button', { name: 'UNDER' }));
    expect(dying(last()).save).toMatchObject({ way: 'under' });
    const target = card().getByRole('textbox', { name: 'The save\'s target' });
    await userEvent.clear(target);
    await userEvent.type(target, '@body');
    expect((dying(last()).save as { target: string }).target).toBe('@body');
    const die = card().getByLabelText('FAILURES TO DIE');
    await userEvent.clear(die);
    await userEvent.type(die, '2');
    expect(dying(last()).to_die).toBe(2);
    await userEvent.selectOptions(card().getByLabelText('Natural 2 does'), 'dead');
    expect((dying(last()).naturals as unknown[])[1]).toEqual({ face: 1, then: 'dead' });
    await userEvent.click(card().getByRole('button', { name: 'Take off natural 1' }));
    expect(dying(last()).naturals).toEqual([{ face: 1, then: 'dead' }]);
    await userEvent.click(card().getByRole('button', { name: '+ NATURAL' }));
    expect(dying(last()).naturals).toEqual([{ face: 1, then: 'dead' }, { face: 20, then: 'dead' }]);
    // Six naturals at most: + NATURAL then can't be pressed.
    for (let i = 0; i < 4; i += 1) await userEvent.click(card().getByRole('button', { name: '+ NATURAL' }));
    expect((dying(last()).naturals as unknown[]).length).toBe(6);
    expect((card().getByRole('button', { name: '+ NATURAL' }) as HTMLButtonElement).disabled).toBe(true);
    // A number box written only with a whole number: something else typed writes nothing.
    const writes = edits.length;
    await userEvent.type(die, 'x');
    expect(edits.length).toBe(writes);
    await userEvent.click(within(card().getByRole('group', { name: 'Hurt while down' })).getByRole('button', { name: 'DEAD' }));
    expect(dying(last()).hurt).toBe('dead');
    expect(checkDefinition(last()).problems).toEqual([]);
  });

  it('WHO GOES DOWN: friendly and enemy NPCs each ticked, kept through a preset', async () => {
    const { last } = open();
    await turnOn();
    const enemy = card().getByRole('button', { name: 'ENEMY NPCS' });
    expect(enemy.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(enemy);
    expect(dying(last()).npcs).toEqual({ friendly: false, enemy: true });
    await userEvent.click(enemy);
    expect(dying(last()).npcs).toEqual({ friendly: false, enemy: false });
    await userEvent.click(card().getByRole('button', { name: 'ENEMY NPCS' }));
    await userEvent.click(card().getByRole('button', { name: 'FRIENDLY NPCS' }));
    await userEvent.click(card().getByRole('button', { name: 'CITIES WITHOUT NUMBER' }));
    expect(dying(last()).npcs).toEqual({ friendly: true, enemy: true });
    expect(card().getByRole('button', { name: 'ENEMY NPCS' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('off again hides it and keeps it', async () => {
    const { last } = open();
    await turnOn();
    await userEvent.click(card().getByRole('button', { name: 'CYBERPUNK RED' }));
    await turnOn();
    expect(last().parts).toEqual({ death: { on: false } });
    expect(card().queryByRole('group', { name: 'Presets' })).toBeNull();
    await turnOn();
    expect(pressed('Presets')).toBe('CYBERPUNK RED');
  });
});
