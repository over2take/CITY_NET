import { useCallback, useEffect, useRef, useState } from 'react';

// One of a person's own settings (6c4b3a, /api/me/settings): kept on the signed-in account, so it
// follows them to any computer, and in the browser too: the browser's copy is what someone not
// signed in keeps, and what shows at once while the account's is fetched.

/**
 * A setting called `name` on the account `authToken` signs in, one of `choices`, starting on
 * `start`, kept in the browser under `localKey`; and a way to change it.
 */
export function useAccountSetting<T extends string>(name: string, choices: readonly T[], start: T, localKey: string, authToken?: string | null) {
  const isChoice = (v: unknown): v is T => choices.includes(v as T);
  const readLocal = (): T => {
    try { const v = localStorage.getItem(localKey); return isChoice(v) ? v : start; } catch { return start; }
  };
  const writeLocal = (v: T) => { try { localStorage.setItem(localKey, v); } catch { /* a private window keeps it for now only */ } };

  const [value, setValue] = useState<T>(readLocal);
  // A choice made here before the account answered stands: the late answer doesn't undo it.
  const chosen = useRef(false);

  useEffect(() => {
    if (!authToken) return undefined;
    let gone = false;
    fetch('/api/me/settings', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (gone || chosen.current || !s || !isChoice(s[name])) return;
        setValue(s[name]);
        writeLocal(s[name]);
      })
      .catch(() => { /* offline: the browser's copy stands */ });
    return () => { gone = true; };
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((next: T) => {
    chosen.current = true;
    setValue(next);
    writeLocal(next);
    if (!authToken) return;
    fetch('/api/me/settings', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [name]: next }),
    }).catch(() => { /* kept in the browser; the account catches up on the next change */ });
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return [value, choose] as const;
}
