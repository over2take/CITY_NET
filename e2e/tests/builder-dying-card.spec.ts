import { test, expect } from '@playwright/test';
import { signInAsGm, gmToken, runningSystem, asGm, openBuilder, builderPage } from './helpers';

// The RULE LIBRARY's dying card (8c2; approved mockup docs/mockups/rule-library.html, 2026-11-26). The GM switches WHEN
// HEALTH RUNS OUT on (D&D 5E to start), picks CYBERPUNK RED (under the system's BODY, harder each save), makes it TURNS LEFT
// with four turns, ticks ENEMY NPCS, sets STABILIZE (HEAL vs 8 + @turns, BACK WITH 1 HP, FRAIL, dead at once down again, 8c4b1),
// and finds PARTS' DEATH SAVES on with it. Saved as the server checks it.

test('RULE LIBRARY: the dying card switched on, a preset picked and changed, WHO GOES DOWN ticked; PARTS\' DEATH SAVES the same switch (8c2)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Dyingfall${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, {
    format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'body', label: 'Body' }, { id: 'heal', label: 'Heal' }] }],
    // A HEAL to roll and a FRAIL to get, for STABILIZE (8c4b1).
    rolls: [{ id: 'check', label: 'Check', dice: [{ count: '1', sides: 20 }], add: '@this', by: ['heal'] }],
    conditions: { frail: { name: 'Frail' } },
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const systemCard = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  await expect(systemCard).toBeVisible();
  if (!(await systemCard.getByText('OPEN NOW', { exact: true }).first().isVisible())) {
    if (!(await systemCard.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await systemCard.getByRole('button').first().click();
    await systemCard.getByRole('button', { name: 'OPEN', exact: true }).click();
  }
  await builderPage(page, 'RULE LIBRARY');
  const card = page.getByRole('region', { name: 'When health runs out' });
  const sw = card.getByRole('switch', { name: 'When health runs out' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  const presets = card.getByRole('group', { name: 'Presets' });
  await expect(presets.getByRole('button', { name: 'D&D 5E' })).toHaveAttribute('aria-pressed', 'true');

  await presets.getByRole('button', { name: 'CYBERPUNK RED' }).click();
  await expect(card.getByRole('textbox', { name: 'The save\'s target' })).toHaveValue('@body');
  await expect(card.getByLabel('GETS HARDER', { exact: true })).toHaveValue('1');
  await card.getByRole('group', { name: 'How it goes' }).getByRole('button', { name: 'TURNS LEFT' }).click();
  const turns = card.getByLabel('TURNS LEFT', { exact: true });
  await turns.fill('4');
  await expect(presets.getByRole('button', { name: 'CYBERPUNK RED' })).toHaveAttribute('aria-pressed', 'false');
  await card.getByRole('button', { name: 'ENEMY NPCS' }).click();
  // STABILIZE (8c4b1): HEAL vs 8 + @turns, BACK WITH 1 HP, FRAIL, dead at once down again.
  const stabilize = card.getByRole('region', { name: 'Stabilize' });
  await stabilize.getByLabel('THE HELPER ROLLS', { exact: true }).selectOption('heal');
  await stabilize.getByLabel('VS', { exact: true }).fill('8 + @turns');
  await stabilize.getByRole('group', { name: 'Then they are' }).getByRole('button', { name: 'BACK WITH 1 HP' }).click();
  await stabilize.getByLabel('AND GET', { exact: true }).selectOption('frail');
  await stabilize.getByRole('switch', { name: 'Dead at once down again with it' }).click();
  await expect(stabilize).toContainText('DEAD AT ONCE');
  await expect(card.getByRole('button', { name: 'ENEMY NPCS' })).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.dying).toMatchObject({ word: 'MORTALLY WOUNDED', way: 'turns', turns: 4, harder: 1, save: { dice: '1d10', way: 'under', target: '@body' }, npcs: { friendly: false, enemy: true },
    stabilize: { field: 'heal', vs: '8 + @turns', then: 'back_up', gets: 'frail', again: true } });

  // PARTS' DEATH SAVES is the same switch: on, and turned off there the card is off.
  await builderPage(page, 'PARTS');
  const row = page.getByTestId('part-death');
  await expect(row.getByRole('switch', { name: 'DEATH SAVES' })).toHaveAttribute('aria-checked', 'true');
  await row.getByRole('switch', { name: 'DEATH SAVES' }).click();
  await row.getByRole('button', { name: 'RULE LIBRARY ▸' }).click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const off = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(off.draft.parts).toEqual({ death: { on: false } });
  expect(off.draft.dying.turns).toBe(4);
});
