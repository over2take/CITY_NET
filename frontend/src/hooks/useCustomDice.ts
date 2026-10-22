import { useState, useCallback, useEffect, useMemo } from 'react';
import type { CustomDie } from '../types';
import { CUSTOM_TEMPLATE_EVENT } from '../sheets/customTemplates';

/** Payload for creating or updating a die — everything except the server-assigned id. */
export type CustomDieDraft = Omit<CustomDie, 'id'>;

/**
 * GM-defined custom dice, stored server-side so every connected player sees the
 * same set. Mutations require an admin token; the server broadcasts
 * `customDiceUpdated` after each one, which is what actually refreshes state
 * here (see `applyDice` wired up in App).
 */
export function useCustomDice(token?: string, gameSystem?: string) {
  const [gmDice, setGmDice] = useState<CustomDie[]>([]);
  const [systemDice, setSystemDice] = useState<CustomDie[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchDice = useCallback(async () => {
    try {
      const res = await fetch('/api/custom_dice');
      if (!res.ok) return;
      setGmDice(await res.json());
    } catch {
      /* offline or server down — keep whatever we already have */
    }
  }, []);

  useEffect(() => {
    fetchDice();
  }, [fetchDice]);

  // Built-in dice for the active system, and a custom system's own (6c4a). Refetched when the GM
  // switches systems, which arrives over the gameSystemChanged socket event, and when the running
  // system's published copy is loaded again (a new version may have new dice).
  const [published, setPublished] = useState(0);
  useEffect(() => {
    const onLoaded = (e: Event) => { if ((e as CustomEvent<{ id?: string }>).detail?.id === gameSystem) setPublished((n) => n + 1); };
    window.addEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
    return () => window.removeEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
  }, [gameSystem]);
  useEffect(() => {
    if (!gameSystem) {
      setSystemDice([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/system_dice/${encodeURIComponent(gameSystem)}`);
        if (!res.ok) return;
        const dice: CustomDie[] = await res.json();
        if (!cancelled) setSystemDice(dice.map(d => ({ ...d, locked: true })));
      } catch {
        if (!cancelled) setSystemDice([]);
      }
    })();
    return () => { cancelled = true; };
  }, [gameSystem, published]);

  // System dice sort first so the roller reads built-ins then GM additions.
  const customDice = useMemo(() => [...systemDice, ...gmDice], [systemDice, gmDice]);

  /** Replace GM dice from a `customDiceUpdated` socket broadcast. */
  const applyDice = useCallback((dice: CustomDie[]) => setGmDice(dice), []);

  const mutate = useCallback(async (
    url: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: CustomDieDraft,
  ): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Request failed');
        return false;
      }
      // State refresh arrives via the customDiceUpdated broadcast.
      return true;
    } catch {
      setError('Could not reach the server');
      return false;
    }
  }, [token]);

  const addDie = useCallback(
    (die: CustomDieDraft) => mutate('/api/custom_dice', 'POST', die),
    [mutate],
  );

  const updateDie = useCallback(
    (die: CustomDie) => mutate(`/api/custom_dice/${die.id}`, 'PUT', {
      name: die.name, sides: die.sides, faces: die.faces,
    }),
    [mutate],
  );

  const deleteDie = useCallback(
    (id: number | string) => mutate(`/api/custom_dice/${id}`, 'DELETE'),
    [mutate],
  );

  return { customDice, applyDice, addDie, updateDie, deleteDie, error, setError };
}
