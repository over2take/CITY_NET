import { useCallback, useEffect, useRef, useState } from 'react';

// The dice tray's ROLL or LANDED (6c4b3b): every throw played, or the dice shown as they came to
// rest. Kept on the signed-in person's account (6c4b3a, /api/me/settings), so it follows them to
// any computer, and in the browser too: the browser's copy is what someone not signed in keeps,
// and what shows at once while the account's is fetched. Starts on ROLL.

export type TrayMotion = 'roll' | 'landed';

const KEY = 'citynet_tray_motion';
const isMotion = (v: unknown): v is TrayMotion => v === 'roll' || v === 'landed';

const readLocal = (): TrayMotion => {
  try { const v = localStorage.getItem(KEY); return isMotion(v) ? v : 'roll'; } catch { return 'roll'; }
};
const writeLocal = (v: TrayMotion) => { try { localStorage.setItem(KEY, v); } catch { /* a private window keeps it for now only */ } };

/** The tray's motion and a way to change it, saved to the account of whoever `authToken` signs in. */
export function useTrayMotion(authToken?: string | null) {
  const [motion, setMotion] = useState<TrayMotion>(readLocal);
  // A choice made here before the account answered stands: the late answer doesn't undo it.
  const chosen = useRef(false);

  useEffect(() => {
    if (!authToken) return undefined;
    let gone = false;
    fetch('/api/me/settings', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (gone || chosen.current || !s || !isMotion(s.trayMotion)) return;
        setMotion(s.trayMotion);
        writeLocal(s.trayMotion);
      })
      .catch(() => { /* offline: the browser's copy stands */ });
    return () => { gone = true; };
  }, [authToken]);

  const choose = useCallback((next: TrayMotion) => {
    chosen.current = true;
    setMotion(next);
    writeLocal(next);
    if (!authToken) return;
    fetch('/api/me/settings', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trayMotion: next }),
    }).catch(() => { /* kept in the browser; the account catches up on the next change */ });
  }, [authToken]);

  return [motion, choose] as const;
}
