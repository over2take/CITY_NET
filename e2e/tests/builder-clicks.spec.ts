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

/**
 * Every name and column head out of line with what it names (the alignment pass, R1b): a name beside
 * its field more than 4px above or below the middle of the field's first line, and a column head
 * whose words start more than 4px from its column's. Each page placed its own names by hand, and they
 * drifted up to 50px (FieldName's `beside` now does it); and #root's centred text put a table's
 * cells off their heads. A name is the uppercase words in the first of two columns of a grid.
 */
const misaligned = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="builder-screen"]')!;
  const seen = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const middle = (r: DOMRect) => r.top + r.height / 2;
  const CONTROL = 'input:not([type=hidden]), select, textarea, button:not([role=note]), [role=switch], [role=group]';
  const found: string[] = [];
  for (const grid of root.querySelectorAll('*')) {
    const cs = getComputedStyle(grid);
    if (cs.display !== 'grid' || !seen(grid) || cs.gridTemplateColumns.split(' ').length !== 2) continue;
    const kids = [...grid.children].filter(seen);
    for (let i = 0; i + 1 < kids.length; i += 2) {
      const [name, field] = [kids[i], kids[i + 1]];
      const words = text(name);
      if (!/[A-Z]/.test(words) || words.length > 30 || words !== words.toUpperCase() || name.querySelector('input, select, textarea, button:not([role=note])')) continue;
      // The field's first line: the first button of a group that may wrap, a text box's first line.
      let first = field.matches(CONTROL) ? field : field.querySelector(CONTROL);
      if (first?.matches('[role=group]')) first = first.querySelector('input:not([type=hidden]), select, button:not([role=note]), [role=switch]') ?? first;
      if (!first || !seen(first)) continue;
      const box = first.getBoundingClientRect();
      const line = first.matches('textarea') ? box.top + 12 : middle(box);
      const dy = Math.round(middle((name.querySelector('label, span') || name).getBoundingClientRect()) - line);
      if (Math.abs(dy) > 4) found.push(`name "${words}" ${Math.abs(dy)}px ${dy < 0 ? 'above' : 'below'} its field`);
    }
  }
  for (const th of root.querySelectorAll('thead th')) {
    if (!seen(th) || !text(th)) continue;
    const heads = th.parentElement!.children;
    const row = [...(th.closest('table')!.tBodies[0]?.rows ?? [])].find((r) => r.cells.length === heads.length);
    const cell = row?.cells[[...heads].indexOf(th)];
    const ctl = cell?.querySelector('input:not([type=hidden]), select, textarea, button') || cell?.firstElementChild;
    if (!ctl || !seen(ctl)) continue;
    const range = document.createRange();
    range.selectNodeContents(th);
    const dx = Math.round(range.getBoundingClientRect().left - ctl.getBoundingClientRect().left);
    if (Math.abs(dx) > 4) found.push(`column "${text(th)}" ${Math.abs(dx)}px ${dx < 0 ? 'left' : 'right'} of its column`);
  }
  return [...new Set(found)];
});
/** What a person would find wrong with the page as it stands: a control a click misses, or one out of line. */
const faults = async (page: Page) => [...await unreachable(page), ...await misaligned(page)];

