import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CityDataBaseMenu } from '../CityDatabase';

const MAPS = [
  { id: 1, name: 'ALPHA', timestamp: '2024-01-01' },
  { id: 2, name: 'BETA', timestamp: '2024-01-02' },
];

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).hasUnsavedChanges = false;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => MAPS });
});

describe('CityDataBaseMenu', () => {
  it('renders the panel header', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    expect(screen.getByText('CITY_DATA_BASE')).toBeInTheDocument();
  });

  it('fetches and lists saved maps on mount', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('ALPHA')).toBeInTheDocument();
      expect(screen.getByText('BETA')).toBeInTheDocument();
    });
  });

  it('shows NO_ARCHIVED_DATA when map list is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('NO_ARCHIVED_DATA')).toBeInTheDocument());
  });

  it('clicking a map name populates the name input', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    await userEvent.click(screen.getByText('ALPHA'));
    expect((screen.getByPlaceholderText('MAP_DESIGNATION') as HTMLInputElement).value).toBe('ALPHA');
  });

  it('shows ADMIN_ACCESS_REQUIRED alert when saving without token', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('MAP_DESIGNATION'), 'MYMAP');
    await userEvent.click(screen.getByText('SAVE'));
    expect(screen.getByText('ADMIN_ACCESS_REQUIRED')).toBeInTheDocument();
  });

  it('shows MAP_NAME_REQUIRED alert when saving with empty name', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await userEvent.click(screen.getByText('SAVE'));
    expect(screen.getByText('MAP_NAME_REQUIRED')).toBeInTheDocument();
  });

  it('shows overwrite confirmation when saving a duplicate name', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    await userEvent.type(screen.getByPlaceholderText('MAP_DESIGNATION'), 'ALPHA');
    await userEvent.click(screen.getByText('SAVE'));
    expect(screen.getByText(/OVERWRITE_MAP/)).toBeInTheDocument();
    expect(screen.getByText('OVERWRITE_DATA')).toBeInTheDocument();
  });

  it('calls POST /api/maps/save when saving a new name', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('MAP_DESIGNATION'), 'NEWMAP');
    await userEvent.click(screen.getByText('SAVE'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/maps/save', expect.objectContaining({ method: 'POST' })));
  });

  it('shows delete confirmation on DELETE click', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    const alphaRow = screen.getByText('ALPHA').closest('.list-item')!;
    await userEvent.click(within(alphaRow).getByText('DELETE'));
    expect(screen.getByText(/CONFIRM_DELETE_MAP/)).toBeInTheDocument();
    expect(screen.getByText('PURGE_DATA')).toBeInTheDocument();
  });

  it('calls DELETE /api/maps/:id after confirming delete', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    const alphaRow = screen.getByText('ALPHA').closest('.list-item')!;
    await userEvent.click(within(alphaRow).getByText('DELETE'));
    await userEvent.click(screen.getByText('PURGE_DATA'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/maps/1', expect.objectContaining({ method: 'DELETE' })));
  });

  it('shows ADMIN_ACCESS_REQUIRED when loading without token', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    const alphaRow = screen.getByText('ALPHA').closest('.list-item')!;
    await userEvent.click(within(alphaRow).getByText('LOAD'));
    expect(screen.getByText('ADMIN_ACCESS_REQUIRED')).toBeInTheDocument();
  });

  it('calls POST /api/maps/load/:name when loading', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    const alphaRow = screen.getByText('ALPHA').closest('.list-item')!;
    await userEvent.click(within(alphaRow).getByText('LOAD'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/maps/load/ALPHA', expect.objectContaining({ method: 'POST' })));
  });

  it('shows unsaved changes warning before loading', async () => {
    (window as any).hasUnsavedChanges = true;
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    const alphaRow = screen.getByText('ALPHA').closest('.list-item')!;
    await userEvent.click(within(alphaRow).getByText('LOAD'));
    expect(screen.getByText(/UNSAVED_CHANGES_DETECTED/)).toBeInTheDocument();
  });

  it('shows ADMIN_ACCESS_REQUIRED when clearing without token', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await userEvent.click(screen.getByText('NEW_MAP'));
    expect(screen.getByText('ADMIN_ACCESS_REQUIRED')).toBeInTheDocument();
  });

  it('alert dialog dismisses on ACKNOWLEDGE', async () => {
    render(<CityDataBaseMenu token="" emitUpdate={vi.fn()} />);
    await userEvent.click(screen.getByText('SAVE'));
    await userEvent.click(screen.getByText('ACKNOWLEDGE'));
    expect(screen.queryByText('MAP_NAME_REQUIRED')).not.toBeInTheDocument();
  });

  it('confirmation dialog dismisses on ABORT_OPERATION', async () => {
    render(<CityDataBaseMenu token="tok" emitUpdate={vi.fn()} />);
    await waitFor(() => screen.getByText('ALPHA'));
    const alphaRow = screen.getByText('ALPHA').closest('.list-item')!;
    await userEvent.click(within(alphaRow).getByText('DELETE'));
    await userEvent.click(screen.getByText('ABORT_OPERATION'));
    expect(screen.queryByText(/CONFIRM_DELETE_MAP/)).not.toBeInTheDocument();
  });
});
