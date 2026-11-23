import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm, runningSystem } from './helpers';

// The game's own shops on FEATURES (8a7b3b; approved mockup docs/mockups/types-in-shops.html, section 4). A running game
// with an Apothecary selling its POTIONS, one building an Apothecary. By clicks on PARTS · SHOPS: the Apothecary says what
// it sells and that one building is one; a Fence made by + NEW SHOP and set to buy ANYTHING; the General Store too; the
// Apothecary renamed, then deleted, the question naming its building. Saved as made; published, the building goes back to
// its ordinary type.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  buildings: { shops: [{ id: 'apothecary', name: 'Apothecary' }] },
  items: { types: [{ id: 'potions', label: 'POTIONS', one: 'Potion', sold_at: ['apothecary'], columns: [] }], list: [] },
});

test('FEATURES: the Apothecary\'s row, a Fence made to buy ANYTHING, the General Store too, the Apothecary renamed and deleted; published, its building back to NONE (8a7b3b)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Ownshopfall${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, SYSTEM(name));
  const made = await asGm(request, gm, 'post', '/api/locations', { name: `OWNSHOPFALL_STALL${again.trim()}`, description: '', shape: 'box', x: 20, y: 0, z: 20, width: 2, height: 2, depth: 2 });
  const stall = made.data[0].id;
  const typed = await request.patch(`/api/locations/${stall}/building-type`, { data: { building_type: 'apothecary' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);
  const typeOfStall = async () => (await asGm(request, gm, 'get', '/api/locations')).find((l: { id: number }) => l.id === stall)?.building_type;
  expect(await typeOfStall()).toBe('apothecary');

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  // The builder opens on the running game by itself (OPEN NOW); otherwise, its card opened.
  await expect(card).toBeVisible();
  if (!(await card.getByText('OPEN NOW', { exact: true }).first().isVisible())) {
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  }
  await builderPage(page, 'PARTS');
  await page.getByTestId('part-shops').getByRole('button', { name: /SETTINGS/ }).click();
  const shops = page.getByRole('region', { name: 'Shop buildings' });

  // The Apothecary at the foot: what it sells, and the one building it is in this game.
  const apothecary = shops.getByTestId('own-shop-apothecary');
  await expect(apothecary).toContainText('sells POTIONS · 1 building');

  // + NEW SHOP: a Fence, set to buy ANYTHING; the General Store too.
  await shops.getByRole('textbox', { name: 'New shop name' }).fill('Fence');
  await shops.getByRole('textbox', { name: 'New shop name' }).press('Enter');
  const fence = shops.getByTestId('own-shop-fence');
  await fence.getByRole('combobox', { name: 'Fence buys' }).selectOption('anything');
  await expect(fence).toContainText('sells nothing · buys anything · no building');
  await shops.getByRole('combobox', { name: 'General Store buys' }).selectOption('anything');

  // The Apothecary renamed, then deleted: the question names its building.
  await apothecary.getByRole('textbox', { name: 'Apothecary called' }).fill('Herbalist');
  await apothecary.getByRole('button', { name: 'Delete Herbalist' }).click();
  const ask = shops.getByRole('group', { name: 'Delete Herbalist?' });
  await expect(ask).toContainText('1 building is one in this game: it goes back to its ordinary type once you publish.');
  await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
  await expect(shops.getByTestId('own-shop-apothecary')).toHaveCount(0);

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.buildings).toEqual({ types: { general_store: { buys: 'anything' } }, shops: [{ id: 'fence', name: 'Fence', buys: 'anything' }] });
  expect(saved.draft.items.types[0].sold_at).toEqual([]);

  // Published: the stall is no Apothecary any more, its ordinary type (none) again.
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);
  await expect.poll(typeOfStall, { timeout: 15_000 }).toBeNull();
});
