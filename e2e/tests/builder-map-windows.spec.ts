import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder } from './helpers';

// The map's windows while the system builder is open (the user, 2026-10-30): any window open on the
// map used to come over the builder, as it stacked above it. Now the builder takes over the screen:
// the map's windows are hidden while it is open, never closed, Esc in the builder leaves them alone,
// and leaving the builder brings them back as they were.

test('a window open on the map is hidden in the builder, untouched by Esc, and back on leaving', async ({ page }) => {
  await signInAsGm(page);
  // The dice tray, open on the map.
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await page.getByRole('button', { name: 'DICE_TRAY.exe' }).click();
  const tray = page.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible();

  // Into the builder: the tray is hidden, and Esc there leaves it be.
  await openBuilder(page);
  await expect(tray).toBeHidden();
  await page.getByTestId('builder-screen').click({ position: { x: 600, y: 300 } });
  await page.keyboard.press('Escape');

  // Back to the map: the tray is there again, as it was.
  await page.getByRole('navigation', { name: 'Builder' }).getByRole('button', { name: 'Exit the builder and go back to the map' }).click();
  await expect(page.getByRole('main', { name: 'System builder' })).toBeHidden();
  await expect(tray).toBeVisible();
});