test('every control in the builder takes a click, on every page', async ({ page }) => {
  await signInAsGm(page);
  await openBuilder(page);
  const missed: Record<string, string[]> = {};
  for (const [label, name] of [['YOUR SYSTEMS', /^YOUR SYSTEMS/], ['+ NEW', /NEW$/], ['INSTALL A FILE', /^INSTALL A FILE$/]] as const) {
    await page.getByRole('tab', { name }).click();
    missed[`MY SYSTEMS · ${label}`] = await faults(page);
  }
  await page.getByRole('tab', { name: /NEW$/ }).click();
  await page.locator('#systems-new-name').fill(`Clicks ${test.info().retry}`);
  await page.getByRole('button', { name: 'CREATE', exact: true }).click();
  // A condition that changes every roll, so TEST ROLL shows its condition switches (6b3c) when
  // ROLLS is swept: + MODIFIER gives the open condition ALL ROLLS -1.
  await builderPage(page, 'CONDITIONS');
  await page.getByRole('button', { name: '+ MODIFIER' }).click();
  for (const p of ['SETUP', 'WORDS', 'PARTS', 'STATS & RULES', 'CHOICES', 'CHARACTER SHEET', 'NPCS', 'CONDITIONS', 'RESTS', 'HOUSE RULES', 'TRY IT']) {
    await builderPage(page, p);
    if (p === 'CHOICES') {
      // A list picking several, with an option, so every box on the page is there (7a2b1); a second
      // list first, for its feature to open (HOW MANY, 7a5a2).
      await page.getByRole('button', { name: '+ LIST' }).click();
      await page.getByRole('button', { name: '+ LIST' }).click();
      await page.getByRole('group', { name: 'A character picks' }).getByRole('button', { name: 'SEVERAL' }).click();
      // Levelled, so the option has its HIT DIE, OTHER open for its sides (R1b).
      await page.getByRole('switch', { name: /LEVELLED/ }).click();
      await page.getByRole('button', { name: '+ OPTION' }).click();
      await expect(page.getByRole('region', { name: 'NEW OPTION option' })).toBeVisible();
      await page.getByRole('group', { name: 'Hit die' }).getByRole('button', { name: 'OTHER' }).click();
      await expect(page.getByRole('spinbutton', { name: 'Sides' })).toBeVisible();
      // A feature open, with uses and a modifier, so every box of the features editor is there (7a2b2).
      await page.getByRole('button', { name: '+ FEATURE' }).click();
      const feature = page.getByRole('group', { name: 'Feature NEW FEATURE' });
      await feature.getByRole('switch', { name: /HAS USES/ }).click();
      await feature.getByRole('button', { name: '+ MODIFIER' }).click();
      await feature.getByRole('combobox', { name: 'OPENS A LIST' }).selectOption({ label: 'NEW CHOICE' });
      await expect(feature.getByRole('spinbutton', { name: 'HOW MANY' })).toBeVisible();
      // The modifier's formula box with its help open, so SHAPE and INSERT are there (formula box 1).
      await feature.getByRole('button', { name: 'Help writing Modifier 1: by' }).click();
      await expect(feature.getByRole('group', { name: 'Help writing Modifier 1: by' })).toBeVisible();
    }
    if (p === 'STATS & RULES') {
      // A group with a stat, so its table and column heads are there.
      await page.getByRole('button', { name: '+ GROUP' }).click();
      await page.getByRole('button', { name: '+ STAT' }).click();
      await expect(page.getByRole('columnheader', { name: 'LOWEST' })).toBeVisible();
    }
    if (p === 'RESTS') {
      // Recovery dice on, counted by a formula and given back by an amount, so every box is there (R1b).
      const resting = page.getByRole('region', { name: 'Resting' });
      await resting.getByRole('switch', { name: 'Recovery dice' }).click();
      await resting.getByRole('group', { name: 'Each has' }).getByRole('button', { name: 'A FORMULA' }).click();
      await resting.getByRole('group', { name: 'LONG REST gives back' }).getByRole('button', { name: 'BY AN AMOUNT' }).click();
      await expect(resting.getByRole('textbox', { name: 'LONG REST gives back by' })).toBeVisible();
    }
    missed[p] = await faults(page);
    if (p === 'CHOICES') {
      // IMPORT open over the list, a file previewed with a mistake, so its warning and links are there (choices import 2).
      await page.getByRole('button', { name: 'IMPORT', exact: true }).click();
      await page.getByRole('textbox', { name: 'Text to import' }).fill('[options]\nname\nRanger\n[features]\noption, feature, uses, refill\nRanger, Ward, 1, Dawn');
      await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Preview' }).getByRole('alert')).toBeVisible();
      missed[`${p} · IMPORT`] = await faults(page);
    }
    if (p === 'STATS & RULES') {
      // Each of its tabs, not only the first.
      for (const tab of ['FORMULAS', 'TABLES', 'DICE', 'ROLLS']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        missed[`${p} · ${tab}`] = await faults(page);
        if (tab === 'DICE') {
          // Dice made from a preset, and a symbol's drawing pad and icons open (6c2b2).
          await page.getByRole('group', { name: 'New dice from a preset' }).getByRole('button', { name: 'GOOD / GREAT / BAD' }).click();
          const hit = page.getByRole('group', { name: 'Symbol Hit' });
          await hit.getByRole('group', { name: 'Hit: look' }).getByRole('button', { name: 'DRAW' }).click();
          await expect(hit.getByRole('group', { name: 'Drawing of Hit' })).toBeVisible();
          missed[`${p} · DICE · A DIE AND THE PAD`] = await faults(page);
          await hit.getByRole('group', { name: 'Hit: look' }).getByRole('button', { name: 'ICON' }).click();
          missed[`${p} · DICE · ICONS`] = await faults(page);
        }
      }
      // ROLLS shows one roll at a time: three made from presets, so all five steps and TEST ROLL
      // have something in them. Blades' push with its cost (TAKES or ADDS); Vampire's Hunger dice
      // with their effects and glitch; CWN's save, whose target opens PLAYERS SEE in step 3 (6c4h).
      for (const preset of ['BLADES ACTION', 'VAMPIRE POOL', 'CWN SAVE']) {
        if (preset !== 'BLADES ACTION') await page.getByRole('navigation', { name: 'Rolls' }).getByRole('button', { name: '+ ROLL' }).click();
        await page.getByRole('group', { name: 'New roll from a preset' }).getByRole('button', { name: preset }).click();
        await expect(page.getByTestId('test-roll').getByRole('group', { name: 'Conditions on the sample' })).toBeVisible();
        missed[`${p} · ROLLS · ${preset}`] = await faults(page);
      }
      await page.getByRole('tab', { name: 'STATS', exact: true }).click();
      // And as a map (5a3a): the map's own controls, then back to FORMS, as the next journeys expect.
      const view = page.getByRole('group', { name: 'View' });
      await view.getByRole('button', { name: 'GRAPH' }).click();
      await expect(page.getByTestId('graph-view')).toBeVisible();
      missed[`${p} · GRAPH`] = await faults(page);
      // A roll's panel on the map (6b4a): the ROLLS tab's five steps and TEST ROLL, in the side panel.
      await page.getByTestId('graph-node-roll:blades_action').click();
      await expect(page.getByTestId('graph-panel').getByTestId('test-roll')).toBeVisible();
      missed[`${p} · GRAPH · ROLL PANEL`] = await faults(page);
      await page.keyboard.press('Escape');
      await view.getByRole('button', { name: 'FORMS' }).click();
    }
    if (p === 'NPCS') {
      // Its second tab, the tiers.
      await page.getByRole('tab', { name: 'TIERS', exact: true }).click();
      missed[`${p} · TIERS`] = await faults(page);
      await page.getByRole('tab', { name: 'STAT BLOCK', exact: true }).click();
    }
  }
  // HELP's WHO SEES THE TARGET (6c4h), opened as a GM would from the ROLLS tab: its settings,
  // ROLL AGAIN and the two trays.
  await builderPage(page, 'STATS & RULES');
  await page.getByRole('tab', { name: 'ROLLS', exact: true }).click();
  await page.getByRole('button', { name: 'HOW PLAYERS SEE IT' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'HELP', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'WHO SEES THE TARGET' })).toBeVisible();
  await expect(page.getByTestId('target-seen-example')).toBeVisible();
  missed['HELP · WHO SEES THE TARGET'] = await faults(page);
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
