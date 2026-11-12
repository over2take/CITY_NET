import { test, expect } from '@playwright/test';
import { readFile } from 'fs/promises';
import { signInAsGm, gmToken, runningSystem, openGameSystem } from './helpers';

// A system's items in its shops (7e3c; approved with docs/mockups/items.html, the user's "perfect" of 2026-11-10):
// CATALOGUES.EXE's DOWNLOAD ITEMS starts a catalogue of them, prices to fill in; the preview names the lines that are
// items and the one only nearly named as one; saved, the shops sell the ring, as GIVE.EXE's catalogue shows.

test('DOWNLOAD ITEMS, a price filled in, the preview naming the item and a near miss, saved and on sale (7e3c)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Shopfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
    items: {
      slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
      list: [{ id: 'ring', label: 'Ring of Might', description: 'A heavy iron band.', needs: 'attuned', features: [] }],
    },
  });

  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();

  // The starter file: the ring on the gear's shelf, its price blank.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOWNLOAD ITEMS', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sys_[0-9a-f]{16}-storefronts-items\.csv$/);
  const file = await readFile(await download.path(), 'utf8');
  expect(file).toContain('[gear]');
  expect(file).toMatch(/^Ring of Might\s*,\s*,\s*,\s*A heavy iron band\.$/m);

  // A price filled in, and a line only nearly named as the ring.
  const priced = file.replace(/^Ring of Might\s*,\s*,/m, 'Ring of Might, 500,') + 'Ring of Migt, 5, , A copy\n';
  await page.getByLabel('Catalogue text').fill(priced);
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText('2 ROWS READ')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('catalogue-items')).toHaveText('ITEMS: RING OF MIGHT · bought, each is that item, to WEAR and ATTUNE');
  await expect(page.getByText(/^LINE \d+ \[gear\] Ring of Migt: nearly the item Ring of Might\. Name it exactly to sell that item$/)).toBeVisible();

  // Saved: the shops sell it, at its price.
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText(/^Saved: .* ×2\. The shops have it now\.$/)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'GIVE_ITEM', exact: true }).click();
  const give = page.locator('.win95-window', { has: page.getByText('GIVE.EXE', { exact: true }) });
  await give.getByLabel('Search every catalogue').fill('Ring of Might');
  const rows = give.getByRole('table', { name: 'Items' }).getByRole('row').filter({ hasText: 'Ring of Might' });
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  await expect(rows.filter({ hasText: '500' })).toHaveCount(1);
});
