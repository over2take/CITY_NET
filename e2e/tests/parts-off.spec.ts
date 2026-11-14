import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, openGameSystem, sheetTab } from './helpers';

// Parts switched off, at the table (coverage family 3, e2e/COVERAGE.md; the parts from 3b, approved
// mockup docs/mockups/builder-words-features.html): a custom system running with every part on shows
// each one's controls to its player and its GM; a new version with them off hides every one; switched
// back on, they all return (off only hides, nothing is deleted). The parts that only built-in games
// have (vehicles, cyberware, death saves, luck, XP awards) have nothing to hide at a custom table.

const PARTS_OFF = ['bank', 'shops', 'initiative', 'combat', 'token_health', 'sheet_import', 'give_items'];
const definition = (name: string, off: string[] = []) => ({
  format: 1,
  name,
  core: { health: { model: 'pool' } },
  ...(off.length ? { parts: Object.fromEntries(off.map((p) => [p, { on: false }])) } : {}),
});

/** What a part shows the player: the rail, their character's controls, their sheet. */
const playerSees = async (page: Page, on: boolean) => {
  const shown = (locator: ReturnType<Page['getByRole']>) => (on ? expect(locator).toBeVisible() : expect(locator).toHaveCount(0));
  await shown(page.getByRole('button', { name: 'CITY_NET // BANK', exact: true }));
  await shown(page.getByRole('button', { name: 'HIT_POINTS', exact: true }));
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await shown(page.getByText('MAX HEALTH', { exact: true }));
  await shown(page.getByText(/^ARMOR(_CLASS)?$/));
  await shown(page.getByRole('button', { name: 'SAVE_STATS', exact: true }));
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await shown(page.getByRole('button', { name: 'IMPORT', exact: true }));
};

/** What a part shows the GM: the initiative tracker on the rail, and the GAME tab's money and items. */
const gmSees = async (page: Page, on: boolean) => {
  const shown = (locator: ReturnType<Page['getByRole']>) => (on ? expect(locator).toBeVisible() : expect(locator).toHaveCount(0));
  await shown(page.getByRole('button', { name: 'INITIATIVE_TRACKER', exact: true }));
  await openGameSystem(page);
  // The tab itself, so a hidden part is told apart from a tab that never opened.
  await expect(page.getByRole('button', { name: /TTRPG_SYSTEM$/ })).toBeVisible();
  await shown(page.getByRole('button', { name: 'PAY_PLAYERS', exact: true }));
  await shown(page.getByRole('button', { name: 'GIVE_ITEM', exact: true }));
  // SHOP_BUY_BACK (in the system's word for a shop): its box, as its label holds a hint too.
  await shown(page.locator('#buyback-pct'));
};

test('every part a custom table shows, hidden while off and back when on', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const name = `Parted Keep${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, definition(name));
  const player = { username: `e2e_parted${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const playerPage = await context.newPage();

  /** A new version of the system, published, and both screens opened fresh on it. */
  const publish = async (off: string[]) => {
    await asGm(request, gm, 'put', `/api/systems/${id}/draft`, { definition: definition(name, off) });
    await asGm(request, gm, 'post', `/api/systems/${id}/publish`);
  };
  const fresh = async () => {
    await page.goto('/');
    await signInAsGm(page);
    await playerPage.goto('/');
    await signInAsPlayer(playerPage, player);
  };

  // Every part on: each shows.
  await fresh();
  await playerSees(playerPage, true);
  await gmSees(page, true);

  // Off: each hidden, for the player and the GM.
  await publish(PARTS_OFF);
  await fresh();
  await playerSees(playerPage, false);
  await gmSees(page, false);

  // Shops alone off: the buy-back rate goes, the money stays.
  await publish(['shops']);
  await page.goto('/');
  await signInAsGm(page);
  await openGameSystem(page);
  await expect(page.getByRole('button', { name: 'PAY_PLAYERS', exact: true })).toBeVisible();
  await expect(page.locator('#buyback-pct')).toHaveCount(0);

  // Back on: each returns.
  await publish([]);
  await fresh();
  await playerSees(playerPage, true);
  await gmSees(page, true);
  await context.close();
});
