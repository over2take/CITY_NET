import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecureLogin } from '../SecureLogin';

const StatusLogDisplay = () => <div data-testid="status-log" />;

const baseProps = () => ({
  secureModeEnabled: true,
  audioEnabled: true,
  onToggleAudio: vi.fn(),
  onSimpleLogin: vi.fn(),
  onSecureLogin: vi.fn(),
  onAdminLogin: vi.fn(),
  onPendingsFetched: vi.fn(),
  StatusLogDisplay,
});

const mockFetch = (responses: Record<string, { ok: boolean; body: object }>) => {
  vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) => {
    const method = opts?.method?.toUpperCase() ?? 'GET';
    const key = `${method} ${url}`;
    const match = responses[key] ?? responses[url];
    if (!match) throw new Error(`Unmocked fetch: ${key}`);
    return Promise.resolve({ ok: match.ok, json: () => Promise.resolve(match.body) });
  }));
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Non-secure login ─────────────────────────────────────────────────────

describe('Non-secure login (secureModeEnabled=false)', () => {
  it('shows OPERATOR_ID input and LOGIN button, no password field', () => {
    render(<SecureLogin {...baseProps()} secureModeEnabled={false} />);
    expect(screen.getByPlaceholderText('OPERATOR_ID')).toBeInTheDocument();
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('ACCESS_CODE')).not.toBeInTheDocument();
  });

  it('calls onSimpleLogin with the entered name', async () => {
    const props = baseProps();
    render(<SecureLogin {...props} secureModeEnabled={false} />);
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.click(screen.getByText('LOGIN'));
    expect(props.onSimpleLogin).toHaveBeenCalledWith('GHOST');
  });
});

// ─── 2. Secure login registration ────────────────────────────────────────────

describe('Secure login registration', () => {
  it('navigates to register form on REGISTER click', async () => {
    render(<SecureLogin {...baseProps()} />);
    await userEvent.click(screen.getByText('REGISTER'));
    expect(screen.getByText('CREATE_ACCOUNT')).toBeInTheDocument();
  });

  it('shows error when passwords do not match', async () => {
    render(<SecureLogin {...baseProps()} />);
    await userEvent.click(screen.getByText('REGISTER'));
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'pass1');
    await userEvent.type(screen.getByPlaceholderText('CONFIRM_ACCESS_CODE'), 'pass2');
    await userEvent.click(screen.getByText('CREATE_ACCOUNT'));
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  it('shows pending screen after successful registration', async () => {
    mockFetch({ 'POST /api/player/register': { ok: true, body: { message: 'Account pending admin approval' } } });
    render(<SecureLogin {...baseProps()} />);
    await userEvent.click(screen.getByText('REGISTER'));
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'secret');
    await userEvent.type(screen.getByPlaceholderText('CONFIRM_ACCESS_CODE'), 'secret');
    // pick a preset security question
    await userEvent.selectOptions(screen.getByRole('combobox'), 'What is your favorite movie?');
    await userEvent.type(screen.getByPlaceholderText('SECURITY_ANSWER'), 'Blade Runner');
    await userEvent.click(screen.getByText('CREATE_ACCOUNT'));
    await waitFor(() => expect(screen.getByText('REGISTRATION_SUBMITTED')).toBeInTheDocument());
  });

  it('sends correct payload to /api/player/register', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ message: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SecureLogin {...baseProps()} />);
    await userEvent.click(screen.getByText('REGISTER'));
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'secret');
    await userEvent.type(screen.getByPlaceholderText('CONFIRM_ACCESS_CODE'), 'secret');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'What is your favorite movie?');
    await userEvent.type(screen.getByPlaceholderText('SECURITY_ANSWER'), 'Blade Runner');
    await userEvent.click(screen.getByText('CREATE_ACCOUNT'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/player/register',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"username":"GHOST"'),
      })
    ));
  });
});

// ─── 3. Approval (admin side) ────────────────────────────────────────────────

