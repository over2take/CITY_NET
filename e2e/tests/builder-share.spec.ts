import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { signInAsGm, openBuilder, gmToken, asGm } from './helpers';

// Sharing a system with the pictures uploaded for it (decided with the user, 2026-10-23): EXPORT
// on a system with an uploaded image asks first, ticked to send it, and saves a zip of the system
// and its image; INSTALL A FILE takes the zip, shows the image in what it holds, and installs it
// with it. That the image comes back on a server without it is the backend's to show
// (system_builder_citysys_zip.test.js): here, one server, the window's part.

test('a system with an uploaded image is exported as a zip with it, and installed from the zip', async ({ page, request }, info) => {
  const name = `Zipped${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const upload = await request.post('/api/systems/condition-icons', {
    headers: { Authorization: `Bearer ${gm}` },
    multipart: { icon: { name: 'glitch.png', mimeType: 'image/png', buffer: crypto.randomBytes(200) } },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const { icon } = await upload.json();
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: { format: 1, name, conditions: { glitching: { name: 'Glitching', short: 'GLITCH', icon } } } });
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);

  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(`system-${id}`);
  await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'EXPORT', exact: true }).click();
  const asking = page.getByRole('group', { name: `Export ${name}` });
  const box = asking.getByRole('checkbox', { name: 'INCLUDE THE 1 UPLOADED IMAGE' });
  await expect(box).toBeChecked();
  // Unticked and ticked again by the pointer, as a person would: the box takes a click.
  await box.click();
  await expect(asking.getByText(/^A \.citysys without them/)).toBeVisible();
  await box.click();
  const downloading = page.waitForEvent('download');
  await asking.getByRole('button', { name: 'SAVE', exact: true }).click();
  const saved = await downloading;
  expect(saved.suggestedFilename()).toBe(`${name.toLowerCase().replace(/ /g, '-')}.zip`);
  const zipped = info.outputPath(saved.suggestedFilename());
  await saved.saveAs(zipped);
  await expect(asking).toHaveCount(0);

  // Installed from the zip: a second copy beside the first, its image with it.
  await page.getByRole('tab', { name: 'INSTALL A FILE' }).click();
  await page.getByLabel('System file').setInputFiles(zipped);
  const cover = page.getByTestId('install-cover');
  await expect(cover.getByText('1 IMAGE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'KEEP BOTH', exact: true }).click();
  await expect(page.getByText(/^Installed a second copy, .+, beside the first\. Its 1 image came with it\.$/)).toBeVisible();

  const listed = (await (await request.get('/api/systems', { headers: { Authorization: `Bearer ${gm}` } })).json()) as { id: string; name: string; images: number }[];
  const copy = listed.find((s) => s.id !== id && s.name.startsWith(name) && s.name !== name)!;
  expect(copy.images).toBe(1);
  const copied = await (await request.get(`/api/systems/${copy.id}`, { headers: { Authorization: `Bearer ${gm}` } })).json();
  expect(copied.published.conditions.glitching.icon).toBe(icon);
  expect((await request.get(icon)).ok()).toBe(true);
});
