import { useEffect, useState, type RefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { customTemplate, isCustomSystem, useCustomTemplate } from '../sheets/customTemplates';
import { flowState, type FlowState } from '../sheets/newCharacterFlow';

// Where this user stands with the guided new character (7c2), for what blinks and what CHARACTER_SHEET
// opens, with no sheet window open to ask. It only asks for the sheet in a system with the flow on:
// asking makes a blank sheet for anyone who has none, and nobody else's table should gain those.
// It asks again on 'identified': on signing in it can run ahead of the server knowing who they are,
// when the question is dropped with no answer.
//
// It takes the ref, read inside its effect: useSocket makes the socket in an effect of its own, with
// nothing to draw again afterwards, so a value read while drawing can stay null. Call this after
// useSocket, with no name until signed in, and the socket is there when the name is.

interface Sheet { username: string; system: string; data: Record<string, unknown> }

export function useNewCharacter(socketRef: RefObject<Socket | null>, userName: string | null | undefined, system: string): FlowState {
  useCustomTemplate(isCustomSystem(system) ? system : null);
  const template = isCustomSystem(system) ? customTemplate(system) : undefined;
  const on = !!template?.creation;
  const [sheet, setSheet] = useState<Sheet | null>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !userName || !on) return undefined;
    const ask = () => socket.emit('requestMySheet');
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

  return sheet && sheet.system === system ? flowState(template, sheet.data) : 'none';
}
