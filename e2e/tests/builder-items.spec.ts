import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// The builder's ITEMS page (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): an ATTUNED slot, three each, and a
// Ring of Constitution needing it, its feature +2 Con that stops at 20, made by clicks, saved as made, there after a reload.

test('ITEMS: an ATTUNED slot and a Ring of Constitution needing it, +2 Con stopping at 20, saved and kept (7e2b)', async ({ page, request }, info) => {
  const name = `Ringfall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }] } });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'ITEMS');
  };
  await openIt();

  // The slot: ATTUNED, three each.
  await page.getByRole('button', { name: '+ SLOT' }).click();
  const slot = page.getByTestId('slot-new_slot');
  await slot.getByRole('textbox', { name: 'NEW SLOT slot name' }).fill('ATTUNED');
  await slot.getByRole('spinbutton', { name: 'ATTUNED each character has' }).fill('3');

  // The ring, needing it, with Hardy: +2 Con, stopping at 20.
  await page.getByRole('button', { name: '+ ITEM' }).click();
  const fresh = page.getByRole('region', { name: 'NEW ITEM item' });
  await fresh.getByRole('textbox', { name: 'NAME' }).fill('Ring of Constitution');
  const ring = page.getByRole('region', { name: 'Ring of Constitution item' });
  await ring.getByRole('textbox', { name: 'WORDS' }).fill('A plain band, warm to the touch.');
  await ring.getByRole('combobox', { name: 'ITS FEATURES NEED' }).selectOption({ label: 'WORN AND ATTUNED' });
  await ring.getByRole('button', { name: '+ FEATURE' }).click();
  const feature = ring.getByRole('group', { name: 'Feature NEW FEATURE' });
  await feature.getByRole('textbox', { name: 'NAME' }).fill('Hardy');
  const hardy = ring.getByRole('group', { name: 'Feature Hardy' });
  await hardy.getByRole('button', { name: '+ MODIFIER' }).click();
  await hardy.getByRole('textbox', { name: 'Modifier 1: by' }).fill('2');
  await hardy.getByRole('spinbutton', { name: 'Modifier 1: stops at' }).fill('20');
  await expect(hardy.getByText('NEVER TAKES IT PAST 20')).toBeVisible();
  // An item's feature has no level, list or increase.
  await expect(hardy.getByText('OPENS A LIST')).toHaveCount(0);
  await expect(hardy.getByText('INCREASE', { exact: true })).toHaveCount(0);

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.items).toEqual({
    slots: [{ id: 'new_slot', label: 'ATTUNED', count: 3 }],
    list: [{ id: 'new_item', label: 'Ring of Constitution', description: 'A plain band, warm to the touch.', needs: 'new_slot',
      features: [{ id: 'new_feature', label: 'Hardy', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] }],
  });

  // Kept: a reload finds it, saying what it needs.
  await page.reload();
  await openIt();
  await expect(page.getByRole('button', { name: /RING OF CONSTITUTION/ })).toContainText('WORN AND ATTUNED');
});

// INSTALLS (7e4b; approved mockup docs/mockups/installed.html, 2026-11-11): CYBERWARE costing against Strain, never past
// Might, and a Cranial Jack installed as it at 0.25, made by clicks, saved as made, there after a reload.
test('INSTALLS: CYBERWARE against Strain never past Might, and a Cranial Jack costing 0.25, saved and kept (7e4b)', async ({ page, request }, info) => {
  const name = `Wirefall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'strain', label: 'Strain' }] }] } });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'ITEMS');
  };
  await openIt();

  await page.getByRole('button', { name: '+ INSTALL' }).click();
  const install = page.getByTestId('install-new_install');
  await install.getByRole('textbox', { name: 'NAME' }).fill('CYBERWARE');
  await install.getByRole('combobox', { name: 'COSTS AGAINST' }).selectOption({ label: 'STRAIN' });
  await install.getByRole('textbox', { name: 'CYBERWARE limit' }).fill('@might');
  // The limit read in words, from the formula box.
  await expect(install.getByRole('status')).toContainText(/MIGHT/i, { timeout: 15_000 });

  await page.getByRole('button', { name: '+ ITEM' }).click();
  await page.getByRole('region', { name: 'NEW ITEM item' }).getByRole('textbox', { name: 'NAME' }).fill('Cranial Jack');
  const jack = page.getByRole('region', { name: 'Cranial Jack item' });
  await jack.getByRole('combobox', { name: 'ITS FEATURES NEED' }).selectOption({ label: 'INSTALLED AS CYBERWARE' });
  await expect(jack.getByText('STRAIN · FRACTIONS ARE FINE: 0.25')).toBeVisible();
  await jack.getByRole('spinbutton', { name: 'COST' }).fill('0.25');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.items).toEqual({
    installs: [{ id: 'new_install', label: 'CYBERWARE', against: 'strain', limit: '@might' }],
    list: [{ id: 'new_item', label: 'Cranial Jack', needs: 'new_install', cost: 0.25 }],
  });

  // Kept: a reload finds it, saying what it needs.
  await page.reload();
  await openIt();
  await expect(page.getByRole('button', { name: /CRANIAL JACK/ })).toContainText('INSTALLED AS CYBERWARE');
  await expect(page.getByTestId('install-new_install').getByRole('combobox', { name: 'COSTS AGAINST' })).toHaveValue('strain');
});
