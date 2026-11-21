import { test, expect } from '@playwright/test';
import { readFile } from 'fs/promises';
import { signInAsGm, gmToken, runningSystem, openGameSystem } from './helpers';

// A catalogue section per item type (8a7a1; mockup docs/mockups/item-types-in-shops.html, answered 2026-11-20): in a game
// with a GUNS type, DOWNLOAD EXAMPLE has a [GUNS] section in its columns; a file with a good gun, one whose AMMO is "six" and
// one with columns left blank previews as GUNS ×2, the bad one said, the blanks noted; saved, DOWNLOAD CURRENT has both guns
// back with their columns.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'guns', label: 'GUNS', one: 'Gun', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' },
      { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' },
      { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
    ] }],
    list: [],
  },
});

test('a GUNS section: in the example, previewed with a bad line and blanks, saved, and back in DOWNLOAD CURRENT (8a7a1)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Typeshelf${again}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();

  // The example: a [GUNS] section in its own columns, a sample line behind a #.
  const [example] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOWNLOAD EXAMPLE', exact: true }).click()]);
  const shape = await readFile(await example.path(), 'utf8');
  expect(shape).toMatch(/^\[GUNS\]$/m);
  expect(shape).toMatch(/^name\s*, price, damage, ammo, grade, description$/m);

  await page.getByLabel('Catalogue text').fill([
    '[GUNS]',
    'name, price, damage, ammo, grade',
    'Pistol, 250, 2d6 + @might, 6, light',
    'Hand Cannon, 1200, 3d6, six, HEAVY',
    'Blank Gun, 10, 1d4, , ',
  ].join('\n'));
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText('2 ROWS READ · 1 PROBLEM')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^GUNS ×2/)).toBeVisible();
  await expect(page.getByText('LINE 4 [GUNS] Hand Cannon: AMMO "six": How many it holds: 0 to 1000')).toBeVisible();
  await expect(page.getByTestId('catalogue-note')).toHaveText('LINE 5 [GUNS] Blank Gun: AMMO, GRADE left blank, kept; the player can fill it in');

  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText('Saved: GUNS ×2. The shops have it now.')).toBeVisible({ timeout: 15_000 });

  // What is on sale now: both guns, every column as saved.
  const [current] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOWNLOAD CURRENT', exact: true }).click()]);
  const now = await readFile(await current.path(), 'utf8');
  expect(now).toMatch(/^Pistol\s*, 250\s*, 2d6 \+ @might, 6\s*, LIGHT/m);
  expect(now).toMatch(/^Blank Gun\s*, 10\s*, 1d4/m);
  expect(now).not.toMatch(/Hand Cannon/);
});
