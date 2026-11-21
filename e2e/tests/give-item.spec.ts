import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, runningSystem, approvedPlayer } from './helpers';
import { ITEMS_SYSTEM, playerToken, sheetOf, inventoryOf, saveItemsCatalogue } from './shops';

// GIVE.EXE at the table, a safety net before 8a7 changes what GIVE carries (8n2). A custom system's catalogue with its ring
// and a rope; the GM gives a player the ring, then two ropes, from the GAME tab's GIVE_ITEM: picked in ITEMS, the player
// ticked in TO, GIVE. Free, and on their sheet as bought ones are: the ring the item it is, to WEAR and ATTUNE; listed in GIVEN.

test('GIVE.EXE: a ring and two ropes given to a player, free, on their sheet as bought ones are, listed in GIVEN (8n2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, ITEMS_SYSTEM(`Giftfall${again}`));
  const player = { username: `e2e_giftfall${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);

  // The player's character, made as a player makes it: their sheet opened once.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await saveItemsCatalogue(page, { 'Ring of Might': 500 }, 'Rope, 5, , Fifty feet of it.\n');
  await page.getByRole('button', { name: 'GIVE_ITEM', exact: true }).click();
  const give = page.locator('.win95-window', { has: page.getByText('GIVE.EXE', { exact: true }) });
  // Its folders, ITEMS, TO and GIVEN (a catalogue chip is called ITEMS too).
  const folder = (name: string | RegExp) => give.getByRole('tablist', { name: 'Folders' }).getByRole('tab', { name });

  /** One thing given: found in ITEMS, `qty` of it, the player ticked in TO, GIVE, and said so. */
  const giveOne = async (name: string, qty: number) => {
    await folder('ITEMS').click();
    await give.getByLabel('Search every catalogue').fill(name);
    await give.getByRole('table', { name: 'Items' }).getByRole('button', { name: `Give ${name}` }).first().click({ timeout: 15_000 });
    await folder('TO').click();
    for (let i = 1; i < qty; i++) await give.getByRole('button', { name: 'One more' }).click();
    const who = give.getByRole('checkbox', { name: new RegExp(player.username, 'i') });
    if (!(await who.isChecked())) await who.check();
    await give.getByRole('button', { name: `GIVE ${qty} × ${name.toUpperCase()} TO 1` }).click();
    await expect(give.getByRole('status')).toContainText(player.username.toUpperCase(), { timeout: 15_000 });
  };
  await giveOne('Ring of Might', 1);
  await giveOne('Rope', 2);

  // On the sheet, as bought ones are: the ring the item it is.
  await expect.poll(() => inventoryOf(request, gm, player.username), { timeout: 15_000 }).toEqual([['Ring of Might', 1], ['Rope', 2]]);
  const worked = (await sheetOf(request, gm, player.username))._worked as { items?: { id: string }[] };
  expect(worked.items?.map((i) => i.id)).toEqual(['ring']);

  // GIVEN lists both, newest first.
  await folder(/^GIVEN/).click();
  const given = give.getByRole('table', { name: 'Given' });
  await expect(given.getByRole('row').filter({ hasText: 'Rope' })).toHaveCount(1);
  await expect(given.getByRole('row').filter({ hasText: 'Ring of Might' })).toHaveCount(1);
  await context.close();
});
