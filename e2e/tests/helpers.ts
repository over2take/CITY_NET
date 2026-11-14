import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { GM } from '../playwright.config';

// What every journey does first: sign in, find the builder. Found the way a person would, by
// what the buttons and boxes say.

/** Someone signs in on the real sign-in screen (Secure Mode), the GM and players alike. */
const signIn = async (page: Page, who: { username: string; password: string }) => {
  await page.goto('/');
  await page.getByPlaceholder('OPERATOR_ID').fill(who.username);
  await page.getByPlaceholder('PASSWORD').fill(who.password);
  await page.getByRole('button', { name: 'LOGIN', exact: true }).click();
};

/** The GM signs in, and has the admin panel. */
export const signInAsGm = async (page: Page) => {
  await signIn(page, GM);
  await expect(page.getByRole('button', { name: 'GAME', exact: true })).toBeVisible({ timeout: 30_000 });
};

/** A player signs in, and has the map's rail. */
export const signInAsPlayer = async (page: Page, player: { username: string; password: string }) => {
  await signIn(page, player);
  await expect(page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true })).toBeVisible({ timeout: 30_000 });
};

/** The GM's sign-in token, for setting things up through the API rather than the screen. */
export const gmToken = async (request: APIRequestContext) => {
  const res = await request.post('/api/login', { data: GM });
  expect(res.ok()).toBe(true);
  return (await res.json()).token as string;
};

/** A request made as the GM, its answer checked and read. */
export const asGm = async (request: APIRequestContext, token: string, method: 'get' | 'post' | 'put', url: string, data?: object) => {
  const res = await request[method](url, { data, headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok(), `${method.toUpperCase()} ${url}: ${await res.text()}`).toBe(true);
  return res.json();
};

/** A system made from a whole definition, published, and switched to as the running game. Its id. */
export const runningSystem = async (request: APIRequestContext, token: string, definition: object) => {
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition });
  await asGm(request, token, 'post', `/api/systems/${id}/publish`);
  await asGm(request, token, 'put', '/api/sheets/system', { system: id });
  return id as string;
};

/** A player account, registered as a player would and approved as the GM would. */
export const approvedPlayer = async (request: APIRequestContext, token: string, player: { username: string; password: string }) => {
  const res = await request.post('/api/player/register', {
    data: { ...player, security_question: 'The test that made this?', security_answer: 'e2e' },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await asGm(request, token, 'post', `/api/player/admin/players/${player.username}/approve`);
};

/**
 * A tab of an open character sheet. A built system's starter has STATS (the numbers, and RESTS),
 * CHARACTER (the name and the picks: CLASSES, FEATS), GEAR and NOTES; only the open tab is drawn.
 */
export const sheetTab = (page: Page, tab: 'STATS' | 'CHARACTER' | 'GEAR' | 'NOTES') =>
  page.getByRole('button', { name: tab, exact: true }).click();

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

/** A button on the builder's rail, clicked. The rail widens over the page while the pointer is on
 *  it, so the pointer then moves off it to the page, as a person's would, and the rail narrows
 *  again; otherwise it covers whatever sits at the page's left edge. It narrows over 0.2 s, and
 *  data-expanded turns false as it starts, so the wait is for the narrowing to finish too: on
 *  CI's slower runner the clicks sweep measured FEATURES' (now PARTS') switches under the rail still closing. */
export const clickRail = async (page: Page, name: string) => {
  const rail = page.getByRole('navigation', { name: 'Builder' });
  await rail.getByRole('button', { name, exact: true }).click();
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width - 20, height / 2);
  await expect(rail).toHaveAttribute('data-expanded', 'false');
  await expect.poll(() => rail.evaluate((el) => el.getAnimations().length)).toBe(0);
};

/** A page of the builder, from the rail. */
export const builderPage = async (page: Page, name: string) => {
  await clickRail(page, name);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
};
