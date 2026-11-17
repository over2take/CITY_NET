import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, runningSystem, approvedPlayer, sheetTab, asGm } from './helpers';

// The standalone sheet tab is the window (8s1a; the user, 2026-11-15: "they should be identical"): opened with ⧉ from
// SHEET.EXE, it is drawn in the player's theme, WEAR on a line of gear works there and the window shows it, and a
// weapon's DAMAGE rolls from it into the log.

test('the sheet in a new tab: in the theme, WEAR and a DAMAGE ROLL work there as in SHEET.EXE, the roll thrown in the main app\'s tray (8s1a, 8s1b)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Tabhold${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [
        { id: 'gear', label: 'GEAR', one: 'Gear', columns: [] },
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] },
      ],
      list: [
        { id: 'boots', label: 'Boots of Quiet', features: [{ id: 'quiet', label: 'Quiet Step', text: 'Hush.' }] },
        { id: 'club', label: 'Club', type: 'weapons', values: { damage: '1d6' } },
      ],
    },
  });
  const player = { username: `e2e_tabbed${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Might', { exact: true }).fill('12');
  await expect.poll(async () => (await sheetOf()).might, { timeout: 15_000 }).toBe(12);

  // Two lines, made in the window: the boots and the club.
  await sheetTab(mine, 'GEAR');
  await mine.getByRole('region', { name: 'GEAR gear' }).getByRole('button', { name: 'Add a Gear by hand' }).click();
  await mine.getByLabel('Item 1 name', { exact: true }).fill('Boots of Quiet');
  await mine.getByRole('region', { name: 'WEAPONS gear' }).getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await mine.getByLabel('Item 2 name', { exact: true }).fill('Club');
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]')).length, { timeout: 15_000 }).toBe(2);

  // ⧉ opens the tab.
  const [tab] = await Promise.all([context.waitForEvent('page'), mine.getByRole('button', { name: 'Open in new tab' }).click()]);
  await tab.waitForLoadState();
  await expect(tab.getByText(`CHARACTER_SHEET // ${player.username.toUpperCase()}`)).toBeVisible({ timeout: 15_000 });
  // Inside the theme, as the app is, so what floats takes its colors.
  await expect(tab.locator('.crt-container')).toHaveCount(1);
  await sheetTab(tab, 'GEAR');

  // WEAR from the tab: it works, and the window says so too.
  const tabBoots = tab.getByTestId('gear-item-boots');
  await expect(tabBoots.getByRole('button', { name: 'WEAR Boots of Quiet' })).toBeEnabled({ timeout: 15_000 });
  await tabBoots.getByRole('button', { name: 'WEAR Boots of Quiet' }).click();
  await expect(tabBoots.getByRole('note', { name: 'Boots of Quiet: what it is doing' })).toHaveText('WORKING', { timeout: 15_000 });
  await expect(mine.getByTestId('gear-item-boots').getByRole('note', { name: 'Boots of Quiet: what it is doing' })).toHaveText('WORKING', { timeout: 15_000 });

  // The club's DAMAGE rolled from the tab: in the log, said on the tab once the dice have landed.
  await tab.getByRole('region', { name: 'WEAPONS gear' }).getByRole('button', { name: 'Roll Item 2 DAMAGE' }).click();
  // Thrown in the main app's dice tray (8s1b): the tab has none of its own.
  await expect(mine.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(tab.getByText(/^⌁ .* rolled Club DAMAGE 1d6 \[\d = \d\]$/)).toBeVisible({ timeout: 20_000 });
  await context.close();
});
