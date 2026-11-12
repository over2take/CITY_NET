import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Items installed at the table (7e4c; approved mockup docs/mockups/installed.html, 2026-11-11, and the user's calls): a
// gear line of an implant gets INSTALL, the player's or the GM's. Installed, it works, its cost counts on Strain (named by
// it on the stat), and its line is locked; past Might's limit a player can't, and the GM installs anyway; REMOVE gives the
// cost back.

test('INSTALL on GEAR: Strain counted, the line locked, past the limit the GM\'s INSTALL ANYWAY, REMOVE (7e4c)', async ({ browser, page, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Implantfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'strain', label: 'Strain' }] }],
    items: {
      installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'strain', limit: '@might' }],
      list: [
        { id: 'jack', label: 'Cranial Jack', needs: 'cyberware', cost: 1, features: [] },
        { id: 'plating', label: 'Dermal Plating', needs: 'cyberware', cost: 2, features: [] },
      ],
    },
  });
  const player = { username: `e2e_implanted${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Might', { exact: true }).fill('2');
  await mine.getByLabel('Strain', { exact: true }).fill('0');
  await expect.poll(async () => (await sheetOf()).might, { timeout: 15_000 }).toBe(2);

  await sheetTab(mine, 'GEAR');
  for (const [n, name] of [[1, 'Cranial Jack'], [2, 'Dermal Plating']] as const) {
    await mine.getByRole('button', { name: '+ ITEM', exact: true }).click();
    await mine.getByLabel(`Item ${n} name`, { exact: true }).fill(name);
  }
  const counter = mine.getByRole('group', { name: 'CYBERWARE installs' });
  const jack = mine.getByTestId('gear-item-jack');
  const plating = mine.getByTestId('gear-item-plating');
  await expect(counter).toHaveText('CYBERWARE · STRAIN 0 OF 2', { timeout: 15_000 });
  await expect(jack.getByText('CYBERWARE · COSTS 1 STRAIN')).toBeVisible();

  // Installed: working, the cost counted, the line locked.
  await jack.getByRole('button', { name: 'INSTALL Cranial Jack' }).click();
  await expect(jack.getByRole('note', { name: 'Cranial Jack: what it is doing' })).toHaveText('WORKING', { timeout: 15_000 });
  await expect(counter).toHaveText('CYBERWARE · STRAIN 1 OF 2');
  await expect(mine.getByRole('button', { name: 'Remove item 1' })).toBeDisabled();
  await expect(mine.getByLabel('Item 1 carried', { exact: true })).toBeDisabled();
  // 1 + 2 is past Might 2: a player can't, and is told why.
  await expect(plating.getByRole('button', { name: 'INSTALL Dermal Plating' })).toBeDisabled();
  await expect(plating.getByRole('note', { name: 'Dermal Plating: what it is doing' })).toHaveText("PAST CYBERWARE'S LIMIT · ONLY YOUR GM CAN");
  await sheetTab(mine, 'STATS');
  await expect(mine.getByTitle('0 → 1 (Cranial Jack +1)')).toBeVisible({ timeout: 15_000 });

  // The GM, on the player's sheet: INSTALL ANYWAY.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'GEAR');
  await page.getByTestId('gear-item-plating').getByRole('button', { name: 'INSTALL ANYWAY Dermal Plating' }).click();
  await sheetTab(mine, 'GEAR');
  await expect(counter).toHaveText('CYBERWARE · STRAIN 3 OF 2', { timeout: 15_000 });
  await expect.poll(async () => (await sheetOf())._worn, { timeout: 15_000 }).toEqual({ jack: { installed: true }, plating: { installed: true, anyway: true } });

  // REMOVE: the cost back at once, the line the player's again.
  await jack.getByRole('button', { name: 'INSTALLED · REMOVE Cranial Jack' }).click();
  await expect(counter).toHaveText('CYBERWARE · STRAIN 2 OF 2', { timeout: 15_000 });
  await expect(jack.getByRole('button', { name: 'INSTALL Cranial Jack' })).toBeDisabled();
  await expect(mine.getByRole('button', { name: 'Remove item 1' })).toBeEnabled();
  await context.close();
});
