import { test, expect } from '@playwright/test';
import { signInAsGm, gmToken, runningSystem, asGm, openBuilder, builderPage, openGameSystem } from './helpers';

// What a hit does (8b5b; approved mockup docs/mockups/damage-pipeline.html, answers 3 and 5). On DAMAGE TYPES the GM makes
// IMMUNE work out as WORDS ONLY, switches WORK IT OUT off and picks APPLY DAMAGE AUTO; blanking RESIST's words keeps what it
// works out as. On the GAME tab's HOUSE RULES the table's APPLY DAMAGE and WORK OUT RESISTANCES start as the system says
// and are kept as picked.

test('DAMAGE TYPES: WORKS OUT AS, WORK IT OUT and APPLY DAMAGE saved; the GAME tab\'s own APPLY DAMAGE and WORK OUT RESISTANCES (8b5b)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Applyfall${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, {
    format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    damage: { resist: { means: 'Half.', works_out: 'none' } },
  });
  // A table's choices from an earlier test put back to the system's.
  for (const key of ['apply_damage', 'work_out_resistances']) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  await expect(card).toBeVisible();
  if (!(await card.getByText('OPEN NOW', { exact: true }).first().isVisible())) {
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  }
  await builderPage(page, 'DAMAGE TYPES');
  const game = page.getByRole('region', { name: 'In this game' });
  // As the system has it: RESIST NONE, the rest as they start.
  await expect(game.getByRole('combobox', { name: 'RESIST works out as' })).toHaveValue('none');
  await expect(game.getByRole('combobox', { name: 'VULNERABLE works out as' })).toHaveValue('double');
  await expect(game.getByRole('group', { name: 'Apply damage' }).getByRole('button', { name: 'CONFIRM' })).toHaveAttribute('aria-pressed', 'true');

  await game.getByRole('combobox', { name: 'IMMUNE works out as' }).selectOption('words');
  await game.getByRole('textbox', { name: 'RESIST' }).fill('');
  await game.getByRole('switch', { name: 'Work out resistances' }).click();
  await expect(game).toContainText('Off: every hit is taken as rolled');
  await game.getByRole('group', { name: 'Apply damage' }).getByRole('button', { name: 'AUTO' }).click();
  await expect(game).toContainText('AUTO: a hit is taken off');
  // Not published yet: the page says what the table still uses.
  await expect(game.getByRole('note').filter({ hasText: 'NOT PUBLISHED' })).toHaveText(['NOT PUBLISHED: the table still works them out', 'NOT PUBLISHED: the table still uses CONFIRM']);

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.damage).toEqual({ resist: { works_out: 'none' }, immune: { works_out: 'words' }, work_out: false, apply: 'auto' });

  // The table's own, on the GAME tab: as the running system says to start, kept as picked.
  await page.getByRole('button', { name: 'Exit the builder and go back to the map' }).click();
  await expect(page.getByRole('main', { name: 'System builder' })).toBeHidden();
  await openGameSystem(page);
  await page.getByRole('button', { name: /^HOUSE RULES/ }).click();
  const applyBox = page.getByRole('combobox', { name: 'APPLY DAMAGE' });
  await expect(applyBox).toHaveValue('');
  await expect(applyBox.locator('option:checked')).toHaveText('CONFIRM (SYSTEM\'S)');
  await expect(applyBox.locator('option')).toHaveText(['AUTO', 'CONFIRM (SYSTEM\'S)', 'OFF']);
  await expect(page.getByRole('combobox', { name: 'WORK OUT RESISTANCES' }).locator('option:checked')).toHaveText('ON (SYSTEM\'S)');
  await applyBox.selectOption('off');
  await page.getByRole('combobox', { name: 'WORK OUT RESISTANCES' }).selectOption('0');
  await page.getByRole('button', { name: 'APPLY', exact: true }).click();
  await expect(page.getByText('HOUSE RULES APPLIED')).toBeVisible({ timeout: 15_000 });
  const settings = async () => Object.fromEntries((await asGm(request, gm, 'get', '/api/settings') as { key: string; value: string }[])
    .filter((r) => ['apply_damage', 'work_out_resistances'].includes(r.key)).map((r) => [r.key, r.value]));
  await expect.poll(settings, { timeout: 15_000 }).toEqual({ apply_damage: 'off', work_out_resistances: '0' });
  // Back to the system's (CONFIRM, kept as following it), so no other test meets this table's choice.
  await applyBox.selectOption({ label: 'CONFIRM (SYSTEM\'S)' });
  await page.getByRole('combobox', { name: 'WORK OUT RESISTANCES' }).selectOption({ label: 'ON (SYSTEM\'S)' });
  await page.getByRole('button', { name: 'APPLY', exact: true }).click();
  await expect.poll(settings, { timeout: 15_000 }).toEqual({ apply_damage: '', work_out_resistances: '' });
});
