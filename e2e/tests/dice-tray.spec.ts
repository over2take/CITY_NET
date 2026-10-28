import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { signInAsGm, signInAsPlayer, gmToken, runningSystem, approvedPlayer } from './helpers';

// DICE_TRAY.EXE's new dice (6c4b2b; approved mockup docs/mockups/builder-dice.html): solid, every
// face printed, landing on the faces the server rolled, inside the tray as it is shown (the old
// tray's dice bounced past its edges). The tray throws what the server sends with each roll, its
// `throw` (6c4b1). With GRAPH_SHOTS=1, pictures of a throw early, mid-air and landed go to docs/mockups/shots.

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'mockups', 'shots');

type Broadcast = { historyString: string; group?: string; results: Record<string, unknown[]>; throw?: { seed: number; dice: { key: string; sides: number; landed: number[]; faces?: { text: string }[]; color?: string }[] } };

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
  // The board (6c4e): rolling, then the total in big digits once the dice are down.
  await expect(page.getByRole('img', { name: 'Rolling' })).toBeVisible();
  await expect(page.getByRole('img', { name: String(roll.total) })).toBeVisible({ timeout: 15_000 });
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

test('the tray\'s ANIMATION toggle, kept on the account: turned off, still off after a reload, back on (6c4b3b)', async ({ page }) => {
  await signInAsGm(page);
  const roll = async () => {
    await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
    await page.getByRole('button', { name: 'One more d6', exact: true }).click();
    await page.getByRole('button', { name: /ROLL DICE/ }).click();
    await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  };
  await roll();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/settings') && r.request().method() === 'PUT');
  const animation = page.getByRole('switch', { name: 'Animation' });
  await expect(animation).toHaveAttribute('aria-checked', 'true');
  await animation.click();
  expect((await saved).ok()).toBe(true);
  await expect(animation).toHaveAttribute('aria-checked', 'false');
  // Kept on the account, not just this page: a fresh sign-in finds it.
  await page.evaluate(() => localStorage.removeItem('citynet_tray_motion'));
  await page.reload();
  await signInAsGm(page);
  await roll();
  await expect(animation).toHaveAttribute('aria-checked', 'false');
  // Back on, as the other journeys expect.
  const back = page.waitForResponse((r) => r.url().endsWith('/api/me/settings') && r.request().method() === 'PUT');
  await animation.click();
  expect((await back).ok()).toBe(true);
  await expect(animation).toHaveAttribute('aria-checked', 'true');
  if (process.env.GRAPH_SHOTS) await page.getByText('DICE_TRAY.EXE', { exact: true }).locator('xpath=ancestor::*[3]').screenshot({ path: path.join(SHOTS, 'dice-tray-animation-toggle.png') });
});

