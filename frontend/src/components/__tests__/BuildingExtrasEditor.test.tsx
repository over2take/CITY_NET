/**
 * The building photo and GM notes in the admin edit view.
 *
 * Nothing saves on its own: choosing, removing and typing only stage a change, and
 * UPDATE_DATA_POINT commits it with the rest of the form. What is defended is that the
 * commit sends exactly what was staged and nothing else, reports every failure rather
 * than calling it saved, and never overwrites notes it could not load.
 */

import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';
import { BuildingExtrasEditor, PHOTO_ACCEPT, type BuildingExtrasHandle } from '../BuildingExtrasEditor';

const { PHOTO_EXT } = createRequire(import.meta.url)('../../../../backend/buildings/photoTypes.js');

let fetchMock: ReturnType<typeof vi.fn>;

const answer = (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (url.endsWith('/gm-notes') && method === 'GET') return { ok: true, json: async () => ({ notes: 'Old notes' }) };
  if (url.endsWith('/gm-notes') && method === 'PUT') return { ok: true, json: async () => JSON.parse(String(init!.body)) };
  if (url.endsWith('/photo') && method === 'POST') return { ok: true, json: async () => ({ photo_url: '/uploads/building_photos/new.png' }) };
  if (url.endsWith('/photo') && method === 'DELETE') return { ok: true, json: async () => ({ photo_url: null }) };
  return { ok: false, json: async () => ({ error: 'unexpected' }) };
};

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no object URLs; the preview only needs a string.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

const show = (over: Partial<React.ComponentProps<typeof BuildingExtrasEditor>> = {}) => {
  const ref = createRef<BuildingExtrasHandle>();
  render(<BuildingExtrasEditor ref={ref} locationId={7} token="admintoken" photoUrl={null} {...over} />);
  return ref;
};

const commit = async (ref: React.RefObject<BuildingExtrasHandle | null>) => {
  let problems: string[] = [];
  await act(async () => { problems = await ref.current!.commit(); });
  return problems;
};

const calls = (method: string) => fetchMock.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === method);

describe('nothing saves on its own', () => {
  it('sends nothing but the notes load until UPDATE_DATA_POINT commits', async () => {
    show({ photoUrl: '/uploads/building_photos/old.png' });
    const box = await screen.findByDisplayValue('Old notes');
    await userEvent.type(box, ' - more');
    await userEvent.upload(screen.getByLabelText('Building photo file'), new File(['x'], 'a.png', { type: 'image/png' }));
    expect(calls('PUT')).toHaveLength(0);
    expect(calls('POST')).toHaveLength(0);
    expect(screen.getByText('Uploads when you press UPDATE_DATA_POINT.')).toBeInTheDocument();
  });

  it('has no save buttons of its own', async () => {
    show({ photoUrl: '/uploads/building_photos/old.png' });
    await screen.findByDisplayValue('Old notes');
    expect(screen.queryByRole('button', { name: /SAVE/ })).toBeNull();
  });

  it('commits nothing when nothing was staged', async () => {
    const ref = show();
    await screen.findByDisplayValue('Old notes');
    expect(await commit(ref)).toEqual([]);
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method)).toHaveLength(0);
  });
});

describe('committing', () => {
  it('saves changed notes to their own route', async () => {
    const ref = show();
    await userEvent.type(await screen.findByDisplayValue('Old notes'), ' - and new');
    expect(await commit(ref)).toEqual([]);
    const [url, init] = calls('PUT')[0];
    expect(url).toBe('/api/locations/7/gm-notes');
    expect(JSON.parse(String(init.body))).toEqual({ notes: 'Old notes - and new' });
  });

  it('uploads a chosen photo, showing it beforehand', async () => {
    const ref = show();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'front.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Building photo file'), file);
    expect(screen.getByRole('img', { name: 'Building photo' })).toHaveAttribute('src', 'blob:preview');
    expect(await commit(ref)).toEqual([]);
    const [url, init] = calls('POST')[0];
    expect(url).toBe('/api/locations/7/photo');
    expect((init.body as FormData).get('photo')).toBe(file);
  });

  it('removes the photo when marked, and not when KEEP undoes it', async () => {
    const ref = show({ photoUrl: '/uploads/building_photos/old.png' });
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE' }));
    expect(screen.queryByRole('img', { name: 'Building photo' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'KEEP' }));
    await commit(ref);
    expect(calls('DELETE')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'REMOVE' }));
    await commit(ref);
    expect(calls('DELETE')[0][0]).toBe('/api/locations/7/photo');
  });

  it('drops a chosen photo on UNDO', async () => {
    const ref = show();
    await userEvent.upload(screen.getByLabelText('Building photo file'), new File(['x'], 'a.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'UNDO' }));
    await commit(ref);
    expect(calls('POST')).toHaveLength(0);
  });

  it('reports what the server refused', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: false, json: async () => ({ error: '"front.bmp" is .bmp, which is not supported.' }) }
        : answer(url, init)
    ));
    const ref = show();
    await userEvent.upload(screen.getByLabelText('Building photo file'), new File(['x'], 'front.png', { type: 'image/png' }));
    expect(await commit(ref)).toEqual(['"front.bmp" is .bmp, which is not supported.']);
  });
});

describe('a server that has not been restarted onto these routes', () => {
  /** It answers any unknown address with the app's own page: a 200 with nothing in it. */
  beforeEach(() => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => { throw new SyntaxError('not JSON'); } }));
  });

  it('says the photo was not taken, rather than that it was saved', async () => {
    const ref = show();
    await userEvent.upload(screen.getByLabelText('Building photo file'), new File(['x'], 'front.png', { type: 'image/png' }));
    const problems = await commit(ref);
    expect(problems[0]).toMatch(/did not take the photo.*restart it/);
  });

  it('will not let notes it never loaded be typed over and saved', async () => {
    // Saving over "no notes" would wipe the real ones on a server that does have them.
    const ref = show();
    expect(await screen.findByText(/did not answer for the notes/)).toBeInTheDocument();
    expect(screen.getByLabelText('GM NOTES')).toBeDisabled();
    await commit(ref);
    expect(calls('PUT')).toHaveLength(0);
  });
});

describe('the rest', () => {
  it('offers exactly the photo formats the server takes', () => {
    expect(PHOTO_ACCEPT.split(',').sort()).toEqual([...PHOTO_EXT].sort());
  });

  it('never submits the edit form it sits inside', async () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submit}>
        <BuildingExtrasEditor locationId={7} token="t" photoUrl="/uploads/building_photos/a.png" />
      </form>,
    );
    await screen.findByDisplayValue('Old notes');
    for (const name of ['REPLACE PHOTO', 'REMOVE', 'KEEP']) {
      await userEvent.click(screen.getByRole('button', { name }));
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it('asks for the building to be saved first when it has no id yet', async () => {
    const ref = show({ locationId: null });
    expect(screen.getByText(/Save the building first/)).toBeInTheDocument();
    expect(await commit(ref)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it('loads the building\'s own notes, which are not in the location data', async () => {
  show();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/locations/7/gm-notes', { headers: { Authorization: 'Bearer admintoken' } }));
});
