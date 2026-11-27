import { test, expect } from '@playwright/test';
import { signInAsGm, gmToken, runningSystem, asGm, openBuilder, builderPage } from './helpers';

// RULE LIBRARY's LUCK card (8c5b; approved mockup docs/mockups/rule-library.html, the LUCK card). The GM switches LUCK on
// (CYBERPUNK RED, THE MOST the system's own LUCK), picks A DICE POOL GAME, makes it ONLY THESE ROLLS with SHOOT, and adds LONG
// REST to REFILLED BY; saved as the server checks it, and PARTS' LUCK on with it.

test("RULE LIBRARY: LUCK switched on, a preset picked and changed; PARTS' LUCK the same switch (8c5b)", async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Luckycard${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, {
    format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'aim', label: 'Aim' }, { id: 'luck', label: 'Luck' }] }],
    rolls: [{ id: 'shoot', label: 'Shoot', dice: [{ count: '2', sides: 6 }], add: '@this', by: ['aim'] }],
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
  const card = page.getByRole('region', { name: 'Luck', exact: true });
  await card.getByRole('switch', { name: 'Luck', exact: true }).click();
  await expect(card.getByRole('group', { name: 'Luck presets' }).getByRole('button', { name: 'CYBERPUNK RED' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('textbox', { name: 'The most luck' })).toHaveValue('@luck');
  await card.getByRole('button', { name: 'A DICE POOL GAME' }).click();
  await card.getByRole('group', { name: 'Luck is on' }).getByRole('button', { name: 'ONLY THESE ROLLS' }).click();
  await card.getByRole('group', { name: "Luck's rolls" }).getByRole('button', { name: 'SHOOT' }).click();
  await card.getByRole('group', { name: 'Refilled by' }).getByRole('button', { name: 'LONG REST' }).click();

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.luck).toEqual({ name: 'EDGE', most: '3', each: 'die', on: ['shoot'], refills: ['long_rest', 'end_of_scene'] });

  await builderPage(page, 'PARTS');
  await expect(page.getByTestId('part-luck').getByRole('switch', { name: 'LUCK' })).toHaveAttribute('aria-checked', 'true');
});
