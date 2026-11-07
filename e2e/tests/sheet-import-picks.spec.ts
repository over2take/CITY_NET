import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Picks on the form (7c6; approved mockup docs/mockups/new-character.html): a sheet uploaded naming its
// class and level comes in with them, a class it doesn't meet comes in as it is, said in the preview, one it
// can't find is left out, said by its line, and a player's upload can't replace a pick locked by a roll.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'wits', label: 'Wits', min: 1, max: 20 }] }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, table: 'd6', options: [
    { id: 'soldier', label: 'Soldier', roll: '1-3' }, { id: 'mage', label: 'Mage', roll: '4-6', requires: '@wits >= 13' },
  ] }],
  creation: { on: true },
});
const preview = async (page: import('@playwright/test').Page, sheet: object) => {
  await page.getByRole('textbox', { name: 'Paste JSON or a stat block' }).fill(JSON.stringify(sheet));
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
};

test('a sheet uploaded with a class comes in with it, and one it doesn\'t meet comes in as it is, said first', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_formpick${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Formfall${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  // The blank form and the JSON template both ask for the list.
  const template = await (await request.get('/api/sheets/import/template.json')).json();
  expect(template.fields).toMatchObject({ pick_classes: '', pick_classes_level: null });
  expect((await request.get('/api/sheets/import/template.pdf')).ok()).toBe(true);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await page.getByRole('tab', { name: 'UPLOAD A SHEET' }).click();
  await page.getByRole('button', { name: 'CHOOSE A SHEET' }).click();

  // One it can't find is said by its line, and nothing is taken of it.
  await preview(page, { name: 'Rook', wits: 5, Class: 'Wizard' });
  await expect(page.getByText("Class: CAN'T FIND Wizard, LEFT OUT")).toBeVisible();
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click();

  // One they don't meet, at a level: said first, then taken as it is.
  await preview(page, { name: 'Rook', wits: 5, Class: 'Mage', 'Class level': 3 });
  await expect(page.getByText('CLASS: MAGE 3, COMING IN AS IT IS: IT NEEDS WITS >= 13')).toBeVisible();
  await page.getByRole('button', { name: /REPLACE SHEET WITH/ }).click();
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true, uploaded: true });
  const data = await stored();
  expect(data._choices.classes).toEqual([{ option: 'mage', level: 3 }]);
  expect(data.wits).toBe(5);
  await sheetTab(page, 'CHARACTER');
  await expect(page.getByRole('region', { name: 'Classes' }).getByRole('group', { name: 'Mage' })).toBeVisible({ timeout: 15_000 });
  await context.close();
});

test('a player\'s upload leaves a class locked by a roll, and says so', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_formlock${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  const system = definition(`Formlockfall${again}`);
  await runningSystem(request, gm, { ...system, creation: undefined, choices: system.choices.map((c) => ({ ...c, options: c.options.map(({ requires: _r, ...o }) => o) })) });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');
  await page.getByLabel('Name', { exact: true }).fill('Wren');
  await expect.poll(async () => (await stored()).name, { timeout: 15_000 }).toBe('Wren');
  await page.getByRole('button', { name: 'ROLL FOR IT' }).click();
  await expect.poll(async () => (await stored())._choices?.classes?.length, { timeout: 15_000 }).toBe(1);
  const [rolled] = (await stored())._choices.classes;
  await page.keyboard.press('Escape');

  const other = rolled.option === 'soldier' ? 'Mage' : 'Soldier';
  await page.getByRole('button', { name: 'IMPORT', exact: true }).click();
  await preview(page, { name: 'Wren', Class: other });
  await expect(page.getByText(`CLASS: ${other.toUpperCase()} 1, NOT TAKEN: THIS CHARACTER'S CLASS IS LOCKED. YOUR GM CAN CLEAR IT.`)).toBeVisible();
  await page.getByRole('button', { name: /REPLACE SHEET WITH/ }).click();
  await expect(page.getByRole('button', { name: '✓ APPLIED' })).toBeVisible({ timeout: 15_000 });
  expect((await stored())._choices.classes).toEqual([rolled]);
  await context.close();
});
