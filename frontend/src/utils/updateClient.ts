/**
 * Driving an in-app update.
 *
 * There are two places to start one — the update modal and the nav panel — and they had
 * separate implementations. Only one of them got hardened, so the panel button, which is
 * the one the upgrade guide tells people to click, still reported "waiting for server"
 * for ever on a stack that could not update. Hence one implementation.
 */

/** What to run on the host when a container cannot update itself. */
export const MANUAL_COMMAND = 'docker compose pull && docker compose up -d';

/** Long enough for a pull and a recreate on a slow line; short enough to end. */
export const DEADLINE_MS = 6 * 60 * 1000;

/** Long enough that a normal pull has not finished, short enough to reassure. */
export const REASSURE_MS = 45 * 1000;

export interface UpdateOutcome {
  ok: boolean;
  /** Set when it failed; already phrased for a person to read. */
  error?: string;
  /** Set when the operator needs to run something themselves. */
  command?: string;
}

/**
 * Does the server behind this page have the self-checking updater?
 *
 * A container from before it has no `/api/update/status`, and asking is the one reliable
 * way to find out — its `/api/update` cheerfully answers "Update started" and then does
 * nothing, which is the failure being guarded against.
 *
 * The shape is checked, not just the status code: a setup that serves index.html for
 * unknown paths would otherwise answer 200 with a page and look modern.
 */
export async function hasModernUpdater(): Promise<boolean> {
  try {
    const res = await fetch('/api/update/status');
    if (!res.ok) return false;
    const data = await res.json();
    return typeof data?.phase === 'string';
  } catch {
    return false;
  }
}

/** The running server's boot id, which changes when it restarts. */
export async function currentBootId(): Promise<string> {
  try {
    const data = await (await fetch('/api/version')).json();
    return data.bootId ?? '';
  } catch {
    return '';
  }
}

/**
 * Ask the server to update, refusing to try where it cannot work.
 *
 * Returns the reason rather than throwing, because every caller wants to show it.
 */
export async function startUpdate(token: string): Promise<UpdateOutcome> {
  if (!(await hasModernUpdater())) {
    return {
      ok: false,
      error: 'This container was built before the self-updating backend, so an in-app update '
        + 'would report success and then do nothing. Run this on the host, in the folder '
        + 'holding docker-compose.yml — after that, in-app updates work.',
      command: MANUAL_COMMAND,
    };
  }

  try {
    const res = await fetch('/api/update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true };
    // Preflight refused and said why — most often a container started before the
    // compose file mounted itself.
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error || `Server returned ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The server could not be reached.' };
  }
}

/**
 * Wait for the server to come back, or give up and say why.
 *
 * Waits on the boot id rather than the version: a build without `APP_VERSION` reports
 * `dev` before and after, so waiting on the version hangs even when the update worked.
 * Falls back to the version only when the server is too old to have a boot id.
 *
 * Bounded, unlike the version this replaces, which polled every three seconds for ever —
 * so a stack that could not update was indistinguishable from one still working.
 */
export async function waitForRestart(opts: {
  bootId: string;
  currentVersion: string;
  onRestart: () => void;
  onFailed: (error: string, command?: string) => void;
  onStillWorking?: () => void;
}): Promise<void> {
  const started = Date.now();
  const deadline = started + DEADLINE_MS;
  let reassured = false;

  const poll = async (): Promise<void> => {
    if (!reassured && Date.now() - started > REASSURE_MS) {
      reassured = true;
      opts.onStillWorking?.();
    }

    // The server records its own failures now, so ask before assuming it is just slow.
    try {
      const st = await (await fetch('/api/update/status')).json();
      if (st.phase === 'failed') {
        return opts.onFailed(st.error || 'No reason given.');
      }
    } catch { /* restarting, which is the point */ }

    try {
      const res = await fetch('/api/version');
      if (res.ok) {
        const data = await res.json();
        const restarted = opts.bootId
          ? data.bootId && data.bootId !== opts.bootId
          : data.version !== opts.currentVersion;
        if (restarted) return opts.onRestart();
      }
    } catch { /* restarting */ }

    if (Date.now() > deadline) {
      return opts.onFailed(
        'The server did not come back within six minutes. Check backend/data/update.log '
          + 'for what happened, then recreate the stack from the host:',
        MANUAL_COMMAND
      );
    }
    setTimeout(poll, 3000);
  };

  setTimeout(poll, 10000);
}
