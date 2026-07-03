import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioFeed } from '../RadioFeed';
import type { MusicItem } from '../RadioFeed';

// DraggableWindow renders its children inline for tests
vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title, onClose }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      <button data-testid="close-btn" onClick={onClose}>×</button>
      {children}
    </div>
  ),
}));

const makeSocket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

const folder = (overrides: Partial<MusicItem> = {}): MusicItem => ({
  id: 1, parent_id: null, type: 'folder', name: 'AMBIENT', path: undefined, sort_order: 0,
  ...overrides,
});

const file = (overrides: Partial<MusicItem> = {}): MusicItem => ({
  id: 2, parent_id: null, type: 'file', name: 'track_01.mp3', path: 'abc123.mp3', sort_order: 0,
  ...overrides,
});

const defaultProps = {
  pos: { x: 0, y: 0 },
  setPos: vi.fn(),
  onClose: vi.fn(),
  token: 'test-token',
  socket: makeSocket(),
  onTrackSelect: vi.fn(),
  selectedTrackId: null,
};

beforeEach(() => vi.clearAllMocks());

// ─── Render ───────────────────────────────────────────────────────────────────

describe('RadioFeed render', () => {
  it('renders without crashing', () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
    expect(() => render(<RadioFeed {...defaultProps} />)).not.toThrow();
  });

  it('shows RADIO_FEED as window title', () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
    render(<RadioFeed {...defaultProps} />);
    expect(screen.getByTestId('window-title').textContent).toBe('RADIO_FEED');
  });

  it('shows NO_TRACKS when library is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('NO_TRACKS')).toBeInTheDocument());
  });

  it('shows folder and file names after library loads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [folder({ name: 'AMBIENT' }), file({ name: 'track_01.mp3' })],
    });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('AMBIENT')).toBeInTheDocument();
      expect(screen.getByText('track_01.mp3')).toBeInTheDocument();
    });
  });

  it('shows Upload target as ROOT when no folder is selected', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/UPLOAD_TARGET: ROOT/)).toBeInTheDocument());
  });
});

// ─── Toolbar buttons ──────────────────────────────────────────────────────────

describe('RadioFeed toolbar', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
  });

  it('shows + FOLDER button', () => {
    render(<RadioFeed {...defaultProps} />);
    expect(screen.getByText('+ FOLDER')).toBeInTheDocument();
  });

  it('shows UPLOAD button', () => {
    render(<RadioFeed {...defaultProps} />);
    expect(screen.getByText('UPLOAD')).toBeInTheDocument();
  });

  it('shows DELETE button', () => {
    render(<RadioFeed {...defaultProps} />);
    expect(screen.getByText('DELETE')).toBeInTheDocument();
  });

  it('DELETE button is disabled when nothing is selected', () => {
    render(<RadioFeed {...defaultProps} />);
    const deleteBtn = screen.getByText('DELETE').closest('button');
    expect(deleteBtn).toBeDisabled();
  });

  it('shows folder name input after clicking + FOLDER', async () => {
    render(<RadioFeed {...defaultProps} />);
    await userEvent.click(screen.getByText('+ FOLDER'));
    expect(screen.getByPlaceholderText('FOLDER_NAME')).toBeInTheDocument();
  });

  it('hides folder input after pressing Escape', async () => {
    render(<RadioFeed {...defaultProps} />);
    await userEvent.click(screen.getByText('+ FOLDER'));
    const input = screen.getByPlaceholderText('FOLDER_NAME');
    await userEvent.type(input, '{Escape}');
    expect(screen.queryByPlaceholderText('FOLDER_NAME')).not.toBeInTheDocument();
  });

  it('POSTs to /api/music/folder when folder name is submitted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => [] })         // initial library fetch
      .mockResolvedValue({ json: async () => ({ id: 10 }) }); // POST
    global.fetch = fetchMock;

    render(<RadioFeed {...defaultProps} />);
    await userEvent.click(screen.getByText('+ FOLDER'));
    const input = screen.getByPlaceholderText('FOLDER_NAME');
    await userEvent.type(input, 'NEW_ZONE');
    await userEvent.click(screen.getByText('OK'));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/music/folder' && c[1]?.method === 'POST');
      expect(postCall).toBeTruthy();
    });
  });
});

// ─── File selection ───────────────────────────────────────────────────────────

