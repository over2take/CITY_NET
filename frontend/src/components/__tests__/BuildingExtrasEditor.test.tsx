/**
 * The building photo and GM notes in the admin edit view.
 *
 * Each saves on its own button, straight to its own route - never through the big building
 * save, which rewrites the location row and knows nothing of either.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';
import { BuildingExtrasEditor, PHOTO_ACCEPT } from '../BuildingExtrasEditor';

const { PHOTO_EXT } = createRequire(import.meta.url)('../../../../backend/buildings/photoTypes.js');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/gm-notes') && method === 'GET') return { ok: true, json: async () => ({ notes: 'Old notes' }) };
    if (url.endsWith('/gm-notes') && method === 'PUT') return { ok: true, json: async () => JSON.parse(String(init!.body)) };
    if (url.endsWith('/photo') && method === 'POST') return { ok: true, json: async () => ({ photo_url: '/uploads/building_photos/new.png' }) };
    if (url.endsWith('/photo') && method === 'DELETE') return { ok: true, json: async () => ({ photo_url: null }) };
    return { ok: false, json: async () => ({ error: 'unexpected' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const show = (over: Partial<React.ComponentProps<typeof BuildingExtrasEditor>> = {}) =>
  render(<BuildingExtrasEditor locationId={7} token="admintoken" photoUrl={null} {...over} />);

describe('the photo', () => {
  it('offers exactly the formats the server takes', () => {
    // A picker offering a format the server refuses is an upload that fails after the wait.
    expect(PHOTO_ACCEPT.split(',').sort()).toEqual([...PHOTO_EXT].sort());
  });

  it('uploads the chosen file to its own route, and shows it', async () => {
    show();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'front.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Building photo file'), file);

    await waitFor(() => expect(screen.getByRole('img', { name: 'Building photo' })).toHaveAttribute('src', '/uploads/building_photos/new.png'));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/api/locations/7/photo');
    expect((init.body as FormData).get('photo')).toBe(file);
    expect(init.headers).toEqual({ Authorization: 'Bearer admintoken' });
  });

  it('can be removed', async () => {
    show({ photoUrl: '/uploads/building_photos/old.png' });
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE' }));
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Building photo' })).toBeNull());
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/locations/7/photo' && i?.method === 'DELETE')).toBe(true);
  });

  it('says why when the server refuses it', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: false, json: async () => ({ error: '"front.bmp" is .bmp, which is not supported.' }) }
        : { ok: true, json: async () => ({ notes: '' }) }
    ));
    show();
    await userEvent.upload(screen.getByLabelText('Building photo file'), new File(['x'], 'front.png', { type: 'image/png' }));
    expect(await screen.findByText(/which is not supported/)).toBeInTheDocument();
  });
});

describe('a server that has not been restarted onto these routes', () => {
  /**
   * It answers any unknown address with the app's own page - a 200 with no photo and no
   * notes in it. That used to read as PHOTO SAVED, with nothing saved.
   */
  beforeEach(() => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => { throw new SyntaxError('not JSON'); } }));
  });

  it('says the photo was not taken, rather than that it was saved', async () => {
    show();
    await userEvent.upload(screen.getByLabelText('Building photo file'), new File(['x'], 'front.png', { type: 'image/png' }));
    expect(await screen.findByText(/did not take the photo.*restart the backend/)).toBeInTheDocument();
    expect(screen.queryByText('PHOTO SAVED')).toBeNull();
    expect(screen.getByRole('button', { name: 'UPLOAD PHOTO' })).toBeInTheDocument();
  });

  it('says the notes could not be read, rather than showing them as empty', async () => {
    show();
    expect(await screen.findByText(/did not answer for the notes/)).toBeInTheDocument();
  });
});

describe('the notes', () => {
  it('load the building\'s own notes, which are not in the location data', async () => {
    show();
    expect(await screen.findByDisplayValue('Old notes')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/locations/7/gm-notes', { headers: { Authorization: 'Bearer admintoken' } });
  });

  it('save on their own button, only once changed', async () => {
    show();
    const box = await screen.findByDisplayValue('Old notes');
    const save = screen.getByRole('button', { name: 'SAVE NOTES' });
    expect(save).toBeDisabled();
    await userEvent.type(box, ' - and new');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(screen.getByText('NOTES SAVED')).toBeInTheDocument());
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(JSON.parse(String(put[1].body))).toEqual({ notes: 'Old notes - and new' });
  });

  it('never submit the edit form they sit inside', async () => {
    // Every button here is inside the building's edit form; a plain <button> would submit it.
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submit}>
        <BuildingExtrasEditor locationId={7} token="t" photoUrl="/uploads/building_photos/a.png" />
      </form>,
    );
    const box = await screen.findByDisplayValue('Old notes');
    await userEvent.type(box, '!');
    for (const name of ['SAVE NOTES', 'REPLACE PHOTO', 'REMOVE']) {
      await userEvent.click(screen.getByRole('button', { name }));
    }
    expect(submit).not.toHaveBeenCalled();
  });
});

it('asks for the building to be saved first when it has no id yet', () => {
  show({ locationId: null });
  expect(screen.getByText(/Save the building first/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
