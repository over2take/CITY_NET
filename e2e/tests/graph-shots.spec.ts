import { test } from '@playwright/test';
import path from 'path';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// Reference pictures of the graph view, to look at by eye before a PR that changes how it looks
// (5a3a): the CWN example as the map opens, fitted, and in each theme. Not a check, so it runs
// only when asked:
//
//   GRAPH_SHOTS=1 npx playwright test tests/graph-shots.spec.ts
//
// (PowerShell: $env:GRAPH_SHOTS=1; npx playwright test tests/graph-shots.spec.ts)
// The pictures go to docs/mockups/shots/, which git ignores, like the rest of docs/.

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'mockups', 'shots');
const THEMES = ['classic', 'vaporwave', 'cyberpunk', 'crimson', 'ocean', 'solar', 'monochrome'];

test.skip(!process.env.GRAPH_SHOTS, 'Pictures only when asked: GRAPH_SHOTS=1');

test('the graph view, for looking at', async ({ page, request }, info) => {
  const name = `Shots CWN ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { name, example: 'cwn' });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByTestId('graph-view').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-open.png') });
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-fit.png') });
  for (const theme of THEMES) {
    await page.evaluate((t) => {
      const root = document.querySelector('.crt-container') as HTMLElement;
      root.className = root.className.replace(/theme-\S+/, `theme-${t}`);
    }, theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `graph-cwn-theme-${theme}.png`), clip: { x: 0, y: 0, width: 1440, height: 520 } });
  }
});
