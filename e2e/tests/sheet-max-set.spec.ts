import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// MAX set by hand on the strip (8s4a; the user, 2026-11-24: "make the MAX number editable", and "a test for changing max and
// healing up to the new max, also taking damage and making sure max stays the expected value"). A game whose MAX HEALTH is
// a formula (20): in SHEET.EXE, MAX clicked and typed 30; DAMAGE 8, HEAL 20 stopping at 30; Might typed (the sheet worked
// out again) and MAX still 30, kept as an ADJUST; on the tab MAX set to 26, both following.

test('MAX typed on the strip: healed up to it, hurt, and it stays through the sheet worked out again; the same on the tab (8s4a)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Maxkeep${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    levels: { health: { how: 'formula', formula: '20' } },
  });
  const player = { username: `e2e_maxset${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const tokenOf = async () => {
    const t = (await asGm(request, gm, 'get', '/api/locations')).find((l: { owner?: string; shape?: string }) => l.shape === 'rhombus' && l.owner === player.username);
    return `${t.hp_current}/${t.hp_max}`;
  };
  const bar = (p: import('@playwright/test').Page) => p.getByTitle('Synced with your token: click to open HEALTH here');

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  const strip = mine.getByRole('group', { name: 'Vitals' });
  await expect(strip.getByRole('button', { name: 'Max HP' })).toHaveText('20', { timeout: 15_000 });

  // MAX 30, typed in place.
  await strip.getByRole('button', { name: 'Max HP' }).click();
  await strip.getByRole('spinbutton', { name: 'Max HP' }).fill('30');
  await strip.getByRole('spinbutton', { name: 'Max HP' }).press('Enter');
  await expect.poll(tokenOf, { timeout: 15_000 }).toBe('20/30');
  await expect(strip.getByRole('button', { name: 'Max HP' })).toHaveText('30', { timeout: 15_000 });
  // Said on hover, over the formula's 20.
  await expect(strip.getByRole('button', { name: 'Max HP' })).toHaveAttribute('title', /^20 → 30 \(adjusted \+10\)/, { timeout: 15_000 });

  // DAMAGE 8, then HEAL 20: up to 30 and no further, MAX staying.
  await strip.getByRole('spinbutton', { name: 'Amount of HP' }).fill('8');
  await strip.getByRole('button', { name: 'DAMAGE', exact: true }).click();
  await expect.poll(tokenOf, { timeout: 15_000 }).toBe('12/30');
  await strip.getByRole('spinbutton', { name: 'Amount of HP' }).fill('20');
  await strip.getByRole('button', { name: 'HEAL', exact: true }).click();
  await expect.poll(tokenOf, { timeout: 15_000 }).toBe('30/30');
  await expect(bar(mine)).toContainText('30/30', { timeout: 15_000 });

  // The sheet worked out again (Might typed): MAX still 30.
  const might = mine.getByRole('spinbutton', { name: 'Might' });
  await might.fill('3');
  await might.press('Tab');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.might, { timeout: 15_000 }).toBe(3);
  await expect.poll(tokenOf, { timeout: 15_000 }).toBe('30/30');

  // On the tab: MAX 26, the current held under it; SHEET.EXE follows.
  const [tab] = await Promise.all([context.waitForEvent('page'), mine.getByRole('button', { name: 'Open in new tab' }).click()]);
  await tab.waitForLoadState();
  const tabStrip = tab.getByRole('group', { name: 'Vitals' });
  await tabStrip.getByRole('button', { name: 'Max HP' }).click();
  await tabStrip.getByRole('spinbutton', { name: 'Max HP' }).fill('26');
  await tabStrip.getByRole('spinbutton', { name: 'Max HP' }).press('Enter');
  await expect.poll(tokenOf, { timeout: 15_000 }).toBe('26/26');
  await expect(bar(tab)).toContainText('26/26', { timeout: 15_000 });
  await expect(bar(mine)).toContainText('26/26', { timeout: 15_000 });
  await expect(strip.getByRole('button', { name: 'Max HP' })).toHaveAttribute('title', /^20 → 26 \(adjusted \+6\)/, { timeout: 15_000 });
  await context.close();
});
