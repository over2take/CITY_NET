import { expect, type Page } from '@playwright/test';

// The initiative tracker as the journeys drive it (8i2; shared with 8a9c's turn effects). The tracker's scenes are the
// table's own (city:0 is everyone's), so each journey ends what it started, and starts by ending what another left.

export const tracker = (page: Page) => page.locator('.win95-window').filter({ has: page.locator('.win95-title-text', { hasText: 'INITIATIVE.EXE' }) });
export const rows = (page: Page) => tracker(page).getByTestId('initiative-row');
/** The row whose turn it is. */
export const up = (page: Page) => tracker(page).locator('[data-testid="initiative-row"][aria-current="step"]');
/** The GM's INITIATIVE menu: ROLL ENEMIES, OPEN TRACKER, ACTIVE COMBATS. */
export const nav = (page: Page) => page.locator('.sidebar-panel').filter({ has: page.getByRole('heading', { name: 'INITIATIVE', level: 3 }) });

/** The GM's INITIATIVE menu and tracker open; a fight another test left in this scene ended first. */
export const gmTracker = async (page: Page) => {
  if (!(await nav(page).isVisible())) await page.getByRole('button', { name: 'INITIATIVE_TRACKER', exact: true }).click();
  if (!(await tracker(page).isVisible())) await nav(page).getByRole('button', { name: 'OPEN TRACKER' }).click();
  await expect(tracker(page)).toBeVisible();
  const end = tracker(page).getByRole('button', { name: /^END / });
  if (await end.isVisible()) {
    await end.click();
    await expect(tracker(page).getByRole('button', { name: /^START / })).toBeVisible({ timeout: 15_000 });
  }
};

/** START, waited for until the tracker shows the fight (ROLL ENEMIES is off till then). */
export const startFight = async (page: Page) => {
  await tracker(page).getByRole('button', { name: 'START INITIATIVE' }).click();
  await expect(tracker(page).getByText(/^ROUND 1( · NOT BEGUN)?$/)).toBeVisible({ timeout: 15_000 });
};

/** NEXT until the tracker says `round`, at most `max` presses. */
export const nextUntil = async (page: Page, round: string, max = 12) => {
  for (let i = 0; i < max && !(await tracker(page).getByText(round, { exact: true }).isVisible()); i++) {
    const before = await up(page).textContent();
    await tracker(page).getByRole('button', { name: 'NEXT', exact: true }).click();
    await expect.poll(async () => (await up(page).textContent()) !== before || (await tracker(page).getByText(round, { exact: true }).isVisible()), { timeout: 15_000 }).toBe(true);
  }
  await expect(tracker(page).getByText(round, { exact: true })).toBeVisible();
};
