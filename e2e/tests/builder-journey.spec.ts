import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, openGameSystem, builderPage, clickRail } from './helpers';

// The builder journey, the GM's half (4l2a; plan row 4l browser-journey): a system built through
// the builder's own screens from + NEW (its words, a part off, a stat and a formula worked out on
// the sample), published, changed and published again through the version preview, and the game
// switched to it. The player's half (a character, GIVE ITEM, a rest) is 4l2b.

test('the GM builds a system, publishes it twice, and switches the game to it', async ({ page }, info) => {
  // A retry runs on the same database as the try before it, so it makes a system of its own name.
  const NAME = info.retry ? `Hearthfall ${info.retry + 1}` : 'Hearthfall';
  await signInAsGm(page);
  await openBuilder(page);

  // + NEW: a blank system, opened on SETUP.
  await page.getByRole('tab', { name: '+ NEW' }).click();
  await page.locator('#systems-new-name').fill(NAME);
  await page.getByRole('button', { name: 'CREATE', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'SETUP', exact: true })).toBeVisible();
  await expect(page.getByTestId('builder-system')).toContainText(NAME.toUpperCase());

  // WORDS: HP is a Wound here.
  await builderPage(page, 'WORDS');
  await page.getByLabel('HP one').fill('Wound');
  await page.getByLabel('HP many').fill('Wounds');
  await expect(page.getByTestId('term-hp')).toContainText('1 WOUND · 3 WOUNDS');

  // FEATURES: no vehicles in this game.
  await builderPage(page, 'FEATURES');
  const vehicles = page.getByRole('switch', { name: 'VEHICLES' });
  await vehicles.click();
  await expect(vehicles).toHaveAttribute('aria-checked', 'false');

  // STATS & RULES: a stat, and a formula worked out from it on the sample character.
  await builderPage(page, 'STATS & RULES');
  await page.getByRole('button', { name: '+ GROUP' }).click();
  await page.getByRole('button', { name: '+ STAT' }).click();
  await page.getByLabel('New stat name').fill('Grit');
  await page.getByLabel('Grit sample').fill('3');
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await page.getByRole('button', { name: '+ FORMULA' }).click();
  await page.getByLabel('New formula name').fill('Toughness');
  await page.getByLabel('Toughness formula').fill('10 + @new_stat');
  await expect(page.getByTestId('value-new_formula')).toHaveText('13');

  // PUBLISH: the first version goes straight through.
  await clickRail(page, 'PUBLISH');
  await expect(page.getByRole('status')).toContainText('Published v1.');
  await expect(page.getByTestId('builder-system')).toContainText('PUBLISHED v1');

  // A change, then PUBLISH again: the version preview first, then v2.
  await builderPage(page, 'WORDS');
  await page.getByLabel('HP one').fill('Scar');
  await page.getByLabel('HP many').fill('Scars');
  await clickRail(page, 'PUBLISH');
  await expect(page.getByText('PUBLISH v2 · WHAT CHANGES FROM v1')).toBeVisible();
  await page.getByRole('button', { name: 'PUBLISH v2', exact: true }).click();
  await expect(page.getByTestId('builder-system')).toContainText('PUBLISHED v2');

  // Back on the map, the game switched to it in TTRPG_SYSTEM's picker.
  await page.getByRole('button', { name: 'Exit the builder and go back to the map' }).click();
  await expect(page.getByRole('main', { name: 'System builder' })).toBeHidden();
  await openGameSystem(page);
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole('option', { name: new RegExp(`^${NAME.toUpperCase()} ?v\\d`) }).click();
  const confirm = page.getByRole('dialog', { name: '!! SWITCH GAME SYSTEM !!' });
  await confirm.getByRole('button', { name: 'SWITCH', exact: true }).click();
  await expect(confirm).toBeHidden();
  // The picker names the game now running, and the version it runs.
  const picker = page.locator('button[aria-haspopup="listbox"]');
  await expect(picker).toContainText(NAME.toUpperCase());
  await expect(picker).toContainText('v2');
});
