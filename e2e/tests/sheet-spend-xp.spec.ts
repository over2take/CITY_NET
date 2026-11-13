import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// SPEND XP at the table (7f2c1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): on CHARACTER, XP unspent and
// a BUY beside each thing XP buys. Purchases wait for the GM: the player's BUY sits PENDING, its XP held; the GM, on the
// player's sheet, APPROVES it (Body goes up), UNDOES it (Body back, XP back), and DECLINES another.

test('SPEND XP on CHARACTER: BUY waits for the GM, who APPROVES, UNDOES and DECLINES (7f2c1)', async ({ browser, page, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Buyfall${again}`, core: { health: { model: 'pool' }, advancement: ['spend'] },
    stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'body', label: 'Body' }] }],
    choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'alert', label: 'Alert' }] }],
    spend: { buys: [
      { id: 'attrs_up', what: 'stat', stats: 'attrs', cost: '@new * 5', most: 4 },
      { id: 'feats', what: 'option', list: 'feats', cost: '10' },
    ], wait: true },
  });
  const player = { username: `e2e_buyer${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Body', { exact: true }).fill('2');
  await expect.poll(async () => (await sheetOf()).body, { timeout: 15_000 }).toBe(2);
  // The GM gives them a name and XP.
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { name: 'Wren', _xp: 40 } });
  await sheetTab(mine, 'CHARACTER');
  const unspent = mine.getByRole('status', { name: 'XP unspent' });
  await expect(unspent).toHaveText('XP 40 UNSPENT40 AWARDED · 0 SPENT', { timeout: 15_000 });
  const buys = mine.getByRole('list', { name: 'What XP buys' });
  await expect(buys.getByRole('listitem', { name: 'BODY' })).toContainText('TO 3: 15 XP');

  // The player's BUY waits: XP held, Body as it was.
  await buys.getByRole('button', { name: 'Buy BODY' }).click();
  await expect(unspent).toHaveText('XP 25 UNSPENT40 AWARDED · 0 SPENT · 15 WAITING FOR THE GM', { timeout: 15_000 });
  const spent = mine.getByRole('list', { name: 'Spent' });
  await expect(spent.getByRole('listitem', { name: 'BODY 2 → 3' })).toContainText('PENDING');
  await expect(buys.getByRole('button', { name: 'Buy BODY' })).toBeDisabled();
  await buys.getByRole('button', { name: 'Buy FEAT · ALERT' }).click();
  await expect(spent.getByRole('listitem', { name: 'FEAT · ALERT' })).toContainText('PENDING', { timeout: 15_000 });
  expect((await sheetOf()).body).toBe(2);

  // The GM, on the player's sheet: APPROVE, then UNDO; DECLINE the feat.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');
  const ledger = page.getByRole('list', { name: 'Spent' });
  await ledger.getByRole('listitem', { name: 'BODY 2 → 3' }).getByRole('button', { name: 'APPROVE' }).click();
  await expect.poll(async () => (await sheetOf()).body, { timeout: 15_000 }).toBe(3);
  await expect(spent.getByRole('listitem', { name: 'BODY 2 → 3' })).not.toContainText('PENDING', { timeout: 15_000 });
  await ledger.getByRole('listitem', { name: 'FEAT · ALERT' }).getByRole('button', { name: 'DECLINE' }).click();
  await expect(spent.getByRole('listitem', { name: 'FEAT · ALERT' })).toContainText('DECLINED', { timeout: 15_000 });
  await expect(unspent).toHaveText('XP 25 UNSPENT40 AWARDED · 15 SPENT');
  await ledger.getByRole('listitem', { name: 'BODY 2 → 3' }).getByRole('button', { name: 'UNDO' }).click();
  await expect.poll(async () => (await sheetOf()).body, { timeout: 15_000 }).toBe(2);
  await expect(unspent).toHaveText('XP 40 UNSPENT40 AWARDED · 0 SPENT', { timeout: 15_000 });
  await expect(spent.getByRole('listitem', { name: 'BODY 2 → 3' })).toContainText('UNDONE');
  await context.close();
});
