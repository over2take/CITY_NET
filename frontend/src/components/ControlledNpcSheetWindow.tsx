import React, { useCallback, useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { SheetRenderer } from './SheetRenderer';
import { getTemplate, hiddenTabsFor, npcTemplateOf, type CharacterSheet } from '../sheets';

// A friendly NPC's sheet for the player the GM gave it to (4b5b4; asked for by the user
// 2026-10-07): read-only, from GET /api/sheets/npcs/controlled/:location_id, which only answers
// that player (backend tokens/tokenAccess.js controls). Its roll buttons roll as the NPC: the
// server takes the token and rolls from the NPC's own sheet, naming it in the log.

interface Props {
  /** The player's own login: the server reads who is asking from it. */
  token: string;
  /** The NPC's token. */
  locationId: number;
  name: string;
  socket: any;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
}

export function ControlledNpcSheetWindow({ token, locationId, name, socket, pos, setPos, onClose }: Props) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ruleSettings, setRuleSettings] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((rows) => { if (Array.isArray(rows)) setRuleSettings(rows); }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let res: Response;
      try {
        res = await fetch(`/api/sheets/npcs/controlled/${locationId}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        if (!cancelled) setError('Could not reach the server.');
        return;
      }
      if (cancelled) return;
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(res.status === 404 ? 'NO_SHEET_YET // THE GM HAS NOT MADE ONE' : (body?.error ?? 'ACCESS_DENIED'));
        return;
      }
      setError(null);
      setSheet(await res.json());
    };
    load();
    if (!socket) return () => { cancelled = true; };
    // Its HP lives on the token, and LUCK comes off its sheet when it rolls.
    const onSheetUpdated = (info: { npc_id?: number }) => { if (info?.npc_id !== undefined) load(); };
    socket.on('dataUpdated', load);
    socket.on('sheetUpdated', onSheetUpdated);
    return () => {
      cancelled = true;
      socket.off('dataUpdated', load);
      socket.off('sheetUpdated', onSheetUpdated);
    };
  }, [locationId, token, socket]);

  const roll = useCallback((fieldId: string, luck?: number, luckNegate?: boolean) => {
    socket?.emit('requestSheetRoll', { fieldId, location_id: locationId, ...(luck ? { luck } : {}), ...(luckNegate ? { luckNegate } : {}) });
  }, [socket, locationId]);
  const rollAbility = useCallback((formula: string, label: string) => {
    socket?.emit('rollAbility', { formula, label, location_id: locationId });
  }, [socket, locationId]);

  const template = sheet ? npcTemplateOf(getTemplate(sheet.system)) : null;

  return (
    <DraggableWindow
      title={`NPC_SHEET.EXE · ${name.toUpperCase()} [READ-ONLY]`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{
        width: '520px', height: '74vh', minWidth: '360px', maxWidth: '520px', minHeight: '320px', maxHeight: '92vh',
        resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
      contentStyle={{ flex: 1, minHeight: 0, maxHeight: 'none', display: 'flex', flexDirection: 'column', padding: '4px 10px 0' }}
    >
      <div style={{ fontSize: '0.6rem', opacity: 0.7, letterSpacing: '1px', padding: '2px 0 6px' }}>
        THE GM GAVE YOU THIS NPC · YOU ROLL FOR IT · ONLY THE GM CHANGES ITS SHEET
      </div>
      {sheet && template ? (
        <SheetRenderer
          template={template}
          data={sheet.data}
          portraitUrl={sheet.portrait_url}
          readOnly
          onFieldChange={() => undefined}
          onRoll={roll}
          onRollAbility={rollAbility}
          hiddenTabs={hiddenTabsFor(sheet.system, ruleSettings)}
        />
      ) : (
        <div role={error ? 'alert' : undefined} style={{ fontSize: '0.7rem', opacity: 0.7, padding: '10px' }}>
          {error ?? 'ACCESSING RECORD...'}
        </div>
      )}
    </DraggableWindow>
  );
}