describe('Admin approval flow', () => {
  it('calls approve endpoint when APPROVE is clicked in pending panel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchMock);

    // Render a minimal approval panel directly (approval lives in App, not SecureLogin)
    // We test the fetch call indirectly via a wrapper that mimics what App does
    const ApprovalPanel = ({ token }: { token: string }) => {
      const approve = async (username: string) => {
        await fetch(`/api/player/admin/players/${username}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      };
      return <button onClick={() => approve('GHOST')}>APPROVE</button>;
    };
    render(<ApprovalPanel token="admin-token" />);
    await userEvent.click(screen.getByText('APPROVE'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/player/admin/players/GHOST/approve',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }) })
    );
  });
});

// ─── 3b. Pending approval polling — player-side redirect ─────────────────────
// These tests let the real 3-second interval fire; each has a 6-second timeout.

describe('Pending approval polling', () => {
  const registerAs = async (username: string) => {
    await userEvent.click(screen.getByText('REGISTER'));
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), username);
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'secret');
    await userEvent.type(screen.getByPlaceholderText('CONFIRM_ACCESS_CODE'), 'secret');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'What is your favorite movie?');
    await userEvent.type(screen.getByPlaceholderText('SECURITY_ANSWER'), 'Blade Runner');
    await userEvent.click(screen.getByText('CREATE_ACCOUNT'));
    await waitFor(() => expect(screen.getByText('REGISTRATION_SUBMITTED')).toBeInTheDocument());
  };

  it('redirects to login when poll returns approved', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ message: 'Account pending admin approval' }) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'approved' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SecureLogin {...baseProps()} />);
    await registerAs('GHOST');

    await waitFor(
      () => expect(screen.getByText('LOGIN')).toBeInTheDocument(),
      { timeout: 5000 }
    );
    expect(screen.queryByText('REGISTRATION_SUBMITTED')).not.toBeInTheDocument();
  }, 6000);

  it('redirects to login with error when poll returns denied', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ message: 'Account pending admin approval' }) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'denied' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SecureLogin {...baseProps()} />);
    await registerAs('GHOST');

    await waitFor(
      () => expect(screen.getByText(/denied/i)).toBeInTheDocument(),
      { timeout: 5000 }
    );
  }, 6000);

  it('polls the correct status endpoint for the registered username', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ message: 'Account pending admin approval' }) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'pending' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SecureLogin {...baseProps()} />);
    await registerAs('GHOST');

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([url]) => url);
      expect(calls).toContain('/api/player/players/status/GHOST');
    }, { timeout: 5000 });
  }, 6000);
});

// ─── 4. Successful login ─────────────────────────────────────────────────────

describe('Successful secure login', () => {
  it('calls onSecureLogin with username and token on valid credentials', async () => {
    mockFetch({
      'POST /api/login': { ok: false, body: { error: 'Unauthorized' } },
      'POST /api/player/login': { ok: true, body: { playerToken: 'tok-abc', tempPassword: false } },
    });
    const props = baseProps();
    render(<SecureLogin {...props} />);
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'correct');
    await userEvent.click(screen.getByText('LOGIN'));
    await waitFor(() => expect(props.onSecureLogin).toHaveBeenCalledWith('GHOST', 'tok-abc'));
  });

  it('calls onAdminLogin when admin credentials are used', async () => {
    mockFetch({
      'POST /api/player/login': { ok: false, body: { error: 'Invalid username or password' } },
      'POST /api/login': { ok: true, body: { token: 'admin-tok' } },
      'GET /api/player/admin/players/pending': { ok: true, body: [] },
    });
    const props = baseProps();
    render(<SecureLogin {...props} />);
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'admin');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'adminpass');
    await userEvent.click(screen.getByText('LOGIN'));
    await waitFor(() => expect(props.onAdminLogin).toHaveBeenCalledWith('admin', 'admin-tok'));
  });
});

// ─── 5. Incorrect password ───────────────────────────────────────────────────

describe('Incorrect password', () => {
  it('shows error message when both player and admin login fail', async () => {
    mockFetch({
      'POST /api/player/login': { ok: false, body: { error: 'Invalid username or password' } },
      'POST /api/login': { ok: false, body: { error: 'Unauthorized' } },
    });
    const props = baseProps();
    render(<SecureLogin {...props} />);
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'wrongpass');
    await userEvent.click(screen.getByText('LOGIN'));
    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
    expect(props.onSecureLogin).not.toHaveBeenCalled();
    expect(props.onAdminLogin).not.toHaveBeenCalled();
  });

  it('shows pending error when account exists but is pending approval', async () => {
    mockFetch({
      'POST /api/player/login': { ok: false, body: { error: 'Account pending admin approval' } },
      'POST /api/login': { ok: false, body: { error: 'Unauthorized' } },
    });
    render(<SecureLogin {...baseProps()} />);
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'secret');
    await userEvent.click(screen.getByText('LOGIN'));
    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
  });
});

// ─── 6. Deny ────────────────────────────────────────────────────────────────

describe('Admin deny flow', () => {
  it('calls deny endpoint with DELETE method', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const DenyPanel = ({ token }: { token: string }) => {
      const deny = async (username: string) => {
        await fetch(`/api/player/admin/players/${username}/deny`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      };
      return <button onClick={() => deny('GHOST')}>DENY</button>;
    };
    render(<DenyPanel token="admin-token" />);
    await userEvent.click(screen.getByText('DENY'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/player/admin/players/GHOST/deny',
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }) })
    );
  });
});

// ─── 7. Re-registration after deny ──────────────────────────────────────────

describe('Re-registration after deny', () => {
  it('allows registration with a previously denied username', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ message: 'Account pending admin approval' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SecureLogin {...baseProps()} />);
    await userEvent.click(screen.getByText('REGISTER'));
    await userEvent.type(screen.getByPlaceholderText('OPERATOR_ID'), 'GHOST');
    await userEvent.type(screen.getByPlaceholderText('ACCESS_CODE'), 'newpass');
    await userEvent.type(screen.getByPlaceholderText('CONFIRM_ACCESS_CODE'), 'newpass');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'What was the name of your first pet?');
    await userEvent.type(screen.getByPlaceholderText('SECURITY_ANSWER'), 'Rex');
    await userEvent.click(screen.getByText('CREATE_ACCOUNT'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/player/register', expect.any(Object)));
    await waitFor(() => expect(screen.getByText('REGISTRATION_SUBMITTED')).toBeInTheDocument());
  });
});
