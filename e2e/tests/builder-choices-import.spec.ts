import { test, expect } from '@playwright/test';
import { readFile } from 'fs/promises';
import { signInAsGm, signInAsPlayer, openBuilder, builderPage, gmToken, asGm, approvedPlayer, sheetTab } from './helpers';

// IMPORT on a CHOICES list (choices import 2; approved mockup docs/mockups/choices-import.html,
// 2026-10-28): the GM downloads the list as it is, adds a class and a feature to the file, with one
// line wrong, and uploads it. PREVIEW warns of the wrong line by number and its link selects it;
// APPLY puts the rest into the draft, the feature already there keeping its modifier. Published, a
// player finds the new class and feature on their sheet.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect', min: 1, max: 18 }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20'] },
  choices: [{
    id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true,
    options: [{ id: 'soldier', label: 'Soldier', description: 'Holds the line.', features: [
      { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
    ] }],
  }],
});

test('a list downloaded, changed and imported, warned of its one wrong line, and played', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const name = `Imported Keep${again}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: definition(name) });

  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');
  await page.getByRole('region', { name: 'Classes list' }).getByRole('button', { name: 'IMPORT' }).click();
  const panel = page.getByRole('region', { name: 'Import Classes' });

  // DOWNLOAD THIS LIST: the list as it is, the modifier a note.
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'DOWNLOAD THIS LIST' }).click()]);
  expect(download.suggestedFilename()).toBe(`imported-keep${again.replace('_', '-')}-classes.csv`);
  const list = await readFile(await download.path(), 'utf8');
  expect(list).toContain('\n# Soldier · Guard Stance also has modifiers, set in the builder\nSoldier, Guard Stance, 1, , , \n');

  // A class and a feature added; one feature's rest isn't one of the system's.
  const changed = `${list.replace('\n\n[features]\n', '\nMage, Reads the weave., @int >= 13\n\n[features]\n')}Soldier, Rally, 2, Steady the line., 2, Short rest\nMage, Ward, 1, , 1, Dawn\n`;
  const wrong = changed.split('\n').findIndex((l) => l.endsWith(', Dawn')) + 1;
  await panel.getByLabel('File to import').setInputFiles({ name: 'classes.csv', mimeType: 'text/csv', buffer: Buffer.from(changed) });
  await expect(panel.getByRole('textbox', { name: 'Text to import' })).toHaveValue(changed);

  // PREVIEW: the wrong line named, its link selecting it; the rest to apply.
  await panel.getByRole('button', { name: 'PREVIEW' }).click();
  const warning = panel.getByRole('status', { name: 'Preview' }).getByRole('alert');
  await expect(warning).toContainText('1 LINE HAS A MISTAKE AND WILL BE SKIPPED');
  await warning.getByRole('button', { name: `Go to line ${wrong}` }).click();
  expect(await panel.getByRole('textbox', { name: 'Text to import' }).evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('Mage, Ward, 1, , 1, Dawn');
  await expect(panel.getByTestId('import-gutter').locator('[data-bad]')).toHaveText([`!${wrong}`]);
  await expect(panel.getByRole('group', { name: 'NEW CLASSES' })).toContainText('MAGE · REQUIRES @int >= 13');
  await expect(panel.getByRole('group', { name: 'NEW FEATURES' })).toContainText('SOLDIER · RALLY · LEVEL 2 · 2 USES, SHORT REST');

  // APPLY: into the draft, said so, and saved with it.
  await panel.getByRole('button', { name: 'APPLY 2 CHANGES, SKIP 1 LINE' }).click();
  const classes = page.getByRole('region', { name: 'Classes list' });
  await expect(classes.getByRole('status')).toHaveText('APPLIED · 2 CHANGES IN THE DRAFT, 1 LINE SKIPPED · SAVED WITH IT, LIVE ON PUBLISH');
  await expect(classes.getByRole('group', { name: 'Options' }).getByRole('button')).toHaveText(['SOLDIER', 'MAGE']);
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.choices[0].options).toEqual([
    { id: 'soldier', label: 'Soldier', description: 'Holds the line.', features: [
      { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
      { id: 'rally', label: 'Rally', at: 2, text: 'Steady the line.', uses: { count: '2', refill: 'short_rest' } },
    ] },
    { id: 'mage', label: 'Mage', description: 'Reads the weave.', requires: '@int >= 13', features: [] },
  ]);

  // Published: a player finds the new class and the new feature on their sheet.
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: id });
  const player = { username: `e2e_importee${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const playerPage = await context.newPage();
  await signInAsPlayer(playerPage, player);
  await playerPage.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await playerPage.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(playerPage, 'CHARACTER');
  const block = playerPage.getByRole('region', { name: 'Classes' });
  const pick = block.getByRole('group', { name: 'Pick a Class' });
  await expect(pick.getByText('NEEDS INTELLECT >= 13')).toBeVisible();
  await pick.getByRole('button', { name: 'SOLDIER' }).click();
  const soldier = block.getByRole('group', { name: 'Soldier' });
  await expect(soldier.getByText('NEXT · LV 2: Rally')).toBeVisible();
  await soldier.getByRole('button', { name: 'Soldier level up' }).click();
  await expect(soldier.getByRole('group', { name: 'Rally uses' }).getByText('2 OF 2 · SHORT REST')).toBeVisible();
  await context.close();
});
