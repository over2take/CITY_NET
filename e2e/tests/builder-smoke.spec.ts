import { test, expect } from '@playwright/test';
import { signInAsGm, openGameSystem, gmToken } from './helpers';

// The first browser journey (4l1): the GM signs in on the real sign-in screen, opens the System
// Builder from the GAME tab, meets the first-time tour, skips it, finds MY SYSTEMS, and goes back to
// the map.

test('the GM signs in and opens the System Builder, the tour shown until skipped', async ({ page, request }) => {
  // The tour shows only while it hasn't been seen; another journey in this run may have skipped it.
  await request.put('/api/systems/tour', { headers: { Authorization: `Bearer ${await gmToken(request)}` }, data: { seen: false } });

  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SYSTEM BUILDER', exact: true }).click();

  const builder = page.getByRole('main', { name: 'System builder' });
  await expect(builder).toBeVisible();
  const tour = page.getByRole('dialog', { name: 'The builder tour' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'SKIP THE TOUR' }).click();
  await expect(tour).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'MY SYSTEMS' })).toBeVisible();

  await page.getByRole('button', { name: 'Exit the builder and go back to the map' }).click();
  await expect(builder).toBeHidden();
});
