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

  it('links to the upgrade guide', () => {
    // Was a README#updating anchor that does not exist — the link shown to someone
    // whose update just failed landed at the top of a 570-line README.
    render(<UpdateModal {...baseProps} />);
    const link = screen.getByText('UPGRADE GUIDE ↗');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('UPGRADE.md');
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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('/api/update/status')
        ? { phase: 'idle' }
        : { version: '1.8.0', bootId: 'boot-1' }),
    })));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => {
      expect(screen.getByText(/UPDATE IN PROGRESS/)).toBeInTheDocument();
    });
  });

  it('hides action buttons while updating', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('/api/update/status')
        ? { phase: 'idle' }
        : { version: '1.8.0', bootId: 'boot-1' }),
    })));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => {
      expect(screen.queryByText('SKIP VERSION')).toBeNull();
      expect(screen.queryByText('REMIND ME LATER')).toBeNull();
    });
  });

  it('shows failure message if update fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: any) => {
      if (String(url).includes('/api/update/status')) return { ok: true, json: async () => ({ phase: 'idle' }) };
      if (opts?.method === 'POST') throw new Error('network error');
      return { ok: true, json: async () => ({ version: '1.8.0', bootId: 'boot-1' }) };
    }));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    // "cannot run" and "failed to start" were two messages for one situation; the
    // shared client reports a single one. What matters is that the reason reaches the
    // screen rather than being swallowed.
    await waitFor(() => {
      expect(screen.getByText(/UPDATE CANNOT RUN/)).toBeInTheDocument();
    });
    expect(screen.getByText(/network error/)).toBeInTheDocument();
  });

  it('detects a container too old to update itself and gives the host command', async () => {
    // A stale backend has no /api/update/status. Its /api/update answers "Update
    // started" and then does nothing, so without this probe the client waits six
    // minutes to learn what can be known immediately.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({ version: '1.7.0' }) };
    }));

    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));

    await waitFor(() => {
      expect(screen.getByText(/CANNOT UPDATE ITSELF/)).toBeInTheDocument();
    });
    expect(screen.getByText('docker compose pull && docker compose up -d')).toBeInTheDocument();
  });

  it('treats an index.html fallback as a stale server, not a modern one', async () => {
    // A setup that serves the SPA for unknown paths answers 200 with a page, which a
    // status-code check alone would read as "this server has the new updater".
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/update/status')) {
        return { ok: true, json: async () => { throw new Error('not json'); } };
      }
      return { ok: true, json: async () => ({ version: '1.7.0' }) };
    }));

    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));

    await waitFor(() => {
      expect(screen.getByText(/CANNOT UPDATE ITSELF/)).toBeInTheDocument();
    });
  });

  it('does not send the update to a server that cannot run it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({ version: '1.7.0' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => expect(screen.getByText(/CANNOT UPDATE ITSELF/)).toBeInTheDocument());

    const posted = fetchMock.mock.calls.some(([u, o]: any[]) => String(u).endsWith('/api/update') && o?.method === 'POST');
    expect(posted).toBe(false);
  });

  it('reports why the server refused, rather than waiting for a restart', async () => {
    // Preflight rejects a container that cannot possibly update — most often one started
    // before the compose file mounted itself. Previously the client ignored the response
    // entirely and polled for a version change that was never coming, which is how an
    // instance sits on WAITING FOR SERVER indefinitely.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/update/status')) {
        return { ok: true, json: async () => ({ phase: 'idle' }) };
      }
      if (String(url).includes('/api/version')) {
        return { ok: true, json: async () => ({ version: '1.8.0', bootId: 'boot-1' }) };
      }
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: '/tmp/docker-compose.yml is not mounted in this container' }),
      };
    }));

    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));

    await waitFor(() => {
      expect(screen.getByText(/UPDATE CANNOT RUN/)).toBeInTheDocument();
    });
    expect(screen.getByText(/docker-compose.yml is not mounted/)).toBeInTheDocument();
  });

  it('offers a way back after a failure instead of stranding the modal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: any) => {
      if (String(url).includes('/api/update/status')) return { ok: true, json: async () => ({ phase: 'idle' }) };
      if (opts?.method === 'POST') throw new Error('network error');
      return { ok: true, json: async () => ({ version: '1.8.0', bootId: 'boot-1' }) };
    }));
    render(<UpdateModal {...baseProps} isDocker={true} />);
    await userEvent.click(screen.getByText('UPDATE NOW'));
    await waitFor(() => expect(screen.getByText('BACK')).toBeInTheDocument());

    await userEvent.click(screen.getByText('BACK'));
    expect(screen.getByText('UPDATE NOW')).toBeInTheDocument();
  });
});
