import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// Who sees what on a customized sheet (coverage family 1, e2e/COVERAGE.md; the sheet's visibility
// and edit settings from 4b3): a custom system whose sheet the GM laid out, with a field EVERYONE
// sees, one only its owner and the GM see, a combat value nobody else ever sees, and one only the GM
// changes. Its owner fills it in and can't change the GM's; another player, looking them up from the
// chat's user list, sees only what is public, and the server sends them nothing else; the GM opens
// the whole sheet the same way and sets the GM's field, which the owner then sees.

const definition = (name: string) => ({
  format: 1,
  name,
  core: { health: { model: 'pool' } },
  sheet: {
    tabs: ['STATS'],
    header: { nameField: 'name' },
    sections: [
      { id: 'identity', label: 'IDENTITY', layout: 'list', tab: 'STATS', fields: [
        { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
        { id: 'motto', label: 'Motto', type: 'text', visibility: 'public' },
        { id: 'secret', label: 'Secret', type: 'text' },
      ] },
      { id: 'numbers', label: 'NUMBERS', layout: 'grid', tab: 'STATS', fields: [
        { id: 'guard', label: 'Guard', type: 'number', sensitivity: 'combat' },
        { id: 'renown', label: 'Renown', type: 'number', edit: 'gm' },
      ] },
    ],
  },
});

/** Every public card the server sends this page, as it sends it. */
const cardsSeenBy = (page: Page) => {
  const cards: { username: string; fields?: Record<string, unknown> }[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    const m = /^42\["quickSheetData",(.*)\]$/s.exec(String(f.payload));
    if (m) cards.push(JSON.parse(m[1]));
  }));
  return cards;
};

/** Someone looks a player up the way the app offers: GLOBAL_CHAT, their name, VIEW_PLAYER_INFO. */
const lookUp = async (page: Page, username: string) => {
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
};

test('a customized sheet: public to everyone, private to its owner and the GM, combat values to nobody else, and a field only the GM sets', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const owner = { username: `e2e_seen${again}`, password: 'e2e-player-password' };
  const other = { username: `e2e_looker${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Masked Keep${again}`));
  await approvedPlayer(request, gm, owner);
  await approvedPlayer(request, gm, other);

  // THE OWNER fills their sheet in; the GM's field is theirs to see, not to change.
  const ownerContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const ownerPage = await ownerContext.newPage();
  await signInAsPlayer(ownerPage, owner);
  await ownerPage.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await ownerPage.getByLabel('Name', { exact: true }).fill('Rook');
  await ownerPage.getByLabel('Motto', { exact: true }).fill('Never late');
  await ownerPage.getByLabel('Secret', { exact: true }).fill('Owes the Keeper');
  await ownerPage.getByLabel('Guard', { exact: true }).fill('3');
  const renownForOwner = ownerPage.getByLabel('Renown', { exact: true });
  await expect(renownForOwner).not.toBeEditable();
  await expect.poll(async () => {
    const { data } = await asGm(request, gm, 'get', `/api/sheets/user/${owner.username}`);
    return [data.name, data.motto, data.secret, data.guard];
  }).toEqual(['Rook', 'Never late', 'Owes the Keeper', 3]);

  // ANOTHER PLAYER looks them up: the public lines only, and nothing else ever reaches their browser.
  const otherContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const otherPage = await otherContext.newPage();
  const cards = cardsSeenBy(otherPage);
  await signInAsPlayer(otherPage, other);
  await lookUp(otherPage, owner.username);
  const lines = otherPage.getByTestId('id-lines');
  await expect(lines).toContainText('Never late');
  await expect(lines).toContainText('Rook');
  await expect(lines).not.toContainText('Owes the Keeper');
  await expect(lines).not.toContainText('GUARD');
  await expect(lines).not.toContainText('RENOWN');
  const card = cards.find((c) => c.username === owner.username);
  expect(card?.fields).toBeDefined();
  expect(Object.keys(card!.fields!).sort()).toEqual(['motto', 'name']);

  // THE GM opens the whole sheet the same way, sees the private and combat values, and sets Renown.
  await signInAsGm(page);
  await lookUp(page, owner.username);
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await expect(page.getByLabel('Secret', { exact: true })).toHaveValue('Owes the Keeper');
  await expect(page.getByLabel('Guard', { exact: true })).toHaveValue('3');
  const renownForGm = page.getByLabel('Renown', { exact: true });
  await expect(renownForGm).toBeEditable();
  await renownForGm.fill('5');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${owner.username}`)).data.renown).toBe(5);

  // The owner sees what the GM set, still not theirs to change.
  await expect(renownForOwner).toHaveValue('5');
  await expect(renownForOwner).not.toBeEditable();

  await ownerContext.close();
  await otherContext.close();
});
