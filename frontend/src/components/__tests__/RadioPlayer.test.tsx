import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioPlayer } from '../RadioPlayer';
import type { MusicStateType } from '../RadioPlayer';

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

const makeAudioRef = (overrides: Partial<HTMLAudioElement> = {}): React.RefObject<HTMLAudioElement> => ({
  current: {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    currentTime: 30,
    duration: 180,
    volume: 1,
    loop: false,
    paused: true,
    ...overrides,
  } as unknown as HTMLAudioElement,
});

const baseState: MusicStateType = {
  playing: false,
  trackId: 1,
  src: 'track.mp3',
  name: 'NIGHT_CITY_BLUES',
  position: 30,
  shuffle: false,
  loop: false,
};

const defaultProps = {
  pos: { x: 0, y: 0 },
  setPos: vi.fn(),
  onClose: vi.fn(),
  isAdmin: true,
  socket: makeSocket(),
  audioRef: makeAudioRef(),
  musicState: baseState,
  volume: 0.8,
  onVolumeChange: vi.fn(),
  onNext: vi.fn(),
  onPrev: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

// ─── Render ───────────────────────────────────────────────────────────────────

describe('RadioPlayer render', () => {
  it('renders without crashing', () => {
    expect(() => render(<RadioPlayer {...defaultProps} />)).not.toThrow();
  });

  it('shows RADIO_FEED as window title', () => {
    render(<RadioPlayer {...defaultProps} />);
    expect(screen.getByTestId('window-title').textContent).toBe('RADIO_FEED');
  });

  it('shows the track name', () => {
    render(<RadioPlayer {...defaultProps} />);
    expect(screen.getByText('NIGHT_CITY_BLUES')).toBeInTheDocument();
  });

  it('shows NO_TRACK when musicState.name is null', () => {
    render(<RadioPlayer {...defaultProps} musicState={{ ...baseState, name: null }} />);
    expect(screen.getByText('NO_TRACK')).toBeInTheDocument();
  });

  it('shows LISTEN_ONLY for non-admin', () => {
    render(<RadioPlayer {...defaultProps} isAdmin={false} />);
    expect(screen.getByText('LISTEN_ONLY')).toBeInTheDocument();
  });

  it('does not show LISTEN_ONLY for admin', () => {
    render(<RadioPlayer {...defaultProps} isAdmin={true} />);
    expect(screen.queryByText('LISTEN_ONLY')).not.toBeInTheDocument();
  });

  it('shows volume percentage', () => {
    render(<RadioPlayer {...defaultProps} volume={0.8} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });
});

// ─── Transport: admin emits ───────────────────────────────────────────────────

describe('RadioPlayer transport — admin emits', () => {
  it('emits musicPause when play button clicked while playing', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} musicState={{ ...baseState, playing: true }} />);
    await userEvent.click(screen.getByTitle('PAUSE'));
    expect(socket.emit).toHaveBeenCalledWith('musicPause', expect.objectContaining({ position: expect.any(Number) }));
  });

  it('emits musicResume when play button clicked while paused', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} musicState={{ ...baseState, playing: false }} />);
    await userEvent.click(screen.getByTitle('PLAY'));
    expect(socket.emit).toHaveBeenCalledWith('musicResume', expect.anything());
  });

  it('calls onNext when NEXT button clicked', async () => {
    const onNext = vi.fn();
    render(<RadioPlayer {...defaultProps} onNext={onNext} />);
    await userEvent.click(screen.getByTitle('NEXT'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onPrev when PREV button clicked', async () => {
    const onPrev = vi.fn();
    render(<RadioPlayer {...defaultProps} onPrev={onPrev} />);
    await userEvent.click(screen.getByTitle('PREV'));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('emits musicShuffle with enabled:true when shuffle toggled off→on', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} musicState={{ ...baseState, shuffle: false }} />);
    await userEvent.click(screen.getByTitle('SHUFFLE'));
    expect(socket.emit).toHaveBeenCalledWith('musicShuffle', { enabled: true });
  });

  it('emits musicShuffle with enabled:false when shuffle toggled on→off', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} musicState={{ ...baseState, shuffle: true }} />);
    await userEvent.click(screen.getByTitle('SHUFFLE'));
    expect(socket.emit).toHaveBeenCalledWith('musicShuffle', { enabled: false });
  });

  it('emits musicLoop with enabled:true when loop toggled off→on', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} musicState={{ ...baseState, loop: false }} />);
    await userEvent.click(screen.getByTitle('LOOP'));
    expect(socket.emit).toHaveBeenCalledWith('musicLoop', { enabled: true });
  });

  it('emits musicLoop with enabled:false when loop toggled on→off', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} musicState={{ ...baseState, loop: true }} />);
    await userEvent.click(screen.getByTitle('LOOP'));
    expect(socket.emit).toHaveBeenCalledWith('musicLoop', { enabled: false });
  });
});

