import { test, expect } from '@playwright/test';
import { readFile } from 'fs/promises';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// Uploading items (8aL3b; approved mockup docs/mockups/items-layout.html, 2026-11-14, section 5): DOWNLOAD EXAMPLE gives a
// file made from the system, a section per type with its own columns; edited, pasted into IMPORT and PREVIEWed, a row
// with a mistake is named by its line; APPLY puts the rest into the draft, saved as made.

test('IMPORT on ITEMS: the example made from the system, edited and imported, a mistake skipped by its line, saved (8aL3b)', async ({ page, request }, info) => {
  const name = `Crateford ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: { types: [
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
    ] } } });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'ITEMS');
  await page.getByRole('tablist', { name: 'Items' }).getByRole('tab', { name: 'ITEMS', exact: true }).click();

  // DOWNLOAD EXAMPLE: made from this system, WEAPONS with its DAMAGE and GRADE.
  const files = page.getByRole('group', { name: 'Items from a file' });
  const [download] = await Promise.all([page.waitForEvent('download'), files.getByRole('button', { name: 'DOWNLOAD EXAMPLE' }).click()]);
  expect(download.suggestedFilename()).toBe(`crateford-${info.retry + 1}-items-example.csv`);
  const example = await readFile((await download.path())!, 'utf8');
  expect(example).toContain('[weapons]\nname, damage, grade, needs, words\nSample Weapon, 1d8 + @might, LIGHT, worn,');

  // Edited: the sample weapon named, and a row with a GRADE the column hasn't.
  const edited = example.replace('Sample Weapon, 1d8 + @might', 'Hand Crossbow, 1d6 + @might')
    .replace('\n[features]\n', '\nBad Bow, 1d4, MEDIUM, worn,\n\n[features]\n');
  await files.getByRole('button', { name: 'IMPORT' }).click();
  const panel = page.getByRole('region', { name: 'Import items' });
  await panel.getByRole('textbox', { name: 'Text to import' }).fill(edited);
  await panel.getByRole('button', { name: 'PREVIEW' }).click();
  const shown = panel.getByRole('status', { name: 'Preview' });
  await expect(shown.getByRole('group', { name: 'NEW ITEMS' })).toContainText('HAND CROSSBOW · WEAPON');
  await expect(shown.getByRole('group', { name: 'SKIPPED, NOTHING FROM THESE LINES GOES IN' })).toContainText('Bad Bow: GRADE is LIGHT or HEAVY, not MEDIUM');
  await panel.getByRole('button', { name: /^APPLY \d+ CHANGES, SKIP 1 LINE$/ }).click();
  await expect(page.getByRole('status', { name: 'Import' })).toContainText('1 LINE SKIPPED');
  await expect(page.getByRole('region', { name: 'Items', exact: true }).getByRole('group', { name: 'WEAPONS items' }).getByRole('button', { name: /^Hand Crossbow/ })).toBeVisible();

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  const list = saved.draft.items.list as { label: string; type?: string; values?: Record<string, unknown> }[];
  expect(list.find((i) => i.label === 'Hand Crossbow')).toMatchObject({ type: 'weapons', values: { damage: '1d6 + @might', grade: 'LIGHT' } });
  expect(list.some((i) => i.label === 'Bad Bow')).toBe(false);
});