describe('RadioFeed file selection', () => {
  it('calls onTrackSelect when a file is clicked', async () => {
    const onTrackSelect = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [file({ id: 5, name: 'beat.mp3', path: 'beat.mp3' })],
    });
    render(<RadioFeed {...defaultProps} onTrackSelect={onTrackSelect} />);
    await waitFor(() => screen.getByText('beat.mp3'));
    await userEvent.click(screen.getByText('beat.mp3'));
    expect(onTrackSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 5, type: 'file' }));
  });

  it('does NOT call onTrackSelect when a folder is clicked', async () => {
    const onTrackSelect = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [folder({ id: 3, name: 'CITY' })],
    });
    render(<RadioFeed {...defaultProps} onTrackSelect={onTrackSelect} />);
    await waitFor(() => screen.getByText('CITY'));
    await userEvent.click(screen.getByText('CITY'));
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('marks the currently playing track with ▶', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [file({ id: 7, name: 'playing.mp3' })],
    });
    render(<RadioFeed {...defaultProps} selectedTrackId={7} />);
    await waitFor(() => screen.getByText('playing.mp3'));
    expect(screen.getByText('▶')).toBeInTheDocument();
  });
});

// ─── Delete confirmation modal ────────────────────────────────────────────────

describe('RadioFeed delete confirmation', () => {
  it('shows confirmation modal when DELETE is clicked on a selected file', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [file({ id: 2, name: 'track.mp3' })],
    });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('track.mp3')); // select it
    await userEvent.click(screen.getByText('DELETE'));
    expect(screen.getByText('CONFIRM')).toBeInTheDocument();
    expect(screen.getByText('CANCEL')).toBeInTheDocument();
  });

  it('does NOT use window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [file({ id: 2, name: 'track.mp3' })],
    });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('DELETE'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('dismisses modal on CANCEL without sending a DELETE request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => [file({ id: 2, name: 'track.mp3' })],
    });
    global.fetch = fetchMock;
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('DELETE'));
    await userEvent.click(screen.getByText('CANCEL'));
    expect(screen.queryByText('CONFIRM')).not.toBeInTheDocument();
    const deleteCalls = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  it('calls DELETE /api/music/file/:id on CONFIRM for a file', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => [file({ id: 2, name: 'track.mp3' })] })
      .mockResolvedValue({ json: async () => ({ deleted: 1 }) });
    global.fetch = fetchMock;
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('DELETE'));
    await userEvent.click(screen.getByText('CONFIRM'));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/music/file/2' && c[1]?.method === 'DELETE');
      expect(del).toBeTruthy();
    });
  });

  it('calls DELETE /api/music/folder/:id on CONFIRM for a folder', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => [folder({ id: 9, name: 'OLD_ZONE' })] })
      .mockResolvedValue({ json: async () => ({ deleted: 1 }) });
    global.fetch = fetchMock;
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('OLD_ZONE'));
    await userEvent.click(screen.getByText('OLD_ZONE'));
    await userEvent.click(screen.getByText('DELETE'));
    expect(screen.getByText(/All contents will be removed/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('CONFIRM'));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/music/folder/9' && c[1]?.method === 'DELETE');
      expect(del).toBeTruthy();
    });
  });
});

// ─── Socket: musicLibraryUpdated ──────────────────────────────────────────────

describe('RadioFeed socket integration', () => {
  it('registers musicLibraryUpdated socket listener on mount', () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
    const socket = makeSocket();
    render(<RadioFeed {...defaultProps} socket={socket} />);
    expect(socket.on).toHaveBeenCalledWith('musicLibraryUpdated', expect.any(Function));
  });

  it('unregisters listener on unmount', () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => [] });
    const socket = makeSocket();
    const { unmount } = render(<RadioFeed {...defaultProps} socket={socket} />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('musicLibraryUpdated', expect.any(Function));
  });

  it('refetches library when musicLibraryUpdated fires', async () => {
    let onLibraryUpdated: (() => void) | null = null;
    const socket = {
      emit: vi.fn(),
      on: vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (event === 'musicLibraryUpdated') onLibraryUpdated = cb;
      }),
      off: vi.fn(),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => [] })
      .mockResolvedValueOnce({ json: async () => [file({ name: 'new_track.mp3' })] });
    global.fetch = fetchMock;

    render(<RadioFeed {...defaultProps} socket={socket} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    onLibraryUpdated?.();
    await waitFor(() => expect(screen.getByText('new_track.mp3')).toBeInTheDocument());
  });
});

// ─── Upload target label ──────────────────────────────────────────────────────

describe('RadioFeed upload target label', () => {
  it('shows selected folder name as upload target', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [folder({ id: 1, name: 'JAZZ' })],
    });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('JAZZ'));
    await userEvent.click(screen.getByText('JAZZ'));
    expect(screen.getByText(/UPLOAD_TARGET: JAZZ/)).toBeInTheDocument();
  });

  it('shows ROOT when a file (not a folder) is selected', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [file({ id: 2, name: 'track.mp3' })],
    });
    render(<RadioFeed {...defaultProps} />);
    await waitFor(() => screen.getByText('track.mp3'));
    await userEvent.click(screen.getByText('track.mp3'));
    expect(screen.getByText(/UPLOAD_TARGET: ROOT/)).toBeInTheDocument();
  });
});
