import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import { signInAsGm, signInAsPlayer, openBuilder, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Sharing a system with the pictures uploaded for it (decided with the user, 2026-10-23): EXPORT
// on a system with an uploaded image asks first, ticked to send it, and saves a zip of the system
// and its image; INSTALL A FILE takes the zip, shows the image in what it holds, and installs it
// with it. That the image comes back on a server without it is the backend's to show
// (system_builder_citysys_zip.test.js): here, one server, the window's part.

test('a system with an uploaded image is exported as a zip with it, and installed from the zip', async ({ page, request }, info) => {
  const name = `Zipped${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const upload = await request.post('/api/systems/condition-icons', {
    headers: { Authorization: `Bearer ${gm}` },
    multipart: { icon: { name: 'glitch.png', mimeType: 'image/png', buffer: crypto.randomBytes(200) } },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const { icon } = await upload.json();
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: { format: 1, name, conditions: { glitching: { name: 'Glitching', short: 'GLITCH', icon } } } });
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);

  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(`system-${id}`);
  await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'EXPORT', exact: true }).click();
  const asking = page.getByRole('group', { name: `Export ${name}` });
  const box = asking.getByRole('checkbox', { name: 'INCLUDE THE 1 UPLOADED IMAGE' });
  await expect(box).toBeChecked();
  // Unticked and ticked again by the pointer, as a person would: the box takes a click.
  await box.click();
  await expect(asking.getByText(/^A \.citysys without them/)).toBeVisible();
  await box.click();
  const downloading = page.waitForEvent('download');
  await asking.getByRole('button', { name: 'SAVE', exact: true }).click();
  const saved = await downloading;
  expect(saved.suggestedFilename()).toBe(`${name.toLowerCase().replace(/ /g, '-')}.zip`);
  const zipped = info.outputPath(saved.suggestedFilename());
  await saved.saveAs(zipped);
  await expect(asking).toHaveCount(0);

  // Installed from the zip: a second copy beside the first, its image with it.
  await page.getByRole('tab', { name: 'INSTALL A FILE' }).click();
  await page.getByLabel('System file').setInputFiles(zipped);
  const cover = page.getByTestId('install-cover');
  await expect(cover.getByText('1 IMAGE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'KEEP BOTH', exact: true }).click();
  await expect(page.getByText(/^Installed a second copy, .+, beside the first\. Its 1 image came with it\.$/)).toBeVisible();

  const listed = (await (await request.get('/api/systems', { headers: { Authorization: `Bearer ${gm}` } })).json()) as { id: string; name: string; images: number }[];
  const copy = listed.find((s) => s.id !== id && s.name.startsWith(name) && s.name !== name)!;
  expect(copy.images).toBe(1);
  const copied = await (await request.get(`/api/systems/${copy.id}`, { headers: { Authorization: `Bearer ${gm}` } })).json();
  expect(copied.published.conditions.glitching.icon).toBe(icon);
  expect((await request.get(icon)).ok()).toBe(true);
});

// A deleted system's file (decided with the user, 2026-11-06): BRING IT BACK returns its characters;
// START FRESH, once it has asked, leaves them behind, and the file then offers an update.
test('the file of a deleted system brings it back with its characters, or starts fresh without them', async ({ browser, page, request }, info) => {
  const name = `Freshfall${info.retry ? ` ${info.retry + 1}` : ''}`;
  const player = { username: `e2e_freshfall${info.retry ? `_${info.retry + 1}` : ''}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  const headers = { Authorization: `Bearer ${gm}` };
  const old = await runningSystem(request, gm, { format: 1, name, stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }] });
  await approvedPlayer(request, gm, player);
  const playerPage = await (await browser.newContext({ baseURL: info.project.use.baseURL })).newPage();
  await signInAsPlayer(playerPage, player);
  await playerPage.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await playerPage.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(playerPage, 'CHARACTER');
  await playerPage.getByLabel('Name', { exact: true }).fill('Old Hand');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.name, { timeout: 15_000 }).toBe('Old Hand');
  await playerPage.context().close();

  const file = info.outputPath('freshfall.citysys');
  fs.writeFileSync(file, await (await request.get(`/api/systems/${old}/export`, { headers })).text());
  // A running system can't be deleted: the game moves on first.
  await runningSystem(request, gm, { format: 1, name: `${name} Elsewhere` });
  const gone = async (id: string) => expect((await request.delete(`/api/systems/${id}`, { headers })).ok()).toBe(true);
  const listedAs = async () => ((await (await request.get('/api/systems', { headers })).json()) as { id: string; name: string; characterCount: number }[])
    .filter((s) => s.name === name).map((s) => [s.id, s.characterCount]);
  await gone(old);

  await signInAsGm(page);
  await openBuilder(page);
  const installing = async () => {
    await page.getByRole('tab', { name: 'INSTALL A FILE' }).click();
    await page.getByLabel('System file').setInputFiles(file);
    await expect(page.getByTestId('install-cover')).toBeVisible();
  };

  // Brought back: the same system, its character still in it.
  await installing();
  await page.getByRole('button', { name: 'BRING IT BACK', exact: true }).click();
  await expect(page.getByText(`${name} is back, with its characters.`)).toBeVisible();
  await expect.poll(listedAs).toEqual([[old, 1]]);
  await gone(old);

  // Started fresh: it asks, and CANCEL changes nothing.
  await installing();
  await page.getByRole('button', { name: 'START FRESH', exact: true }).click();
  const asking = page.getByRole('alertdialog', { name: 'START FRESH' });
  await expect(asking.getByText(/stay hidden, and installing this file won't bring them back again\.$/)).toBeVisible();
  await asking.getByRole('button', { name: 'CANCEL' }).click();
  await expect(asking).toHaveCount(0);
  expect(await listedAs()).toEqual([]);
  await page.getByRole('button', { name: 'START FRESH', exact: true }).click();
  await asking.getByRole('button', { name: 'START FRESH', exact: true }).click();
  await expect(page.getByText(`Started ${name} fresh, with no characters.`)).toBeVisible();
  const listed = await listedAs();
  expect(listed).toHaveLength(1);
  expect(listed[0][0]).not.toBe(old);
  expect(listed[0][1]).toBe(0);

  // Still that file's system: the same file now offers an update, not the old one back.
  await installing();
  await expect(page.getByRole('button', { name: /^UPDATE TO v/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'BRING IT BACK', exact: true })).toHaveCount(0);
});
