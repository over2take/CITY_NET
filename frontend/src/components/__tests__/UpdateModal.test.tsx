import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateModal } from '../UpdateModal';

const baseProps = {
  current: '1.2.1',
  latest: '1.2.2',
  message: 'Update available: 1.2.1 → 1.2.2',
  token: 'test-token',
  isDocker: true,
  onDismiss: vi.fn(),
  onSkip: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('UpdateModal rendering', () => {
  it('renders SYSTEM_UPDATE header', () => {
    render(<UpdateModal {...baseProps} />);
    expect(screen.getByText('SYSTEM_UPDATE')).toBeInTheDocument();
  });

  it('renders version message', () => {
    render(<UpdateModal {...baseProps} />);
    expect(screen.getByText('Update available: 1.2.1 → 1.2.2')).toBeInTheDocument();
  });

  it('renders running and available version info', () => {
    render(<UpdateModal {...baseProps} />);
    expect(screen.getByText('1.2.1')).toBeInTheDocument();
    expect(screen.getByText('1.2.2')).toBeInTheDocument();
  });

  it('renders README link', () => {
    render(<UpdateModal {...baseProps} />);
    expect(screen.getByText('README ↗')).toBeInTheDocument();
  });
});

// ─── Docker install buttons ───────────────────────────────────────────────────

describe('UpdateModal — docker install', () => {
  it('shows UPDATE NOW, REMIND ME LATER, SKIP VERSION buttons', () => {
    render(<UpdateModal {...baseProps} isDocker={true} />);
    expect(screen.getByText('UPDATE NOW')).toBeInTheDocument();
    expect(screen.getByText('REMIND ME LATER')).toBeInTheDocument();
    expect(screen.getByText('SKIP VERSION')).toBeInTheDocument();
  });

  it('does not show manual install message for docker', () => {
    render(<UpdateModal {...baseProps} isDocker={true} />);
    expect(screen.queryByText(/Manual install/)).toBeNull();
    expect(screen.queryByText('INSTALL INSTRUCTIONS ↗')).toBeNull();
  });

  it('calls onDismiss when REMIND ME LATER is clicked', async () => {
    const onDismiss = vi.fn();
    render(<UpdateModal {...baseProps} isDocker={true} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByText('REMIND ME LATER'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onSkip when SKIP VERSION is clicked', async () => {
    const onSkip = vi.fn();
    render(<UpdateModal {...baseProps} isDocker={true} onSkip={onSkip} />);
    await userEvent.click(screen.getByText('SKIP VERSION'));
    expect(onSkip).toHaveBeenCalled();
  });

  it('calls onDismiss when × close button is clicked', async () => {
    const onDismiss = vi.fn();
    render(<UpdateModal {...baseProps} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByText('×'));
    expect(onDismiss).toHaveBeenCalled();
  });
});

// ─── Non-docker install ───────────────────────────────────────────────────────

describe('UpdateModal — non-docker install', () => {
  it('shows manual install message instead of UPDATE NOW', () => {
    render(<UpdateModal {...baseProps} isDocker={false} />);
    expect(screen.getByText(/Manual install/)).toBeInTheDocument();
    expect(screen.queryByText('UPDATE NOW')).toBeNull();
  });

  it('shows INSTALL INSTRUCTIONS link', () => {
    render(<UpdateModal {...baseProps} isDocker={false} />);
    expect(screen.getByText('INSTALL INSTRUCTIONS ↗')).toBeInTheDocument();
  });

  it('still shows REMIND ME LATER and SKIP VERSION for non-docker', () => {
    render(<UpdateModal {...baseProps} isDocker={false} />);
    expect(screen.getByText('REMIND ME LATER')).toBeInTheDocument();
    expect(screen.getByText('SKIP VERSION')).toBeInTheDocument();
  });

  it('calls onDismiss from REMIND ME LATER on non-docker', async () => {
    const onDismiss = vi.fn();
    render(<UpdateModal {...baseProps} isDocker={false} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByText('REMIND ME LATER'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onSkip from SKIP VERSION on non-docker', async () => {
    const onSkip = vi.fn();
    render(<UpdateModal {...baseProps} isDocker={false} onSkip={onSkip} />);
    await userEvent.click(screen.getByText('SKIP VERSION'));
    expect(onSkip).toHaveBeenCalled();
  });
});

// ─── Update Now flow ──────────────────────────────────────────────────────────

describe('UpdateModal — Update Now', () => {
  it('shows updating status message after clicking UPDATE NOW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => {
      expect(screen.getByText(/Update in progress/)).toBeInTheDocument();
    });
  });

  it('hides action buttons while updating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => {
      expect(screen.queryByText('SKIP VERSION')).toBeNull();
      expect(screen.queryByText('REMIND ME LATER')).toBeNull();
    });
  });

  it('shows failure message if update fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => {
      expect(screen.getByText(/Update failed/)).toBeInTheDocument();
    });
  });
});
