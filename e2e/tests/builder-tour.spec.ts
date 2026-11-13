import { test, expect } from '@playwright/test';
import { signInAsGm, openGameSystem, gmToken } from './helpers';

// The first-time tour walked in a real browser (Phase 7's end, 2026-11-13): every step down the rail, ITEMS, NEW CHARACTER
// and LEVELS among them, on a small laptop's window. At each, the rail item it explains is the one lit, the arrow points at it (level with it, to its
// right), and the tour is wholly on the screen, low on the rail too. DONE ends it, remembered.

const STEPS: { title: string; lit: string[] }[] = [
  { title: 'WELCOME TO THE SYSTEM BUILDER', lit: [] },
  { title: 'SETUP', lit: ['SETUP'] },
  { title: 'WORDS', lit: ['WORDS'] },
  { title: 'PARTS', lit: ['PARTS'] },
  { title: 'STATS & RULES', lit: ['STATS & RULES'] },
  { title: 'CHOICES', lit: ['CHOICES'] },
  { title: 'ITEMS', lit: ['ITEMS'] },
  { title: 'CHARACTER SHEET', lit: ['CHARACTER SHEET'] },
  { title: 'NEW CHARACTER', lit: ['NEW CHARACTER'] },
  { title: 'LEVELS', lit: ['LEVELS'] },
  { title: 'TRY IT', lit: ['TRY IT'] },
  { title: 'SAVE AND PUBLISH', lit: ['SAVE', 'PUBLISH'] },
];

test('the tour walked down the rail: each step lights its place, the arrow at it, all on screen', async ({ page, request }) => {
  const token = await gmToken(request);
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  // Shown only while it hasn't been seen; another journey in this run may have ended it.
  await request.put('/api/systems/tour', { ...auth, data: { seen: false } });

  // A small laptop's window: the rail scrolls, and the box sits at the bottom for the lower steps.
  await page.setViewportSize({ width: 1280, height: 720 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SYSTEM BUILDER', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'The builder tour' });
  await expect(tour).toBeVisible();
  const rail = page.getByRole('navigation', { name: 'Builder' });
  const viewport = page.viewportSize()!;

  for (const [i, step] of STEPS.entries()) {
    await expect(tour.getByText(`STEP ${i + 1} OF ${STEPS.length}`, { exact: true })).toBeVisible();
    await expect(tour.getByRole('heading')).toHaveText(step.title);
    const lit = rail.locator('[data-lit]');
    await expect.poll(() => lit.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(step.lit);
    // Wholly on the screen.
    const box = (await tour.boundingBox())!;
    expect(box.y, `${step.title}: top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${step.title}: bottom`).toBeLessThanOrEqual(viewport.height);
    expect(box.x + box.width, `${step.title}: right`).toBeLessThanOrEqual(viewport.width);
    if (step.lit.length) {
      // The arrow level with what is lit, and to its right.
      const places = await Promise.all((await lit.all()).map(async (l) => (await l.boundingBox())!));
      const top = Math.min(...places.map((p) => p.y));
      const bottom = Math.max(...places.map((p) => p.y + p.height));
      const right = Math.max(...places.map((p) => p.x + p.width));
      const arrow = (await tour.getByTestId('tour-arrow').boundingBox())!;
      const middle = arrow.y + arrow.height / 2;
      expect(middle, `${step.title}: the arrow level with it`).toBeGreaterThanOrEqual(top);
      expect(middle, `${step.title}: the arrow level with it`).toBeLessThanOrEqual(bottom);
      expect(arrow.x, `${step.title}: the arrow right of it`).toBeGreaterThanOrEqual(right - 4);
    }
    if (i < STEPS.length - 1) await tour.getByRole('button', { name: 'NEXT', exact: true }).click();
  }
  await tour.getByRole('button', { name: 'DONE', exact: true }).click();
  await expect(tour).toBeHidden();
  await expect(rail.locator('[data-lit]')).toHaveCount(0);
  // Remembered: it won't show again.
  await expect.poll(async () => (await (await request.get('/api/systems/tour', auth)).json()).seen).toBe(true);
});
