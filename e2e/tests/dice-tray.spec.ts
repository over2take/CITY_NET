import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { signInAsGm, signInAsPlayer, gmToken, runningSystem, approvedPlayer } from './helpers';

// DICE_TRAY.EXE's new dice (6c4b2b; approved mockup docs/mockups/builder-dice.html): solid, every
// face printed, landing on the faces the server rolled, inside the tray as it is shown (the old
// tray's dice bounced past its edges). The tray throws what the server sends with each roll, its
// `throw` (6c4b1). With GRAPH_SHOTS=1, pictures of a throw early, mid-air and landed go to docs/mockups/shots.

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'mockups', 'shots');

type Broadcast = { historyString: string; results: Record<string, unknown[]>; throw?: { seed: number; dice: { key: string; sides: number; landed: number[]; faces?: { text: string }[]; color?: string }[] } };

/** Every roll the server sends this page, as it sends it. */
const listen = (page: Page) => {
  const broadcasts: Broadcast[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    const m = /^42\["diceRollBroadcast",(.*)\]$/s.exec(String(f.payload));
    if (m) broadcasts.push(JSON.parse(m[1]));
  }));
  return broadcasts;
};

/** The tray's floor, pictured mid-throw and once the dice have landed, when pictures are asked for. */
const picture = async (page: Page, name: string) => {
  const floor = page.getByTestId('dice-tray-floor');
  await expect(floor.locator('canvas')).toBeVisible();
  if (!process.env.GRAPH_SHOTS) return;
  await page.waitForTimeout(150);
  await floor.screenshot({ path: path.join(SHOTS, `${name}-early.png`) });
  await page.waitForTimeout(450);
  await floor.screenshot({ path: path.join(SHOTS, `${name}-mid.png`) });
  await page.waitForTimeout(3800);
  await floor.screenshot({ path: path.join(SHOTS, `${name}-landed.png`) });
};

test('a handful of standard dice thrown in the tray, landing on what the server rolled', async ({ page }) => {
  const broken: string[] = [];
  page.on('pageerror', (e) => broken.push(e.message));
  const broadcasts = listen(page);
  await signInAsGm(page);
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  for (const [sides, n] of [[20, 2], [12, 1], [10, 2], [8, 1], [6, 3], [4, 1]] as const) {
    for (let i = 0; i < n; i += 1) await page.getByRole('button', { name: `One more d${sides}`, exact: true }).click();
  }
  await page.getByRole('button', { name: /ROLL DICE/ }).click();
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // The throw names every die and the face it landed on: the value it shows, less one.
  const [roll] = broadcasts;
  expect(roll.throw!.dice.map((d) => [d.key, d.landed.length])).toEqual([['4', 1], ['6', 3], ['8', 1], ['10', 2], ['12', 1], ['20', 2]]);
  for (const d of roll.throw!.dice) expect(d.landed, `d${d.key}`).toEqual(roll.results[d.key].map((v) => Number(v) - 1));
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  await picture(page, 'dice-tray-standard');
  expect(broken).toEqual([]);
});

test("a system's own dice in the tray: symbols drawn and marked, a bad die in the danger color", async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_tray${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  const SKULL = ['07e0', '1ff8', '3ffc', '3ffc', '73ce', '6186', '6186', '73ce', '3e7c', '1ff8', '0ff0', '0db0', '0db0', '07e0', '0000', '0000'];
  await runningSystem(request, gm, {
    format: 1,
    name: `Traydice${again}`,
    symbols: [{ id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' }, { id: 'miss', name: 'Miss', mark: '✕', cancels: 'hit' }, { id: 'skull', name: 'Skull', drawn: SKULL }],
    dice: [
      { id: 'good', name: 'Good', faces: [{}, { s: ['hit'] }, { s: ['hit', 'hit'] }, { s: ['skull'] }] },
      { id: 'bad', name: 'Bad', color: 'danger', faces: [{}, { s: ['miss'] }, { s: ['skull'] }] },
      { id: 'omen', name: 'Omen', faces: Array.from({ length: 13 }, (_, i) => ({ n: i + 1 })) },
    ],
  });
  await approvedPlayer(request, gm, player);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  const broken: string[] = [];
  page.on('pageerror', (e) => broken.push(e.message));
  const broadcasts = listen(page);
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  const game = page.getByRole('group', { name: "THIS GAME'S DICE" });
  for (const [die, n] of [['Good', 3], ['Bad', 2], ['Omen', 1]] as const) {
    for (let i = 0; i < n; i += 1) await game.getByRole('button', { name: `One more ${die}` }).click();
  }
  await page.getByRole('button', { name: /ROLL DICE/ }).click();
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(3);
  // Each die's faces come with it, and it lands on one showing what the log wrote.
  for (const b of broadcasts) {
    const [kind] = b.throw!.dice;
    expect(kind.landed.map((i) => kind.faces![i].text), kind.key).toEqual(b.results[kind.key]);
  }
  expect(broadcasts.find((b) => b.throw!.dice[0].key === 'Bad')!.throw!.dice[0].color).toBe('danger');
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  await picture(page, 'dice-tray-own');
  expect(broken).toEqual([]);
  await context.close();
});
