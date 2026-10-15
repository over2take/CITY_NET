import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { GM } from '../playwright.config';

// What every journey does first: sign in, find the builder. Found the way a person would, by
// what the buttons and boxes say.

/** The GM signs in on the real sign-in screen (Secure Mode). */
export const signInAsGm = async (page: Page) => {
  await page.goto('/');
  await page.getByPlaceholder('OPERATOR_ID').fill(GM.username);
  await page.getByPlaceholder('PASSWORD').fill(GM.password);
  await page.getByRole('button', { name: 'LOGIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'GAME', exact: true })).toBeVisible({ timeout: 30_000 });
};

/** The GM's sign-in token, for setting things up through the API rather than the screen. */
export const gmToken = async (request: APIRequestContext) => {
  const res = await request.post('/api/login', { data: GM });
  expect(res.ok()).toBe(true);
  return (await res.json()).token as string;
};

/** The dashboard's GAME tab, open at TTRPG_SYSTEM. */
export const openGameSystem = async (page: Page) => {
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  const section = page.getByRole('button', { name: /TTRPG_SYSTEM$/ });
  if (!(await section.textContent())?.startsWith('▾')) await section.click();
};

/** From the GAME tab into the System Builder, past the first-time tour if it shows. */
export const openBuilder = async (page: Page) => {
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SYSTEM BUILDER', exact: true }).click();
  await expect(page.getByRole('main', { name: 'System builder' })).toBeVisible();
  const tour = page.getByRole('dialog', { name: 'The builder tour' });
  if (await tour.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) {
    await tour.getByRole('button', { name: 'SKIP THE TOUR' }).click();
    await expect(tour).toBeHidden();
  }
};

/** A page of the builder, from the rail. */
export const builderPage = async (page: Page, name: string) => {
  await page.getByRole('navigation', { name: 'Builder' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
};
