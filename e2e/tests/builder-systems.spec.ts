import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, clickRail } from './helpers';

// MY SYSTEMS, as a GM uses it. A system just made opens in the builder, and DELETE is off while it
// is open; with no CLOSE, the only way to free it was to make or open another (found by hand,
// 2026-10-16).

test('a system just made can be closed, then deleted', async ({ page }, info) => {
  const name = `Throwaway ${info.retry + 1}`;
  await signInAsGm(page);
  await openBuilder(page);
  await page.getByRole('tab', { name: /NEW$/ }).click();
  await page.locator('#systems-new-name').fill(name);
  await page.getByRole('button', { name: 'CREATE', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'SETUP', exact: true })).toBeVisible();

  await clickRail(page, 'MY SYSTEMS');
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  await expect(card.getByText('OPEN NOW IN THE BUILDER')).toBeVisible();
  await expect(card.getByRole('button', { name: 'DELETE', exact: true })).toBeDisabled();

  await card.getByRole('button', { name: 'CLOSE', exact: true }).click();
  await expect(page.getByTestId('builder-system')).toContainText('NO SYSTEM OPEN');
  // Closed, it is a system like any other: opened out, and deletable.
  if (!(await card.getByRole('button', { name: 'DELETE', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'DELETE', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: `Delete ${name}` });
  await confirm.getByRole('button', { name: 'DELETE', exact: true }).click();
  await expect(page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() })).toHaveCount(0);
});
