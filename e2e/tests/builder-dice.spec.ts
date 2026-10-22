import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// STATS & RULES' DICE tab (6c2b2; approved mockup docs/mockups/builder-dice.html, 2026-10-21): a
// system's own dice made from a preset, a face changed, a symbol drawn on the pad, a handful thrown
// by TEST on the server, and one of the table's CUSTOM_DIE.EXE dice copied in, its word becoming a
// symbol; all of it kept after a reload. With GRAPH_SHOTS=1, a picture of the tab goes to
// docs/mockups/shots/ for looking at by eye.

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'mockups', 'shots');

const openSystem = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByRole('tab', { name: 'DICE', exact: true }).click();
};

test('dice made from a preset, a face changed, a symbol drawn, thrown on the server, and a table die copied in', async ({ page, request }, info) => {
  const name = `Dicing Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, stats: [{ id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight' }] }] } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
  // One of the table's dice, a d6 with SKULL for a 6.
  const bone = `Bone ${info.retry + 1}`;
  await asGm(request, token, 'post', '/api/custom_dice', { name: bone, sides: 6, faces: ['1', '2', '3', '4', '5', 'Skull'].map((value) => ({ value })) });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAsGm(page);
  await openSystem(page, name);

  // No dice yet: GOOD / GREAT / BAD makes three, GOOD picked.
  await page.getByRole('group', { name: 'New dice from a preset' }).getByRole('button', { name: 'GOOD / GREAT / BAD' }).click();
  const dice = page.getByRole('navigation', { name: 'Dice' });
  // The list's own entries (the preset buttons sit under them).
  const entries = dice.locator('button[aria-current]');
  await expect(entries).toHaveCount(3);
  await expect(page.getByLabel('Die name', { exact: true })).toHaveValue('Good');

  // Face 1, blank, gets a +2 and a HIT.
  const faces = page.getByRole('region', { name: 'Faces' });
  await faces.getByRole('button', { name: 'Face 1: BLANK' }).click();
  await page.getByLabel('Face 1 number').fill('2');
  await page.getByLabel('Face 1 number').press('Enter');
  await page.getByLabel('Add a symbol to face 1').selectOption({ label: 'HIT' });
  await expect(faces.getByRole('button', { name: 'Face 1: +2 HIT' })).toBeVisible();

  // HIT drawn on the pad: a stroke across a row.
  const hit = page.getByRole('group', { name: 'Symbol Hit' });
  await hit.getByRole('group', { name: 'Hit: look' }).getByRole('button', { name: 'DRAW' }).click();
  const pad = hit.getByRole('group', { name: 'Drawing of Hit' });
  const first = (await pad.getByRole('button', { name: 'Square 3, 8' }).boundingBox())!;
  const last = (await pad.getByRole('button', { name: 'Square 14, 8' }).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 14 });
  await page.mouse.up();
  await expect(pad.getByRole('button', { name: /^Square \d+, 8$/, pressed: true })).toHaveCount(12);
  await expect(hit.getByLabel('Hit on the dice').locator('rect')).toHaveCount(12);
  if (process.env.GRAPH_SHOTS) await page.screenshot({ path: path.join(SHOTS, 'builder-dice-tab.png'), fullPage: true });
  await hit.getByRole('button', { name: 'DONE' }).click();

  // TEST: four GOOD dice thrown by the server, each face as the log writes it.
  const test_ = page.getByTestId('test-dice');
  await test_.getByRole('button', { name: 'THROW ▸' }).click();
  await expect(test_.getByTestId('test-dice-faces').locator('span')).toHaveCount(4);
  await expect(test_.getByTestId('test-dice-left')).toHaveText(/(\d+ (HIT|EDGE|MISS|SNAG|CRIT)(, )?)+|NOTHING LEFT/);

  // COPY FROM THE TABLE'S DICE: the Bone die, its SKULL a symbol now.
  await dice.getByRole('button', { name: "COPY FROM THE TABLE'S DICE" }).click();
  await page.getByRole('group', { name: "The table's dice" }).getByRole('button', { name: new RegExp(`^${bone.toUpperCase()}`) }).click();
  await expect(page.getByLabel('Die name', { exact: true })).toHaveValue(bone);
  await expect(page.getByRole('group', { name: 'Symbol Skull' })).toBeVisible();

  // ROLLS (6c3): a roll of two GOOD dice, reading what is left of HIT, at least one to succeed.
  await page.getByRole('tab', { name: 'ROLLS', exact: true }).click();
  await page.getByRole('group', { name: 'New roll from a preset' }).getByRole('button', { name: 'PBTA MOVE' }).click();
  await page.getByLabel('Dice 1: size').selectOption({ label: 'GOOD' });
  await page.getByRole('group', { name: 'Read the dice as' }).getByRole('button', { name: 'COUNT THE SYMBOLS' }).click();
  await page.getByLabel('Read what is left of').selectOption({ label: 'HIT' });
  const testRoll = page.getByTestId('test-roll');
  await testRoll.getByRole('button', { name: 'TEST ROLL ▸' }).click();
  await expect(testRoll.getByTestId('test-working')).toHaveText(/ Good .*= ((\d+ (HIT|EDGE|MISS|SNAG|CRIT)(, )?)+|NOTHING LEFT)\]/);
  await page.getByRole('tab', { name: 'DICE', exact: true }).click();

  // Kept: after a reload, the dice and the drawing are as they were left.
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.reload();
  await signInAsGm(page);
  await openSystem(page, name);
  await expect(entries).toContainText([/^GOOD/, /^GREAT/, /^BAD/, new RegExp(`^${bone.toUpperCase()}`)]);
  await expect(page.getByRole('group', { name: 'Symbol Hit' }).getByLabel('Hit on the dice').locator('rect')).toHaveCount(12);
});
