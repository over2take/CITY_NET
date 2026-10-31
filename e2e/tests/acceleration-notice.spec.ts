import { test, expect } from '@playwright/test';
import { signInAsGm } from './helpers';

// HARDWARE ACCELERATION IS OFF (2026-10-31): a browser drawing the map on the processor says so,
// with how to turn acceleration on, until it is dismissed. The test browser draws on a graphics card
// on a desktop and in software on CI, so the page plays one with acceleration off: asked for a
// context that won't run slowly, it has none, as such a browser answers. Every other journey runs
// in an automated browser, which is never told, so this one asks for the check
// (citynet:accelCheckAnyway).

test('a browser drawing in software is told how to turn acceleration on, until it dismisses it', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('citynet:accelCheckAnyway', '1');
    const own = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, kind: string, options?: { failIfMajorPerformanceCaveat?: boolean }) {
      if (options && options.failIfMajorPerformanceCaveat) return null;
      return (own as (...a: unknown[]) => unknown).call(this, kind, options);
    } as typeof own;
  });
  await signInAsGm(page);
  const notice = page.getByRole('status', { name: 'Hardware acceleration is off' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('HARDWARE ACCELERATION IS OFF: THE 3D MAP WILL BE SLOW');
  await expect(notice.getByRole('listitem').first()).toBeVisible();
  await notice.getByRole('button', { name: 'DISMISS' }).click();
  await expect(notice).toBeHidden();
  // Dismissed for good in this browser.
  await page.reload();
  await signInAsGm(page);
  await expect(notice).toBeHidden();
});