// ─── Transport: non-admin cannot emit ────────────────────────────────────────

describe('RadioPlayer transport — non-admin cannot emit', () => {
  const playerProps = { ...defaultProps, isAdmin: false };

  it('does not emit musicResume when play clicked by non-admin', async () => {
    const socket = makeSocket();
    render(<RadioPlayer {...playerProps} socket={socket} musicState={{ ...baseState, playing: false }} />);
    const playBtn = screen.getByTitle('PLAY');
    expect(playBtn).toBeDisabled();
  });

  it('NEXT button is disabled for non-admin', () => {
    render(<RadioPlayer {...playerProps} />);
    expect(screen.getByTitle('NEXT')).toBeDisabled();
  });

  it('PREV button is disabled for non-admin', () => {
    render(<RadioPlayer {...playerProps} />);
    expect(screen.getByTitle('PREV')).toBeDisabled();
  });

  it('SHUFFLE button is disabled for non-admin', () => {
    render(<RadioPlayer {...playerProps} />);
    expect(screen.getByTitle('SHUFFLE')).toBeDisabled();
  });

  it('LOOP button is disabled for non-admin', () => {
    render(<RadioPlayer {...playerProps} />);
    expect(screen.getByTitle('LOOP')).toBeDisabled();
  });
});

// ─── Scrubber ─────────────────────────────────────────────────────────────────

describe('RadioPlayer scrubber', () => {
  it('scrubber is disabled for non-admin', () => {
    render(<RadioPlayer {...defaultProps} isAdmin={false} />);
    // Two sliders: [0] = scrubber, [1] = volume
    const scrubber = screen.getAllByRole('slider')[0];
    expect(scrubber).toBeDisabled();
  });

  it('scrubber onChange does NOT emit musicSeek (only pointerUp does)', () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} />);
    const scrubber = screen.getAllByRole('slider')[0];
    // fireEvent.change triggers only the onChange handler, not onPointerUp
    fireEvent.change(scrubber, { target: { value: '60' } });
    const seekCalls = socket.emit.mock.calls.filter((c: any[]) => c[0] === 'musicSeek');
    expect(seekCalls).toHaveLength(0);
  });

  it('scrubber emits musicSeek on pointerUp for admin', () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} />);
    const scrubber = screen.getAllByRole('slider')[0];
    fireEvent.pointerUp(scrubber, { target: { value: '90' } });
    const seekCalls = socket.emit.mock.calls.filter((c: any[]) => c[0] === 'musicSeek');
    expect(seekCalls).toHaveLength(1);
  });
});

// ─── Volume ───────────────────────────────────────────────────────────────────

describe('RadioPlayer volume', () => {
  it('calls onVolumeChange when volume slider changes', () => {
    const onVolumeChange = vi.fn();
    render(<RadioPlayer {...defaultProps} onVolumeChange={onVolumeChange} />);
    const volumeSlider = screen.getAllByRole('slider')[1];
    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.5);
  });

  it('volume change does NOT emit any socket event', () => {
    const socket = makeSocket();
    render(<RadioPlayer {...defaultProps} socket={socket} />);
    const volumeSlider = screen.getAllByRole('slider')[1];
    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

// ─── State display ────────────────────────────────────────────────────────────

describe('RadioPlayer state display', () => {
  it('play button label is ▶ when paused', () => {
    render(<RadioPlayer {...defaultProps} musicState={{ ...baseState, playing: false }} />);
    expect(screen.getByTitle('PLAY')).toBeInTheDocument();
  });

  it('play button label is ⏸ when playing', () => {
    render(<RadioPlayer {...defaultProps} musicState={{ ...baseState, playing: true }} />);
    expect(screen.getByTitle('PAUSE')).toBeInTheDocument();
  });
});
