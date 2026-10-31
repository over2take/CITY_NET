import { test, expect, type Page, type APIRequestContext, type Browser, type BrowserContext, type TestInfo } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Every health model at the table (coverage family 2, e2e/COVERAGE.md; the models from 2g2, the
// HEALTH folder from the approved mockup docs/mockups/health-windows.html): for each, a custom system
// running it, a player's token on the map, the player hurting and healing it from HIT_POINTS, and
// another player watching from the chat's user list (VIEW_PLAYER_INFO, HEALTH): a picture, never a
// number or a note, and what their browser is sent holds none either.

/** The players' own browser windows, closed after each test. */
const opened: BrowserContext[] = [];
type Frame = Record<string, unknown>;

/** Every health view the server sends this page, as it sends it. */
const viewsSeenBy = (page: Page, frames: Frame[]) => {
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    const m = /^42\["healthView",(.*)\]$/s.exec(String(f.payload));
    if (m) frames.push(JSON.parse(m[1]));
  }));
  return frames;
};

/** Someone looks a player up the way the app offers, and opens HEALTH. */
const watch = async (page: Page, username: string) => {
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('tab', { name: /HEALTH/ }).click();
  return page.getByRole('tabpanel');
};

/**
 * A player's sheet, made as a player makes it: opened, a name typed, closed again. The models that
 * keep anything past the token's numbers keep it there.
 */
const giveSheet = async (page: Page, request: APIRequestContext, token: string, username: string) => {
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');
  await page.getByLabel('Name', { exact: true }).fill('Rook');
  await expect.poll(async () => (await asGm(request, token, 'get', `/api/sheets/user/${username}`).catch(() => null))?.data?.name).toBe('Rook');
  // Closed with its own ×: the nearest window round the Name box.
  await page.getByLabel('Name', { exact: true })
    .locator('xpath=ancestor::*[.//button[contains(@class, "win95-close-btn")]][1]//button[contains(@class, "win95-close-btn") and text()="×"]').click();
  await expect(page.getByLabel('Name', { exact: true })).toBeHidden();
};

/** One model: its system running, the owner's token (and sheet), both players signed in, the owner on HIT_POINTS. */
const atTheTable = async (browser: Browser, request: APIRequestContext, info: TestInfo, model: string, health: object, hp: [number, number], { sheet = true } = {}) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const ownerName = `e2e_${model}_hurt${again}`;
  const lookerName = `e2e_${model}_look${again}`;
  const token = await gmToken(request);
  await runningSystem(request, token, { format: 1, name: `Health ${model}${again}`, core: { health } });
  await approvedPlayer(request, token, { username: ownerName, password: 'e2e-player-password' });
  await approvedPlayer(request, token, { username: lookerName, password: 'e2e-player-password' });
  await asGm(request, token, 'post', '/api/locations', {
    name: ownerName, description: '', shape: 'rhombus', owner: ownerName, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: hp[0], hp_max: hp[1], hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const open = async (username: string, frames?: Frame[]) => {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL });
    opened.push(context);
    const page = await context.newPage();
    // Listening from the start: the socket opens as they sign in.
    if (frames) viewsSeenBy(page, frames);
    await signInAsPlayer(page, { username, password: 'e2e-player-password' });
    return page;
  };
  const owner = await open(ownerName);
  if (sheet) await giveSheet(owner, request, token, ownerName);
  await owner.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  await expect(owner.getByRole('tab', { name: /HEALTH/ })).toHaveAttribute('aria-selected', 'true');
  const frames: Frame[] = [];
  const looker = await open(lookerName, frames);
  const watching = await watch(looker, ownerName);
  return { owner, ownerPanel: owner.getByRole('tabpanel'), looker, watching, frames, ownerName, token, giveSheet: () => giveSheet(owner, request, token, ownerName) };
};

const monitor = (panel: ReturnType<Page['getByRole']>) => panel.getByRole('img', { name: /^Heart monitor/ });
/** The looker's views of the owner's token, none of them in full. */
const othersOnly = (frames: Frame[]) => {
  expect(frames.length).toBeGreaterThan(0);
  for (const f of frames) expect(f.full).toBe(false);
};

