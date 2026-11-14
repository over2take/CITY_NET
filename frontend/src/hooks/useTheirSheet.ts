import { useCallback, useEffect, useRef, useState } from 'react';
import { getTemplate, type CharacterSheet, type SheetFieldValue } from '../sheets';

// A player's sheet as the GM has it (7c5's FILL IT IN FOR THEM): read and written through the admin
// routes, as NpcSheetWindow's are, and read again whenever the sheet changes. An edit waits a moment and
// goes as one, and `flush` sends any still waiting, so FINISH never overtakes what was just typed.

const WAIT_MS = 400;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's socket is untyped throughout
export function useTheirSheet(token: string, socket: any, username: string) {
  const path = `/api/sheets/user/${encodeURIComponent(username)}`;
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const waiting = useRef<Record<string, SheetFieldValue>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const fields = waiting.current;
    if (!Object.keys(fields).length) return;
    waiting.current = {};
    await fetch(path, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  }, [path, token]);

  useEffect(() => {
    let gone = false;
    const load = async () => {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      if (gone || !res.ok) return;
      const fresh: CharacterSheet = await res.json();
      // Not over what is still waiting to go.
      if (!gone) setSheet({ ...fresh, data: { ...fresh.data, ...waiting.current } });
    };
    load();
    const onUpdated = (info: { username: string }) => { if (info.username === username) load(); };
    socket?.on('sheetUpdated', onUpdated);
    return () => { gone = true; socket?.off('sheetUpdated', onUpdated); };
  }, [path, token, socket, username]);

  const onField = useCallback((id: string, value: SheetFieldValue) => {
    setSheet((prev) => (prev ? { ...prev, data: { ...prev.data, [id]: value } } : prev));
    waiting.current = { ...waiting.current, [id]: value };
    clearTimeout(timer.current);
    // Left running if the window closes, so an edit still goes.
    timer.current = setTimeout(() => { void flush(); }, WAIT_MS);
  }, [flush]);

  const upload = useCallback(async (file: File) => {
    const form = new FormData();
    form.append('portrait', file);
    const res = await fetch(`/api/sheets/portrait?username=${encodeURIComponent(username)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!res.ok) return;
    const { portrait_url } = await res.json();
    setSheet((prev) => (prev ? { ...prev, portrait_url } : prev));
  }, [token, username]);

  return { sheet, template: sheet ? getTemplate(sheet.system) : null, onField, flush, upload };
}
