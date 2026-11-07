import { useEffect, useState, type RefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { customTemplate, isCustomSystem, useCustomTemplate } from '../sheets/customTemplates';
import { levelUpOffer } from '../sheets/xpMeter';

// Whether this user can go up a level (7d2b), for what blinks with no sheet window open to ask. Only in a system
// where levels go up, and only peeking: someone with no sheet, the GM among them, isn't given a blank one.

interface Sheet { username: string; system: string; data: Record<string, unknown> }

export function useLevelReady(socketRef: RefObject<Socket | null>, userName: string | null | undefined, system: string | null | undefined): boolean {
  useCustomTemplate(isCustomSystem(system) ? system : null);
  const template = isCustomSystem(system) ? customTemplate(system) : undefined;
  const on = !!template?.levels;
  const [sheet, setSheet] = useState<Sheet | null>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !userName || !on) return undefined;
    const ask = () => socket.emit('requestMySheet', { peek: true });
    const onSheet = (s: Sheet) => { if (s.username === userName) setSheet(s); };
    const onUpdated = (info: { username?: string }) => { if (info?.username === userName) ask(); };
    socket.on('sheetData', onSheet);
    socket.on('sheetUpdated', onUpdated);
    socket.on('identified', ask);
    ask();
    return () => {
      socket.off('sheetData', onSheet);
      socket.off('sheetUpdated', onUpdated);
      socket.off('identified', ask);
    };
  }, [socketRef, userName, on]);

  return !!sheet && sheet.system === system && !!levelUpOffer(template, sheet.data)?.ready;
}
