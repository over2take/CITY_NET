/**
 * A building's info window, in the terminal style.
 *
 * What is defended: every player still sees exactly what they saw before - the description
 * under INFO and the residents under RESIDENTS, from the same fields - and the GM's notes
 * are only ever offered to, and fetched for, the main admin.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuildingWindow, type BuildingAction } from '../BuildingWindow';
import { resetRender3dCheck } from '../BuildingPreview';

const building = {
  id: 7, name: "VIC'S ARMS", description: 'Guns, no questions.', npcs: 'Vic, and his dog',
  district_name: 'Watson', building_type: 'gun_shop', x: 0, y: 0, z: 0, width: 4, height: 6, depth: 4,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetRender3dCheck();
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => (init?.method === 'PUT'
      ? { notes: JSON.parse(String(init.body)).notes }
      : { notes: 'Vic owes the Tyger Claws.' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const show = (over: Partial<React.ComponentProps<typeof BuildingWindow>> = {}) => render(
  <BuildingWindow
    location={building}
    title="VIC'S ARMS"
    gameSystem="cyberpunk_red"
    pos={{ x: 0, y: 0 }}
    setPos={vi.fn()}
    onClose={vi.fn()}
    actions={[]}
    isPrimaryAdmin={false}
    token=""
    {...over}
  />,
);

const panel = () => screen.getByRole('tabpanel');

describe('what everyone sees', () => {
  it('opens on INFO, with the description the building already had', () => {
    show();
    expect(screen.getByRole('tab', { name: 'INFO' })).toHaveAttribute('aria-selected', 'true');
    expect(panel()).toHaveTextContent('Guns, no questions.');
  });

  it('heads INFO with the shop type as this game names it, and the district', () => {
    show();
    expect(screen.getByText('GUN SHOP · WATSON')).toBeInTheDocument();
  });

  it('shows the residents under RESIDENTS', async () => {
    show();
    await userEvent.click(screen.getByRole('tab', { name: 'RESIDENTS' }));
    expect(panel()).toHaveTextContent('Vic, and his dog');
  });

  it('says so when a building has neither', async () => {
    show({ location: { ...building, description: '', npcs: null } });
    expect(panel()).toHaveTextContent('NO_DATA');
    await userEvent.click(screen.getByRole('tab', { name: 'RESIDENTS' }));
    expect(panel()).toHaveTextContent('UNKNOWN');
  });
});

describe('the GM notes', () => {
  it('are not offered to a player, and never asked for', () => {
    show();
    expect(screen.queryByRole('tab', { name: 'GM NOTES' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('are fetched for the main admin with their token, only when opened', async () => {
    show({ isPrimaryAdmin: true, token: 'admintoken' });
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'GM NOTES' }));
    await waitFor(() => expect(panel()).toHaveTextContent('Vic owes the Tyger Claws.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/locations/7/gm-notes', { headers: { Authorization: 'Bearer admintoken' } });
  });

  it('can be edited and saved in place', async () => {
    show({ isPrimaryAdmin: true, token: 'admintoken' });
    await userEvent.click(screen.getByRole('tab', { name: 'GM NOTES' }));
    await userEvent.click(await screen.findByRole('button', { name: 'EDIT NOTES' }));
    const box = screen.getByRole('textbox', { name: 'GM notes' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Paid up.');
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));

    await waitFor(() => expect(panel()).toHaveTextContent('Paid up.'));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(put[0]).toBe('/api/locations/7/gm-notes');
    expect(JSON.parse(String(put[1].body))).toEqual({ notes: 'Paid up.' });
  });

  it('say why when the server refuses them', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'Only the main admin can do that' }) }));
    show({ isPrimaryAdmin: true, token: 'admintoken' });
    await userEvent.click(screen.getByRole('tab', { name: 'GM NOTES' }));
    expect(await screen.findByText('Only the main admin can do that')).toBeInTheDocument();
  });
});

describe('moving between folders', () => {
  const press = (key: string) => fireEvent.keyDown(screen.getByLabelText("VIC'S ARMS information"), { key });

  it('walks down and up with the arrow keys, wrapping round', () => {
    show({ isPrimaryAdmin: true, token: 't' });
    press('ArrowDown');
    expect(screen.getByRole('tab', { name: 'RESIDENTS' })).toHaveAttribute('aria-selected', 'true');
    press('ArrowDown');
    expect(screen.getByRole('tab', { name: 'GM NOTES' })).toHaveAttribute('aria-selected', 'true');
    press('ArrowDown');
    expect(screen.getByRole('tab', { name: 'INFO' })).toHaveAttribute('aria-selected', 'true');
    press('ArrowUp');
    expect(screen.getByRole('tab', { name: 'GM NOTES' })).toHaveAttribute('aria-selected', 'true');
  });

  it('leaves the arrows to the text box while notes are being typed', async () => {
    show({ isPrimaryAdmin: true, token: 't' });
    await userEvent.click(screen.getByRole('tab', { name: 'GM NOTES' }));
    await userEvent.click(await screen.findByRole('button', { name: 'EDIT NOTES' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'GM notes' }), { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'GM NOTES' })).toHaveAttribute('aria-selected', 'true');
  });

  it('starts another building at INFO, not where the last was left', async () => {
    const { rerender } = show();
    await userEvent.click(screen.getByRole('tab', { name: 'RESIDENTS' }));
    rerender(
      <BuildingWindow location={{ ...building, id: 8, description: 'A noodle bar.' }} title="NOODLES"
        gameSystem="cyberpunk_red" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
        actions={[]} isPrimaryAdmin={false} token="" />,
    );
    expect(screen.getByRole('tab', { name: 'INFO' })).toHaveAttribute('aria-selected', 'true');
    expect(panel()).toHaveTextContent('A noodle bar.');
  });
});

describe('the buttons along the bottom', () => {
  it('are the ones the caller says apply, each doing its own thing', async () => {
    const shop = vi.fn();
    const ping = vi.fn();
    const actions: BuildingAction[] = [
      { key: 'shop', label: 'SHOP', tone: 'primary', onClick: shop },
      { key: 'ping', label: 'BROADCAST PING', onClick: ping },
    ];
    show({ actions });
    await userEvent.click(screen.getByRole('button', { name: 'SHOP' }));
    await userEvent.click(screen.getByRole('button', { name: 'BROADCAST PING' }));
    expect(shop).toHaveBeenCalledOnce();
    expect(ping).toHaveBeenCalledOnce();
  });
});

describe('the picture in the corner', () => {
  it('is the GM\'s photo when there is one, for everyone', () => {
    show({ location: { ...building, photo_url: '/uploads/building_photos/abc.png' } });
    const preview = screen.getByTestId('building-preview');
    expect(preview).toHaveAttribute('data-kind', 'photo');
    expect(screen.getByRole('img', { name: "VIC'S ARMS photo" })).toHaveAttribute('src', '/uploads/building_photos/abc.png');
  });

  it('falls back when the photo will not load, rather than showing a broken image', () => {
    show({ location: { ...building, photo_url: '/uploads/building_photos/gone.png' } });
    act(() => { fireEvent.error(screen.getByRole('img', { name: "VIC'S ARMS photo" })); });
    expect(screen.getByTestId('building-preview')).not.toHaveAttribute('data-kind', 'photo');
  });

  it('is the CITY_NET badge where nothing can be drawn in 3D', () => {
    // jsdom has no WebGL, which is exactly the machine this is for.
    show();
    expect(screen.getByTestId('building-preview')).toHaveAttribute('data-kind', 'icon');
    expect(screen.getByRole('img', { name: 'CITY_NET' })).toBeInTheDocument();
  });
});
