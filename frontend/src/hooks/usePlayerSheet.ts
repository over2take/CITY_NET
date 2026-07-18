import { useState, useEffect, useRef, useCallback } from 'react';
import { getTemplate, getMaxPairs, hiddenTabsFor, type CharacterSheet } from '../sheets';

// Shared client logic for the player's own character sheet, used by both
// surfaces that render it: the in-game floating window
// (CharacterSheetWindow) and the standalone browser tab (SheetPage).
// Owns: sheet state with the pending-edit merge, the debounced field save
// with max-pair clamping, house-rule flags, and the server-side action
// emitters (roll / death save / stabilize / cast). Add sheet behavior HERE,
// not in the surfaces - that's how the two stay in sync.

export interface PlayerSheetActions {
  onRoll: (fieldId: string, luck?: number, negateFumble?: boolean) => void;
  onDeathSave: () => void;
  onStabilize: () => void;
  onCastSpell: (index: number) => void;
}

export function usePlayerSheet(
  socket: any,
  userName: string | null,
  opts: { onRolled?: () => void } = {},
) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [allowFumbleShield, setAllowFumbleShield] = useState(false);
  const [ruleSettings, setRuleSettings] = useState<{ key: string; value: string }[]>([]);
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onRolledRef = useRef(opts.onRolled);
  onRolledRef.current = opts.onRolled;

  useEffect(() => {
    if (!socket || !userName) return;
    const onSheetData = (data: CharacterSheet) => {
      if (data.username !== userName) return;
      // A re-fetch must not stomp fields the player is mid-typing (debounce
      // still pending) - keep the local value for those, take the rest.
      setSheet(prev => {
        if (!prev || pendingSaves.current.size === 0) return data;
        const merged = { ...data.data };
        pendingSaves.current.forEach((_t, fieldId) => {
          if (prev.data[fieldId] !== undefined) merged[fieldId] = prev.data[fieldId];
        });
        return { ...data, data: merged };
      });
    };
    // Re-sync on admin edits / token HP changes / bank changes (cash is a
    // linked field mirroring the bank balance)
    const refetch = (info: { username: string }) => {
      if (info.username === userName) socket.emit('requestMySheet');
    };
    // House rules gate sheet features; refresh when the admin applies
    const fetchRules = () => {
      fetch('/api/settings').then(r => r.json()).then((rows) => {
        if (Array.isArray(rows)) {
          setAllowFumbleShield(rows.find((r: any) => r.key === 'luck_negates_fumble')?.value === '1');
          setRuleSettings(rows);
        }
      }).catch(() => {});
    };
    const onSystemChanged = () => socket.emit('requestMySheet');
    fetchRules();
    socket.on('sheetData', onSheetData);
    socket.on('sheetUpdated', refetch);
    socket.on('bankUpdate', refetch);
    socket.on('settingsUpdated', fetchRules);
    socket.on('gameSystemChanged', onSystemChanged);
    socket.emit('requestMySheet');
    return () => {
      socket.off('sheetData', onSheetData);
      socket.off('sheetUpdated', refetch);
      socket.off('bankUpdate', refetch);
      socket.off('settingsUpdated', fetchRules);
      socket.off('gameSystemChanged', onSystemChanged);
    };
  }, [socket, userName]);

  // Cancel outstanding debounce timers on unmount
  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    setSheet(prev => {
      if (!prev) return prev;
      const template = getTemplate(prev.system);
      const pairs = getMaxPairs(template);
      const curField = pairs[fieldId]; // non-null when fieldId is a max field
      const data = { ...prev.data, [fieldId]: value };
      if (curField !== undefined && data[curField] !== undefined) {
        const newMax = Number(value);
        if (Number(data[curField]) > newMax) data[curField] = newMax;
      }
      return { ...prev, data };
    });
    const timers = pendingSaves.current;
    const existing = timers.get(fieldId);
    if (existing) clearTimeout(existing);
    timers.set(fieldId, setTimeout(() => {
      timers.delete(fieldId);
      socket?.emit('updateSheetField', { fieldId, value });
    }, 400));
  }, [socket]);

  const rolled = () => onRolledRef.current?.();
  const actions: PlayerSheetActions = {
    onRoll: (fieldId, luck, negateFumble) => {
      socket?.emit('requestSheetRoll', { fieldId, luck, luckNegate: negateFumble });
      rolled();
    },
    onDeathSave: () => { socket?.emit('requestDeathSave'); rolled(); },
    onStabilize: () => { socket?.emit('requestStabilize', { targetUsername: userName }); rolled(); },
    onCastSpell: (index: number) => { socket?.emit('castSpell', { index }); rolled(); },
  };

  const template = sheet ? getTemplate(sheet.system) : null;
  const hiddenTabs = hiddenTabsFor(sheet?.system, ruleSettings);

  return { sheet, template, handleFieldChange, allowFumbleShield, hiddenTabs, actions };
}

/** Portrait upload shared by both sheet surfaces. The server emits
 *  sheetUpdated afterwards, which re-fetches the sheet with the new URL. */
export const uploadSheetPortrait = async (authToken: string | null | undefined, file: File) => {
  if (!authToken) return;
  const form = new FormData();
  form.append('portrait', file);
  await fetch('/api/sheets/portrait', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: form,
  });
};
