import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, runningSystem, approvedPlayer } from './helpers';

// A custom system's own rolls at the table (6b2; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19): a published system running as the game. A player opens their sheet and a die button
// stands by each stat a roll is rolled by. Wits has one roll with nothing to pick, so a click rolls
// it; Grit has two, one with ADVANTAGE, so a click asks first (6b2b). The server rolls from the sheet
// as stored and tells everyone, as every roll does. PUSH adds 2 Stress, paid on the sheet once rolled
// and refused past its highest (6b3a). Set up through the API, as player-journey is; the rolls are
// read from what the server broadcasts, the line the log shows.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [
    { id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 5 }, { id: 'wits', label: 'Wits', min: 1, max: 5 }] },
    { id: 'track', label: 'TRACK', stats: [{ id: 'stress', label: 'Stress', min: 0, max: 4 }] },
  ],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d6'] },
  rolls: [
    { id: 'trait', label: 'Trait check', dice: [{ count: '2', sides: 6 }], add: '@this', bands: [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Cost' }, { label: 'Hit' }], by: ['traits'] },
    { id: 'grit_save', label: 'Grit save', dice: [{ count: '1', sides: 20 }], add: '@this',
      changes: [
        { id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } },
        { id: 'push', label: 'Push', add: '2', cost: { from: 'stress', amount: 2, adds: true } },
      ], by: ['grit'] },
  ],
});

test('a player rolls a custom system\'s rolls from their sheet, picking first where there is a choice', async ({ browser, request }, info) => {
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
  await page.getByLabel('Wits', { exact: true }).fill('2');
  await page.getByLabel('Stress', { exact: true }).fill('1');

  // A die button by each stat the first roll is rolled by.
  const rolls = page.getByRole('button', { name: 'Roll Trait check' });
  await expect(rolls).toHaveCount(2);
  // Saved first, so the server reads them from the stored sheet.
  await page.waitForTimeout(800);

  // WITS: one roll, nothing to pick: rolled on the click.
  await rolls.nth(1).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(1);
  expect(broadcasts[0].historyString).toMatch(/^Rook rolled Trait check \(Wits\) \[\d \d = \d+ \+ 2 = \d+\] — (MISS|COST|HIT)$/);
  expect(broadcasts[0].total).toBe(broadcasts[0].results['6'].reduce((a, b) => a + b, 0) + 2);

  // The dice tray opens in front of the sheet with each roll; Escape puts it away, as a player would.
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toHaveCount(0);

  // GRIT: two rolls, one with ADVANTAGE: the chooser asks first.
  await rolls.nth(0).click();
  const ask = page.getByRole('dialog', { name: 'Roll Grit' });
  await ask.getByRole('radio', { name: 'GRIT SAVE' }).click();
  await ask.getByRole('switch', { name: 'ADVANTAGE' }).click();
  await ask.getByRole('button', { name: 'ROLL GRIT SAVE' }).click();
  await expect(ask).toHaveCount(0);
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(2);
  // Two d20, the higher kept, + Grit 3.
  // The lower in brackets, on whichever side it fell.
  expect(broadcasts[1].historyString).toMatch(/^Rook rolled Grit save \(Grit\) \(Advantage\) \[(\d+ \(\d+\)|\(\d+\) \d+) = \d+ \+ 3 = \d+\]$/);
  expect(broadcasts[1].results['20']).toHaveLength(2);
  expect(broadcasts[1].total).toBe(Math.max(...broadcasts[1].results['20']) + 3);
  await page.keyboard.press('Escape');

  // PUSH adds 2 Stress: the chooser says where it stands, the roll pays it, and the sheet shows it.
  await rolls.nth(0).click();
  await ask.getByRole('radio', { name: 'GRIT SAVE' }).click();
  await ask.getByRole('switch', { name: 'PUSH · ADDS 2 STRESS · 1 OF 4' }).click();
  await ask.getByRole('button', { name: 'ROLL GRIT SAVE' }).click();
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(3);
  expect(broadcasts[2].historyString).toMatch(/^Rook rolled Grit save \(Grit\) \(Push: \+2 STRESS\) \[\d+ = \d+ \+ 5 = \d+\]$/);
  await expect(page.getByLabel('Stress', { exact: true })).toHaveValue('3');
  await page.keyboard.press('Escape');

  // Another would take it past 4: off, and nothing rolled.
  await rolls.nth(0).click();
  await ask.getByRole('radio', { name: 'GRIT SAVE' }).click();
  await expect(ask.getByRole('switch', { name: 'PUSH · ADDS 2 STRESS · 3 OF 4' })).toBeDisabled();
  await ask.getByRole('button', { name: 'CANCEL' }).click();
  expect(broadcasts).toHaveLength(3);
  await context.close();
});
