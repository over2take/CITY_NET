import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { signInAsGm, openBuilder, builderPage } from './helpers';

// Every control in the builder can be reached by the pointer. The builder lives inside the map's
// overlay, which lets clicks through to the 3D map wherever nothing claims them; a control that
// doesn't claim them looks fine and does nothing. INSTALL A FILE's box took neither a click nor a
// dropped file on a real install, and nor did RENAME, CREATE or any "?" hint. Unit tests can't see
// this (they don't lay a page out), and the other journeys only clicked the buttons that happened
// to work and typed with fill(), which never asks what is under the pointer.

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'emberline.citysys');

/**
 * Every visible control in the builder that a click at its centre misses. The rail too: squeezed
 * on a short window, its EXIT TO MAP lay over MY SYSTEMS and PROBLEMS over HELP.
 */
const unreachable = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="builder-screen"]')!;
  const controls = [...root.querySelectorAll('input:not([type=hidden]), textarea, select, button, label, summary, [role=switch], [role=tab], [role=note], [draggable=true]')] as HTMLElement[];
  return controls
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .filter((el) => {
      // Scrolled to, as a person would, so a control just below the fold isn't counted as covered.
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(hit && (hit === el || el.contains(hit) || hit.contains(el)));
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" (under ${hit ? hit.tagName.toLowerCase() : 'nothing'})`;
    });
});

test('every control in the builder takes a click, on every page', async ({ page }) => {
  await signInAsGm(page);
  await openBuilder(page);
  const missed: Record<string, string[]> = {};
  for (const [label, name] of [['YOUR SYSTEMS', /^YOUR SYSTEMS/], ['+ NEW', /NEW$/], ['INSTALL A FILE', /^INSTALL A FILE$/]] as const) {
    await page.getByRole('tab', { name }).click();
    missed[`MY SYSTEMS · ${label}`] = await unreachable(page);
  }
  await page.getByRole('tab', { name: /NEW$/ }).click();
  await page.locator('#systems-new-name').fill(`Clicks ${test.info().retry}`);
  await page.getByRole('button', { name: 'CREATE', exact: true }).click();
  for (const p of ['SETUP', 'WORDS', 'FEATURES', 'STATS & RULES', 'CHARACTER SHEET', 'NPCS', 'CONDITIONS', 'RESTS', 'HOUSE RULES', 'TRY IT']) {
    await builderPage(page, p);
    missed[p] = await unreachable(page);
    if (p === 'STATS & RULES') {
      // Each of its tabs, not only the first.
      for (const tab of ['FORMULAS', 'TABLES', 'ROLLS']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        missed[`${p} · ${tab}`] = await unreachable(page);
      }
      // ROLLS shows one roll at a time: two made from presets, so all five steps and TEST ROLL
      // have something in them. Blades' push with its cost (TAKES or ADDS); Vampire's Hunger dice
      // with their effects and glitch.
      for (const preset of ['BLADES ACTION', 'VAMPIRE POOL']) {
        if (preset !== 'BLADES ACTION') await page.getByRole('navigation', { name: 'Rolls' }).getByRole('button', { name: '+ ROLL' }).click();
        await page.getByRole('group', { name: 'New roll from a preset' }).getByRole('button', { name: preset }).click();
        await expect(page.getByTestId('test-roll')).toBeVisible();
        missed[`${p} · ROLLS · ${preset}`] = await unreachable(page);
      }
      await page.getByRole('tab', { name: 'STATS', exact: true }).click();
      // And as a map (5a3a): the map's own controls, then back to FORMS, as the next journeys expect.
      const view = page.getByRole('group', { name: 'View' });
      await view.getByRole('button', { name: 'GRAPH' }).click();
      await expect(page.getByTestId('graph-view')).toBeVisible();
      missed[`${p} · GRAPH`] = await unreachable(page);
      await view.getByRole('button', { name: 'FORMS' }).click();
    }
    if (p === 'NPCS') {
      // Its second tab, the tiers.
      await page.getByRole('tab', { name: 'TIERS', exact: true }).click();
      missed[`${p} · TIERS`] = await unreachable(page);
      await page.getByRole('tab', { name: 'STAT BLOCK', exact: true }).click();
    }
  }
  expect(Object.fromEntries(Object.entries(missed).filter(([, v]) => v.length))).toEqual({});
});

test('INSTALL A FILE opens the file picker when clicked, and takes a dropped file', async ({ page }) => {
  await signInAsGm(page);
  await openBuilder(page);
  await page.getByRole('tab', { name: /^INSTALL A FILE$/ }).click();
  const box = page.locator('label').filter({ has: page.getByLabel('System file') });

  // Clicked, as a person would: the system's own file picker opens.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5_000 }), box.click()]);
  await chooser.setFiles(FIXTURE);
  await expect(page.getByTestId('install-cover')).toContainText('EMBERLINE (TEST SYSTEM)');

  // Dropped on the box, as dragged from a file explorer: the same preview.
  await page.getByRole('tab', { name: /^YOUR SYSTEMS/ }).click();
  await page.getByRole('tab', { name: /^INSTALL A FILE$/ }).click();
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const files = await page.evaluateHandle((t) => { const d = new DataTransfer(); d.items.add(new File([t], 'emberline.citysys')); return d; }, text);
  // Dropped where a person's pointer would be, so whatever is on top there gets it, as in a browser.
  const at = await box.boundingBox();
  const target = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x: at!.x + at!.width / 2, y: at!.y + at!.height / 2 });
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await target.evaluate((el, [t, d]) => el!.dispatchEvent(new DragEvent(t as string, { bubbles: true, cancelable: true, dataTransfer: d as DataTransfer })), [type, files] as const);
  }
  await expect(page.getByTestId('install-cover')).toContainText('EMBERLINE (TEST SYSTEM)');
});