test('someone else\'s roll flashes a shut tray\'s buttons; one click opens it on the history; the bell turns that off (6c4g)', async ({ page, browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_bell${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, await gmToken(request), player);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const theirs = await context.newPage();
  const broken: string[] = [];
  theirs.on('pageerror', (e) => broken.push(e.message));
  const heard = listen(theirs);
  await signInAsPlayer(theirs, player);
  await signInAsGm(page);
  const gmRolls = async () => {
    if (!(await page.getByRole('button', { name: 'One more d6', exact: true }).isVisible())) await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
    await page.getByRole('button', { name: 'One more d6', exact: true }).click();
    await page.getByRole('button', { name: /ROLL DICE/ }).click();
  };
  const rail = theirs.getByRole('button', { name: 'DICE_ROLLER', exact: true });
  const tray = theirs.getByText('DICE_TRAY.EXE', { exact: true });
  const bell = theirs.locator('.win95-window', { has: tray }).getByTitle('TOGGLE_NOTIFICATIONS');

  // The GM rolls; the player's tray is shut, so its rail button flashes.
  await gmRolls();
  await expect.poll(() => heard.length, { timeout: 15_000 }).toBe(1);
  await expect(rail).toHaveClass(/unread-flash/);
  await expect(tray).toBeHidden();
  // One click: the menu, its DICE_TRAY.exe button no longer flashing, and the tray open on the history.
  await rail.click();
  await expect(tray).toBeVisible();
  await expect(theirs.getByTestId('dice-history')).toBeVisible();
  await expect(rail).not.toHaveClass(/unread-flash/);
  await expect(theirs.getByRole('button', { name: 'DICE_TRAY.exe' })).not.toHaveClass(/unread-flash/);

  // The bell, right of ANIMATION, off and saved; the tray shut; the GM's next roll flashes nothing.
  const saved = theirs.waitForResponse((r) => r.url().endsWith('/api/me/settings') && r.request().method() === 'PUT');
  await bell.click();
  expect((await saved).ok()).toBe(true);
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  await theirs.getByRole('button', { name: 'DICE_TRAY.exe' }).click();
  await expect(tray).toBeHidden();
  await gmRolls();
  await expect.poll(() => heard.length, { timeout: 15_000 }).toBe(2);
  await expect(rail).not.toHaveClass(/unread-flash/);
  expect(broken).toEqual([]);
  await context.close();
});

test('the tray in the theme picked: its board and its record in Oceanic\'s cyan, not Classic\'s green', async ({ page }) => {
  // The tray sat outside the app's theme once, and drew Classic whatever was picked.
  await page.addInitScript(() => localStorage.setItem('citynet_theme', 'ocean'));
  await signInAsGm(page);
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await page.getByRole('button', { name: 'One more d6', exact: true }).click();
  await page.getByRole('button', { name: /ROLL DICE/ }).click();
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  // A lit dot of the board, once the total is told.
  const litDot = () => page.getByTestId('dice-board').evaluate((board) => {
    const dot = board.querySelector('.tray-board-px.on');
    return dot ? getComputedStyle(dot).backgroundColor : null;
  });
  await expect.poll(litDot, { timeout: 15_000 }).toBe('rgb(0, 255, 255)');
  await page.getByTitle('TOGGLE_HISTORY').click();
  const line = page.getByTestId('dice-history').locator('> div').filter({ hasText: 'rolled' }).last();
  await expect(line).toHaveCSS('color', 'rgb(0, 255, 255)');
});

test('no queue: one person\'s rolls a moment apart land as one throw, and a later roll cuts in with the earlier in the record at once (6c4c)', async ({ page }) => {
  const broadcasts = listen(page);
  await signInAsGm(page);
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  // The tray open first, as it sits at a table mid-fight. ROLL DICE opens a shut one, and on CI's
  // slow software graphics building it took past the group's 400 ms, in the same flush as the click,
  // so the next roll started a group of its own (2026-10-27; seen locally with the CPU slowed 8x).
  await page.getByRole('button', { name: 'DICE_TRAY.exe' }).click();
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  const roll = async (sides: number) => {
    await page.getByRole('button', { name: `One more d${sides}`, exact: true }).click();
    await page.getByRole('button', { name: /ROLL DICE/ }).click();
  };
  // Two rolls straight after each other, as an attack's to-hit and damage go out: the server puts
  // them in one group. Clicked from inside the page, since four of Playwright's own clicks can take
  // longer than the group's 400 ms on a loaded runner; and only microtasks apart (React applies a
  // click in one), not a frame: the first roll came back during a frame's wait and drawing its throw
  // held the next frame for half a second with the CPU slowed 8x, as CI's is (2026-10-27).
  const d6 = await page.getByRole('button', { name: 'One more d6', exact: true }).elementHandle();
  const d8 = await page.getByRole('button', { name: 'One more d8', exact: true }).elementHandle();
  const go = await page.getByRole('button', { name: /ROLL DICE/ }).elementHandle();
  await page.evaluate(async (buttons) => {
    for (const b of buttons) {
      (b as HTMLElement).click();
      for (let i = 0; i < 3; i++) await new Promise<void>((r) => queueMicrotask(r));
    }
  }, [d6, go, d8, go]);
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(2);
  expect(broadcasts[1].group).toBe(broadcasts[0].group);
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  // A moment later, a roll of its own: it cuts in, and the two before are in the record at once,
  // while its own dice are still in the air.
  await page.waitForTimeout(700);
  await roll(20);
  await expect.poll(() => broadcasts.length, { timeout: 15_000 }).toBe(3);
  expect(broadcasts[2].group).not.toBe(broadcasts[0].group);
  await page.getByTitle('TOGGLE_HISTORY').click();
  const said = (b: Broadcast) => b.historyString.replace(/^.*? rolled /, 'rolled ');
  const record = page.getByTestId('dice-history').locator('> div').filter({ hasText: 'rolled' });
  await expect.poll(async () => (await record.allTextContents()).slice(-2).map((l) => l.replace(/^.*?: /, ''))).toEqual([said(broadcasts[0]), said(broadcasts[1])]);
  expect((await record.allTextContents()).some((l) => l.endsWith(said(broadcasts[2])) && l.includes('1d20'))).toBe(false);
});
