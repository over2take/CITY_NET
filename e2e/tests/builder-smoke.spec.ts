import { test, expect } from '@playwright/test';
import { GM } from '../playwright.config';

// The first browser journey (4l1): the GM signs in on the real sign-in screen, opens the System
// Builder from the GAME tab, meets the first-time tour (the database is new, so it hasn't been
// seen), skips it, finds MY SYSTEMS, and goes back to the map. The builder journey proper (4l2)
// builds on this.

test('the GM signs in and opens the System Builder', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('OPERATOR_ID').fill(GM.username);
  await page.getByPlaceholder('PASSWORD').fill(GM.password);
  await page.getByRole('button', { name: 'LOGIN', exact: true }).click();

  // Signed in as the GM: the dashboard's GAME tab, then TTRPG_SYSTEM, then the builder.
  await page.getByRole('button', { name: 'GAME', exact: true }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: /TTRPG_SYSTEM$/ }).click();
  await page.getByRole('button', { name: 'SYSTEM BUILDER', exact: true }).click();

  const builder = page.getByRole('main', { name: 'System builder' });
  await expect(builder).toBeVisible();
  // A new database: the tour shows the first time, and goes for good once skipped.
  const tour = page.getByRole('dialog', { name: 'The builder tour' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'SKIP THE TOUR' }).click();
  await expect(tour).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'MY SYSTEMS' })).toBeVisible();

  await page.getByRole('button', { name: 'Exit the builder and go back to the map' }).click();
  await expect(builder).toBeHidden();
});
