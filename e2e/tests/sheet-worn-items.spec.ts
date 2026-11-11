import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Items at the table (7e3b; approved mockup docs/mockups/items.html, 2026-11-10, and the user's calls): a gear line named
// like an item gets WEAR and ATTUNE. Worn, the ring does nothing until attuned; attuned, CON goes up and the slot fills;
// with every slot taken a player can't attune, and the GM can, anyway; the GM gives this one character their own count;
// END frees the slot; taken off, an item stays attuned.

test('WEAR and ATTUNE on GEAR: the ring counts once attuned, a full slot is the GM\'s to pass, their own count, END (7e3b)', async ({ browser, page, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Attunehold${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
    items: {
      slots: [{ id: 'attuned', label: 'ATTUNED', count: 1 }],
      list: [
        { id: 'ring', label: 'Ring of Might', needs: 'attuned', features: [{ id: 'mighty', label: 'Mighty', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] },
        { id: 'cloak', label: 'Cloak of Warding', needs: 'attuned', features: [{ id: 'warded', label: 'Warded', modifiers: [{ target: 'con', amount: '1' }] }] },
      ],
    },
  });
  const player = { username: `e2e_ringed${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Con', { exact: true }).fill('14');
  await expect.poll(async () => (await sheetOf()).con, { timeout: 15_000 }).toBe(14);

  // Two lines named like the items, stowed: carried.
  await sheetTab(mine, 'GEAR');
  for (const [n, name] of [[1, 'Ring of Might'], [2, 'Cloak of Warding']] as const) {
    await mine.getByRole('button', { name: '+ ITEM', exact: true }).click();
    await mine.getByLabel(`Item ${n} name`, { exact: true }).fill(name);
  }
  const slots = mine.getByRole('group', { name: 'ATTUNED slots' });
  const ring = mine.getByTestId('gear-item-ring');
  const cloak = mine.getByTestId('gear-item-cloak');
  const ringSays = ring.getByRole('note', { name: 'Ring of Might: what it is doing' });
  const cloakSays = cloak.getByRole('note', { name: 'Cloak of Warding: what it is doing' });
  await expect(ringSays).toHaveText('CARRIED', { timeout: 15_000 });
  await expect(slots).toHaveText('ATTUNED 0 OF 1');
  await expect(ring.getByText('NEEDS ATTUNED')).toBeVisible();
  await expect(ring.getByRole('button', { name: 'ATTUNE Ring of Might' })).toBeDisabled();

  // Worn, it does nothing yet; attuned, it works and the slot fills.
  await ring.getByRole('button', { name: 'WEAR Ring of Might' }).click();
  await expect(ringSays).toHaveText('WORN, NOT ATTUNED: DOES NOTHING YET', { timeout: 15_000 });
  await ring.getByRole('button', { name: 'ATTUNE Ring of Might' }).click();
  await expect(ringSays).toHaveText('WORKING', { timeout: 15_000 });
  await expect(slots).toHaveText('ATTUNED 1 OF 1');
  await sheetTab(mine, 'STATS');
  await expect(mine.getByTitle('14 → 16 (Ring of Might +2)')).toBeVisible({ timeout: 15_000 });

  // The cloak, worn with no slot free: nothing to press, and why.
  await sheetTab(mine, 'GEAR');
  await cloak.getByRole('button', { name: 'WEAR Cloak of Warding' }).click();
  await expect(cloakSays).toHaveText('WORN, NOT ATTUNED: DOES NOTHING YET · NO ATTUNED SLOT FREE', { timeout: 15_000 });
  await expect(cloak.getByRole('button', { name: 'ATTUNE Cloak of Warding' })).toBeDisabled();

  // The GM, on their sheet: ATTUNE ANYWAY, then this character's own count.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'GEAR');
  await page.getByTestId('gear-item-cloak').getByRole('button', { name: 'ATTUNE ANYWAY Cloak of Warding' }).click();
  await expect(cloakSays).toHaveText('WORKING', { timeout: 15_000 });
  await expect(slots).toHaveText('ATTUNED 2 OF 1');
  const own = page.getByRole('spinbutton', { name: 'ATTUNED: how many this character has' });
  await own.fill('2');
  await own.press('Enter');
  await expect(slots).toHaveText('ATTUNED 2 OF 2· THEIR OWN (SYSTEM 1)', { timeout: 15_000 });
  await expect.poll(async () => (await sheetOf())._slots, { timeout: 15_000 }).toEqual({ attuned: 2 });

  // END frees the ring's slot, and its +2 goes; the cloak, taken off, stays attuned and does nothing.
  await ring.getByRole('button', { name: 'ATTUNED · END Ring of Might' }).click();
  await expect(ringSays).toHaveText('WORN, NOT ATTUNED: DOES NOTHING YET', { timeout: 15_000 });
  await expect(slots).toHaveText('ATTUNED 1 OF 2· THEIR OWN (SYSTEM 1)');
  await cloak.getByRole('button', { name: 'WORN · TAKE OFF Cloak of Warding' }).click();
  await expect(cloakSays).toHaveText('ATTUNED, NOT WORN: DOES NOTHING', { timeout: 15_000 });
  await expect(slots).toHaveText('ATTUNED 1 OF 2· THEIR OWN (SYSTEM 1)');
  await sheetTab(mine, 'STATS');
  await expect(mine.getByLabel('Con', { exact: true })).toHaveValue('14');
  await expect(mine.getByTitle(/^14 → /)).toHaveCount(0);

  // As the server keeps it.
  expect((await sheetOf())._worn).toEqual({ ring: { worn: true }, cloak: { attuned: true, anyway: true } });
  await context.close();
});
