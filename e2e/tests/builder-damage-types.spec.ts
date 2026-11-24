import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm, runningSystem } from './helpers';

// The builder's DAMAGE TYPES page (8b1b; approved mockup docs/mockups/damage-pipeline.html, section 1). By clicks: FIRE
// switched off, COLD renamed Frost, + TYPE made Sonic with the WAVE icon, + TYPE made Laser drawn on the pad, a name two
// types would share refused beside it, what RESIST means typed. Saved as made, with no problems.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
});

test('DAMAGE TYPES: FIRE off, COLD renamed, Sonic with an icon, Laser drawn, a shared name refused, RESIST\'s words; saved as made (8b1b)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Damagefall${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, SYSTEM(name));

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  await expect(card).toBeVisible();
  if (!(await card.getByText('OPEN NOW', { exact: true }).first().isVisible())) {
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  }
  await builderPage(page, 'DAMAGE TYPES');
  const list = page.getByRole('list', { name: 'Damage types' });
  await expect(page.getByText('13 ON · 17 OF 40')).toBeVisible();

  // FIRE off; COLD renamed.
  await list.getByRole('switch', { name: 'Fire on' }).click();
  await list.getByRole('button', { name: 'COLD', exact: true }).click();
  await page.getByRole('region', { name: 'Cold damage type' }).getByRole('textbox', { name: 'NAME' }).fill('Frost');

  // + TYPE: Sonic, the WAVE icon.
  await page.getByRole('button', { name: '+ TYPE' }).click();
  const sonic = page.getByRole('region', { name: 'New type damage type' });
  await sonic.getByRole('textbox', { name: 'NAME' }).fill('Sonic');
  await page.getByRole('region', { name: 'Sonic damage type' }).getByRole('radio', { name: 'wave' }).click();

  // + TYPE: Laser, drawn on the pad, a square at its corner.
  await page.getByRole('button', { name: '+ TYPE' }).click();
  const laser = page.getByRole('region', { name: 'New type damage type' });
  await laser.getByRole('textbox', { name: 'NAME' }).fill('Laser');
  const open = page.getByRole('region', { name: 'Laser damage type' });
  await open.getByRole('button', { name: 'DRAW' }).click();
  await expect(open.getByText('ON THE HEALTH PAGE')).toBeVisible();
  await open.getByRole('group', { name: 'Drawing of Laser' }).getByRole('button', { name: 'Square 1, 1', exact: true }).click();
  await expect(open.getByRole('group', { name: 'Drawing of Laser' }).getByRole('button', { name: 'Square 1, 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await open.getByRole('button', { name: 'DONE' }).click();

  // A name Sonic has: refused beside it; then its own again.
  await open.getByRole('textbox', { name: 'NAME' }).fill('Sonic');
  await expect(page.getByRole('region', { name: 'Sonic damage type' }).getByRole('alert'))
    .toHaveText('SONIC is already the name of damage type new_type; a hit names its type, so each needs its own');
  await page.getByRole('region', { name: 'Sonic damage type' }).getByRole('textbox', { name: 'NAME' }).fill('Laser');
  await expect(page.getByRole('region', { name: 'Laser damage type' }).getByRole('alert')).toHaveCount(0);

  // What RESIST means in this game.
  await page.getByRole('region', { name: 'In this game' }).getByRole('textbox', { name: 'RESIST' }).fill('Half, rounded up.');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.damage).toEqual({
    types: {
      fire: { on: false },
      cold: { name: 'Frost' },
      new_type: { name: 'Sonic', icon: 'wave' },
      new_type_2: { name: 'Laser', drawn: ['8000', ...Array(15).fill('0000')] },
    },
    resist: { means: 'Half, rounded up.' },
  });
});
