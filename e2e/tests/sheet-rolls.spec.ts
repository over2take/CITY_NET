import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, runningSystem, approvedPlayer } from './helpers';

// A custom system's own rolls at the table (6b2a; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19): a published system running as the game, with a roll ROLLED BY a stats group. A player
// opens their sheet, a die button stands by each stat in it, and a click asks the server, which
// rolls from the sheet as stored and tells everyone, as every roll does. Set up through the API, as
// player-journey is. The roll is read from what the server broadcasts, the line the log shows.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 5 }, { id: 'wits', label: 'Wits', min: 1, max: 5 }] }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d6'] },
  rolls: [{ id: 'trait', label: 'Trait check', dice: [{ count: '2', sides: 6 }], add: '@this', bands: [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Cost' }, { label: 'Hit' }], by: ['traits'] }],
});

test('a player rolls a custom system\'s roll from their sheet, and the server rolls it for everyone', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_roller${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Dicefall${again}`));
  await approvedPlayer(request, gm, player);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  // What the server tells everyone about a roll.
  const broadcasts: { historyString: string; total: number; results: Record<string, number[]> }[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    const m = /^42\["diceRollBroadcast",(.*)\]$/s.exec(String(f.payload));
    if (m) broadcasts.push(JSON.parse(m[1]));
  }));
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Rook');
  await page.getByLabel('Grit', { exact: true }).fill('3');

  // A die button by each stat the roll is rolled by.
  const rolls = page.getByRole('button', { name: 'Roll Trait check' });
  await expect(rolls).toHaveCount(2);
  // Grit 3 saved first, so the server reads it from the stored sheet.
  await page.waitForTimeout(800);
  await rolls.first().click();
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(1);
  const [roll] = broadcasts;
  expect(roll.historyString).toMatch(/^Rook rolled Trait check \(Grit\) \[\d \d = \d+ \+ 3 = \d+\] — (MISS|COST|HIT)$/);
  expect(roll.total).toBe(roll.results['6'].reduce((a, b) => a + b, 0) + 3);
  await context.close();
});
