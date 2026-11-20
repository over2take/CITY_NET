import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// A condition's EACH TURN on the builder's CONDITIONS page (8a9b; approved mockup docs/mockups/condition-turn-effects.html,
// 2026-11-19): BURNING made by clicks, 1d4 damage at the start of its turn onto the token, rolled by the table, ending after 3
// rounds; POISONED given a save rolled by the player at the end of its turn, off on 13 or more; STUNNED ending AT THE END OF
// ITS NEXT TURN. Saved as made, the server with nothing to fix, there after a reload. At the table it is 8a9c's.

test('CONDITIONS: BURNING burns each turn, POISONED saves, STUNNED ends next turn; saved and kept (8a9b)', async ({ page, request }, info) => {
  const name = `Firetrap ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }] } });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'CONDITIONS');
  };
  await openIt();
  const list = page.getByRole('list', { name: 'Conditions' });

  // BURNING, one of this system's own: ends after 3 rounds, 1d4 damage at the start of its turn.
  await page.getByTestId('conditions-page').getByRole('button', { name: '+ CONDITION' }).click();
  await page.getByRole('region', { name: 'New condition condition' }).getByRole('textbox', { name: 'NAME' }).fill('Burning');
  const burning = page.getByRole('region', { name: 'Burning condition' });
  await burning.getByRole('combobox', { name: 'ENDS' }).selectOption('rounds');
  await burning.getByRole('textbox', { name: 'Rounds' }).fill('3');
  await burning.getByRole('button', { name: '+ EACH TURN' }).click();
  await expect(burning.getByRole('note', { name: 'Each turn 1 in words' })).toHaveText('BURNING: 1d4 DAMAGE at the start of its turn, onto the token');

  // POISONED: a save at the end of its turn, rolled by the player, off on 13 or more.
  await list.getByRole('button', { name: 'POISONED' }).click();
  const poisoned = page.getByRole('region', { name: 'Poisoned condition' });
  await poisoned.getByRole('button', { name: '+ EACH TURN' }).click();
  await poisoned.getByRole('combobox', { name: 'Each turn 1 when' }).selectOption('turn_end');
  await poisoned.getByRole('combobox', { name: 'Each turn 1 does' }).selectOption('roll_to_end');
  await poisoned.getByRole('textbox', { name: 'Each turn 1 roll' }).fill('d20 + @con_mod');
  await poisoned.getByRole('textbox', { name: 'Each turn 1 ends on' }).fill('13');
  await poisoned.getByRole('group', { name: 'Each turn 1 rolled by' }).getByRole('button', { name: 'THE PLAYER · THE GM FOR AN NPC' }).click();
  await expect(poisoned.getByRole('note', { name: 'Each turn 1 in words' }))
    .toHaveText('POISONED: a save, d20 + Con mod, at the end of its turn, the player (the GM for an NPC) asked to roll; off on 13 or more');

  // STUNNED: AT THE END OF ITS NEXT TURN.
  await list.getByRole('button', { name: 'STUNNED' }).click();
  await page.getByRole('region', { name: 'Stunned condition' }).getByRole('combobox', { name: 'ENDS' }).selectOption('next_turn');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.conditions).toEqual({
    new_condition: { name: 'Burning', ends: 'rounds', rounds: 3, each_turn: [{ when: 'turn_start', does: 'damage', roll: '1d4' }] },
    poisoned: { each_turn: [{ when: 'turn_end', does: 'roll_to_end', roll: 'd20 + @con_mod', ends_on: 13, rolled_by: 'player' }] },
    stunned: { ends: 'next_turn' },
  });

  // Kept: a reload finds each as made.
  await page.reload();
  await openIt();
  await list.getByRole('button', { name: 'POISONED' }).click();
  const again = page.getByRole('region', { name: 'Poisoned condition' });
  await expect(again.getByRole('combobox', { name: 'Each turn 1 does' })).toHaveValue('roll_to_end');
  await expect(again.getByRole('textbox', { name: 'Each turn 1 ends on' })).toHaveValue('13');
  await expect(again.getByRole('group', { name: 'Each turn 1 rolled by' }).getByRole('button', { name: 'THE PLAYER · THE GM FOR AN NPC' })).toHaveAttribute('aria-pressed', 'true');
  await list.getByRole('button', { name: 'STUNNED' }).click();
  await expect(page.getByRole('region', { name: 'Stunned condition' }).getByRole('combobox', { name: 'ENDS' })).toHaveValue('next_turn');
});