test.describe('every health model, hurt, healed and watched', () => {
  test.setTimeout(180_000);
  test.afterEach(async () => { await Promise.all(opened.splice(0).map((c) => c.close())); });

  test('one pool, under its own name', async ({ browser, request }, info) => {
    const t = await atTheTable(browser, request, info, 'pool', { model: 'pool', label: 'VIGOR' }, [10, 10]);
    await expect(t.ownerPanel.getByText('VIGOR', { exact: true })).toBeVisible();
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('6');
    await t.ownerPanel.getByRole('button', { name: 'DAMAGE', exact: true }).click();
    await expect(t.ownerPanel.getByText('4 / 10')).toBeVisible();
    // Watched: a faster heartbeat, and no number.
    await expect(monitor(t.watching)).toHaveAttribute('data-band', 'fast');
    await expect(t.watching).not.toContainText('/ 10');
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('3');
    await t.ownerPanel.getByRole('button', { name: 'HEAL', exact: true }).click();
    await expect(t.ownerPanel.getByText('7 / 10')).toBeVisible();
    await expect(monitor(t.watching)).toHaveAttribute('data-band', 'steady');
    othersOnly(t.frames);
    for (const f of t.frames) expect(Object.keys(f).sort()).toEqual(['full', 'label', 'location_id', 'model']);
  });

  test('two tracks: the GM sets the second\'s maximum, and damage past it spills into the first', async ({ browser, request, page }, info) => {
    const t = await atTheTable(browser, request, info, 'tracks', { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true }, [10, 10]);
    // The GM, from the same lookup: the maximum of STUN.
    await signInAsGm(page);
    const gm = await watch(page, t.ownerName);
    await gm.getByRole('group', { name: 'Track' }).getByRole('button', { name: 'STUN' }).click();
    await gm.getByRole('spinbutton', { name: 'MAX STUN' }).fill('4');
    await gm.getByRole('button', { name: 'SET', exact: true }).first().click();
    await expect(gm.getByText('0 / 4')).toBeVisible();

    await t.ownerPanel.getByRole('group', { name: 'Track' }).getByRole('button', { name: 'STUN' }).click();
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('6');
    await t.ownerPanel.getByRole('button', { name: 'DAMAGE', exact: true }).click();
    await expect(t.ownerPanel.getByRole('status')).toHaveText('STUN FULL · 2 SPILLED INTO PHYSICAL');
    await expect(t.ownerPanel.getByText('8 / 10')).toBeVisible();
    // Watched: STUN full as a bar, PHYSICAL as the heartbeat.
    await expect(t.watching.getByTestId('second-track')).toContainText('STUN — FULL · OVERFLOW → PHYSICAL');
    await expect(monitor(t.watching)).toHaveAttribute('data-band', 'steady');
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('3');
    await t.ownerPanel.getByRole('button', { name: 'HEAL', exact: true }).click();
    await expect(t.ownerPanel.getByText('1 / 4 · OVERFLOW → PHYSICAL')).toBeVisible();
    await expect(t.watching.getByTestId('second-track')).not.toContainText('FULL');
    othersOnly(t.frames);
    for (const f of t.frames) expect(JSON.stringify(f.second ?? {})).not.toMatch(/"(current|max)"/);
  });

  test('damage types on one track: boxes marked lightly and heavily', async ({ browser, request }, info) => {
    const t = await atTheTable(browser, request, info, 'typed', { model: 'typed', types: [{ id: 'superficial', label: 'SUPERFICIAL' }, { id: 'aggravated', label: 'AGGRAVATED' }] }, [4, 4]);
    const type = t.ownerPanel.getByRole('group', { name: 'Damage type' });
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('2');
    await t.ownerPanel.getByRole('button', { name: 'DAMAGE', exact: true }).click();
    await expect(t.ownerPanel.getByText('2 OF 4 BOXES CLEAR')).toBeVisible();
    await type.getByRole('button', { name: 'AGGRAVATED' }).click();
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('1');
    await t.ownerPanel.getByRole('button', { name: 'DAMAGE', exact: true }).click();
    await expect(t.ownerPanel.getByText('1 OF 4 BOXES CLEAR')).toBeVisible();
    await expect(t.ownerPanel.getByRole('img', { name: 'Health boxes' })).toHaveText('X//');
    // Watched: light against heavy, as a bar.
    const split = t.watching.getByTestId('damage-split');
    await expect(split).toContainText('DAMAGE TAKEN');
    await expect.poll(() => split.getByTestId('heavy-fill').evaluate((el) => (el as HTMLElement).style.width)).toBe('25%');
    await type.getByRole('button', { name: 'SUPERFICIAL' }).click();
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('2');
    await t.ownerPanel.getByRole('button', { name: 'HEAL', exact: true }).click();
    await expect(t.ownerPanel.getByText('3 OF 4 BOXES CLEAR')).toBeVisible();
    othersOnly(t.frames);
    for (const f of t.frames) expect(f.types).toBeUndefined();
  });

  test('harm levels: a full level moves harm up, and others see only the worst level\'s name', async ({ browser, request }, info) => {
    const t = await atTheTable(browser, request, info, 'harm', { model: 'harm', levels: [
      { id: 'lesser', label: 'LESSER', slots: 2, penalty: 'Reduced effect' },
      { id: 'moderate', label: 'MODERATE', slots: 1, penalty: '-1d' },
      { id: 'severe', label: 'SEVERE', slots: 1, penalty: 'Need help' },
    ] }, [4, 4], { sheet: false });
    // Notes are kept on the sheet: with none yet, the server says so and nothing is taken.
    await t.ownerPanel.getByRole('textbox', { name: 'Harm note' }).fill('Bruised ribs');
    await t.ownerPanel.getByRole('button', { name: 'TAKE HARM' }).click();
    await expect(t.ownerPanel.getByRole('status')).toHaveText('This token has no sheet to keep that on. Give it one first.');
    await t.giveSheet();
    for (const note of ['Bruised ribs', 'Cut hand', 'Twisted ankle']) {
      await t.ownerPanel.getByRole('textbox', { name: 'Harm note' }).fill(note);
      await t.ownerPanel.getByRole('button', { name: 'TAKE HARM' }).click();
      await expect(t.ownerPanel.getByText(note)).toBeVisible();
    }
    await expect(t.ownerPanel.getByRole('status')).toHaveText('LESSER FULL · MOVED UP TO MODERATE');
    // Watched: the worst level's name, never the notes.
    await expect(t.watching.getByText('MODERATE HARM')).toBeVisible();
    await expect(monitor(t.watching)).toHaveAttribute('data-band', 'fast');
    await expect(t.watching).not.toContainText('Twisted');
    await t.ownerPanel.getByRole('button', { name: 'Clear Twisted ankle' }).click();
    await expect(t.watching.getByText('LESSER HARM')).toBeVisible();
    othersOnly(t.frames);
    for (const f of t.frames) expect(JSON.stringify(f)).not.toMatch(/Bruised|Cut hand|Twisted/);
  });

  test('a wound count: out after the last, and others see WOUNDED, then INCAPACITATED', async ({ browser, request }, info) => {
    const t = await atTheTable(browser, request, info, 'wounds', { model: 'wounds', count: 3, penalty: -1 }, [3, 3]);
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('1');
    await t.ownerPanel.getByRole('button', { name: 'TAKE WOUND' }).click();
    await expect(t.ownerPanel.getByText('2 OF 3 WOUNDS LEFT')).toBeVisible();
    await expect(t.ownerPanel.getByText('PENALTY -1')).toBeVisible();
    await expect(t.watching.getByText('WOUNDED', { exact: true })).toBeVisible();
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('2');
    await t.ownerPanel.getByRole('button', { name: 'TAKE WOUND' }).click();
    await expect(t.ownerPanel.getByRole('status')).toHaveText('OUT OF WOUNDS · INCAPACITATED');
    await expect(t.watching.getByText('INCAPACITATED', { exact: true })).toBeVisible();
    await expect(monitor(t.watching)).toHaveAttribute('data-band', 'down');
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('3');
    await t.ownerPanel.getByRole('button', { name: 'HEAL', exact: true }).click();
    await expect(t.watching.getByText('UNHURT', { exact: true })).toBeVisible();
    othersOnly(t.frames);
    for (const f of t.frames) expect(f.penalty).toBeUndefined();
  });

  test('hit locations: a hit with its note, and others see only which place is hurt', async ({ browser, request }, info) => {
    const t = await atTheTable(browser, request, info, 'locations', { model: 'locations', locations: [{ id: 'head', label: 'HEAD' }, { id: 'body', label: 'BODY' }, { id: 'legs', label: 'LEGS' }] }, [20, 20]);
    await t.ownerPanel.getByRole('combobox', { name: 'Where it hit' }).selectOption('head');
    await t.ownerPanel.getByRole('textbox', { name: 'Location note' }).fill('Concussed');
    await t.ownerPanel.getByRole('spinbutton', { name: 'Amount' }).fill('5');
    await t.ownerPanel.getByRole('button', { name: 'DAMAGE', exact: true }).click();
    await expect(t.ownerPanel.getByText('15 / 20')).toBeVisible();
    await expect(t.ownerPanel.getByText('Concussed')).toBeVisible();
    // Watched: HEAD marked, the others not, and no note.
    await expect(t.watching.locator('[data-hit]')).toHaveText(['HEAD', 'BODY', 'LEGS']);
    await expect(t.watching.locator('[data-hit="yes"]')).toHaveText(['HEAD']);
    await expect(t.watching).not.toContainText('Concussed');
    await t.ownerPanel.getByRole('button', { name: 'Clear HEAD' }).click();
    await expect(t.watching.locator('[data-hit="yes"]')).toHaveCount(0);
    othersOnly(t.frames);
    for (const f of t.frames) expect(JSON.stringify(f)).not.toContain('Concussed');
  });

  test('none: harm is conditions, and the folder says so to both', async ({ browser, request }, info) => {
    const t = await atTheTable(browser, request, info, 'none', { model: 'none' }, [10, 10]);
    await expect(t.ownerPanel.getByText('THIS SYSTEM TRACKS HARM AS CONDITIONS, NOT HEALTH.')).toBeVisible();
    await expect(t.ownerPanel.getByRole('button', { name: 'DAMAGE', exact: true })).toHaveCount(0);
    await expect(t.watching.getByText('NO HEALTH TRACKED.')).toBeVisible();
    await expect(monitor(t.watching)).toHaveCount(0);
  });
});
