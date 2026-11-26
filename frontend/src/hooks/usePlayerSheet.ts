import type { RollPick } from '../sheets/types';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getTemplate, getMaxPairs, hiddenTabsFor, type CharacterSheet, type SheetFieldValue } from '../sheets';
import { SLOW_ADVANCEMENT_RULE } from '../sheets/cwnAdvancement';
import { ENCUMBRANCE_RULE } from '../sheets/cwnEncumbrance';
import { carryingShown, gearByPlayers } from '../sheets/tableSwitches';
import { OVERDRAFT_RULE } from '../data/shopRules';
import { isOpen } from '../sheets/restCalls';
import { INVENTORY_FIELD } from '../sheets/inventory';
import { useChoicesRefused } from './useChoicesRefused';
import type { SheetRendererProps } from '../components/SheetRenderer';
import type { SheetVitals } from '../sheets/vitals';

// Shared client logic for the player's own character sheet, used by both
// surfaces that render it: the in-game floating window
// (CharacterSheetWindow) and the standalone browser tab (SheetPage).
// Owns: sheet state with the pending-edit merge, the debounced field save
// with max-pair clamping, house-rule flags, and the server-side action
// emitters (roll / death save / stabilize / cast). Add sheet behavior HERE,
// not in the surfaces - that's how the two stay in sync.
//
// `sheetProps` (8s1a) is every play prop a sheet surface hands SheetRenderer, the actions with what the server last
// refused and whether recovery is open: both surfaces spread it whole, so a new action reaches the standalone tab and
// the window together (the user, 2026-11-15: "they should be identical"). Phase 7's choices, levels, items, spending,
// improving and rests had been wired into the window alone; a test (SheetSurfaces.test.tsx) now holds them level.

export interface PlayerSheetActions {
  onRoll: (fieldId: string, luck?: number, negateFumble?: boolean, pick?: RollPick) => void;
  onDeathSave: () => void;
  onStabilize: () => void;
  onCastSpell: (index: number) => void;
  onRollAbility: (formula: string, label: string) => void;
  onResistDrain: (drainValue: number, attr: string, label: string) => void;
  /** A line of gear's DAMAGE or DICE rolled (8a3b): the line by its place in the inventory, the column by id. */
  onGearRoll?: (line: number, column: string) => void;
  /** A line's DAMAGE or DICE as typed, read as ROLL would on this character (8a3c2). */
  onReadGearDice?: (text: string) => Promise<import('../sheets/gearDice').GearDiceRead | null>;
  onReadGearLines?: (texts: string[]) => Promise<import('../sheets/gearDice').GearDiceRead[] | null>;
  /** A line's COUNT spent by its button or RELOADed (8a4b), answered by the server. */
  onGearCount?: import('../sheets/gearTypes').GearCount;
  /** Picks, drops and uses on CHOICES (7a3), levels (7d), items (7e), SPEND XP (7f2), marks (7f3), rests and recovery dice. */
  onChoices: NonNullable<SheetRendererProps['onChoices']>;
  onLevel: NonNullable<SheetRendererProps['onLevel']>;
  onItem: NonNullable<SheetRendererProps['onItem']>;
  onSpend: NonNullable<SheetRendererProps['onSpend']>;
  onImprove: NonNullable<SheetRendererProps['onImprove']>;
  onRecoverySpend: NonNullable<SheetRendererProps['onRecoverySpend']>;
  onRestTake: NonNullable<SheetRendererProps['onRestTake']>;
}

export function usePlayerSheet(
  socket: any,
  userName: string | null,
  /** `authToken`: the sign-in the vitals strip sends with a change to the token's health, as HEALTH does (8s3b). */
  opts: { onRolled?: () => void; authToken?: string | null } = {},
) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [allowFumbleShield, setAllowFumbleShield] = useState(false);
  const [ruleSettings, setRuleSettings] = useState<{ key: string; value: string }[]>([]);
  // The value is held alongside the timer so an unmount can still send it. Holding only
  // the timer meant a pending edit could be cancelled but never completed.
  const pendingSaves = useRef<Map<string, { value: SheetFieldValue; timer: ReturnType<typeof setTimeout> }>>(new Map());
  const onRolledRef = useRef(opts.onRolled);
  onRolledRef.current = opts.onRolled;
  // The unmount handler runs once and would otherwise close over the first socket it saw.
  const socketRef = useRef(socket);
  socketRef.current = socket;
  // Why the server last said no to a pick, a level, a use or a rest, under the CHOICES block.
  const choicesRefused = useChoicesRefused(socket);

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

  /**
   * Write several fields as one save.
   *
   * Not a loop over handleFieldChange: each of those is a separate read-modify-write of
   * the whole sheet blob on the server, so a dozen fired together race and all but the
   * last are lost. Picking a vehicle type is exactly that case.
   */
  const handleFieldsChange = useCallback((fields: Record<string, string | number>) => {
    const entries = Object.entries(fields);
    if (!entries.length) return;
    setSheet(prev => {
      if (!prev) return prev;
      const template = getTemplate(prev.system);
      const pairs = getMaxPairs(template);
      const data = { ...prev.data };
      entries.forEach(([fieldId, value]) => {
        data[fieldId] = value;
        const curField = pairs[fieldId]; // non-null when fieldId is a max field
        if (curField !== undefined && data[curField] !== undefined) {
          const newMax = Number(value);
          if (Number(data[curField]) > newMax) data[curField] = newMax;
        }
      });
      return { ...prev, data };
    });
    // A pending single-field save for any of these would land after the batch and
    // reinstate the old value.
    entries.forEach(([fieldId]) => {
      const pending = pendingSaves.current.get(fieldId);
      if (pending) { clearTimeout(pending.timer); pendingSaves.current.delete(fieldId); }
    });
    socket?.emit('importSheetFields', { fields });
  }, [socket]);

  /**
   * Send anything still waiting when the sheet goes away, rather than dropping it.
   *
   * An edit is held for 400ms before being sent, so closing the sheet inside that window
   * used to discard it silently — the change was on screen, in local state, and never
   * reached the server. It showed up as removing a piece of cyberware not sticking while
   * adding one did: adding means typing, which always outlasts the delay, but removing is
   * a single click and people close the window straight after.
   */
  useEffect(() => () => {
    pendingSaves.current.forEach(({ value, timer }, fieldId) => {
      clearTimeout(timer);
      socketRef.current?.emit('updateSheetField', { fieldId, value });
    });
    pendingSaves.current.clear();
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: SheetFieldValue) => {
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
    if (existing) clearTimeout(existing.timer);
    timers.set(fieldId, {
      value,
      timer: setTimeout(() => {
        timers.delete(fieldId);
        socket?.emit('updateSheetField', { fieldId, value });
      }, 400),
    });
  }, [socket]);

  const rolled = () => onRolledRef.current?.();
  const actions: PlayerSheetActions = {
    onRoll: (fieldId, luck, negateFumble, pick) => {
      socket?.emit('requestSheetRoll', { fieldId, luck, luckNegate: negateFumble, ...(pick ? { rollId: pick.rollId, changes: pick.changes } : {}) });
      rolled();
    },
    onDeathSave: () => { socket?.emit('requestDeathSave'); rolled(); },
    onStabilize: () => { socket?.emit('requestStabilize', { targetUsername: userName }); rolled(); },
    onCastSpell: (index: number) => { socket?.emit('castSpell', { index }); rolled(); },
    onRollAbility: (formula: string, label: string) => { socket?.emit('rollAbility', { formula, label }); rolled(); },
    onResistDrain: (drainValue: number, attr: string, label: string) => { socket?.emit('resistDrain', { drainValue, attr, label }); rolled(); },
    onGearRoll: (line: number, column: string) => { socket?.emit('requestSheetRoll', { gear: { line, column } }); rolled(); },
    // Answered by the server's reply; no answer in 5 s (the connection down) is none, the box saying it is reading.
    onReadGearDice: (text: string) => new Promise((resolve) => {
      if (!socket) { resolve(null); return; }
      const timer = setTimeout(() => resolve(null), 5000);
      socket.emit('readGearDice', { text }, (answer: import('../sheets/gearDice').GearDiceRead) => { clearTimeout(timer); resolve(answer ?? null); });
    }),
    // Every line's DAMAGE and DICE at once (8e1), for their worked-out numbers; no answer in 5 s is none, ROLL as before.
    onReadGearLines: (texts: string[]) => new Promise((resolve) => {
      if (!socket) { resolve(null); return; }
      const timer = setTimeout(() => resolve(null), 5000);
      socket.emit('readGearLines', { texts }, (answer: { ok: boolean; reads?: import('../sheets/gearDice').GearDiceRead[] }) => { clearTimeout(timer); resolve(answer && answer.ok && answer.reads ? answer.reads : null); });
    }),
    // FIRE and RELOAD (8a4b): a gear edit still waiting its 400 ms is sent first, in order, so it can't land after the
    // server's count and put it back. No answer in 5 s is none.
    onGearCount: (line, column, kind, from) => new Promise((resolve) => {
      if (!socket) { resolve(null); return; }
      const waiting = pendingSaves.current.get(INVENTORY_FIELD);
      if (waiting) {
        clearTimeout(waiting.timer);
        pendingSaves.current.delete(INVENTORY_FIELD);
        socket.emit('updateSheetField', { fieldId: INVENTORY_FIELD, value: waiting.value });
      }
      const timer = setTimeout(() => resolve(null), 5000);
      socket.emit('countAction', { kind, line, column, ...(from !== undefined ? { from } : {}) }, (answer: import('../sheets/gearTypes').CountAnswer) => { clearTimeout(timer); resolve(answer ?? null); });
    }),
    onChoices: (action) => socket?.emit('choicesAction', action),
    onLevel: (action) => socket?.emit('levelAction', action),
    onItem: (action) => socket?.emit('itemAction', action),
    onSpend: (action) => socket?.emit('spendAction', action),
    onImprove: (action) => socket?.emit('improveAction', action),
    onRecoverySpend: (pool, count) => socket?.emit('recoverySpend', { pool, count }),
    onRestTake: (rest) => socket?.emit('restTake', { rest }),
  };

  const template = sheet ? getTemplate(sheet.system) : null;
  const hiddenTabs = hiddenTabsFor(sheet?.system, ruleSettings);
  // Which XP column the whole table advances on. A house rule rather than a sheet field:
  // the GM picks it once, not once per character.
  const xpRate: 'fast' | 'slow' =
    ruleSettings.find((r) => r.key === SLOW_ADVANCEMENT_RULE)?.value === '1' ? 'slow' : 'fast';

  // Whether what a character carries costs them Move. Off by default, and the book agrees.
  const encumbranceEnforced =
    ruleSettings.find((r) => r.key === ENCUMBRANCE_RULE)?.value === '1';

  // Whether a shop may let a player spend past zero. Off refuses the purchase outright;
  // on, the shop asks how to cover the shortfall. The server enforces it either way -
  // this only decides whether the window offers the choice.
  const overdraftAllowed =
    ruleSettings.find((r) => r.key === OVERDRAFT_RULE)?.value === '1';

  // CARRYING on GEAR, unless the table switched SHOW ENCUMBRANCE off (8a6b).
  const showCarrying = carryingShown(ruleSettings);
  // Players change their gear's columns, unless the table switched PLAYERS CHANGE GEAR off (G6b).
  const playersChangeGear = gearByPlayers(ruleSettings);

  // Whether the GM has spending recovery dice open (R2b), read with the house rules.
  const recoveryOpen = isOpen(ruleSettings);

  // The vitals strip (8s3b): the player's own token as the sheet came with it (8s3a), none before it has.
  const vitals: SheetVitals | undefined = sheet && userName && sheet.token !== undefined
    ? { token: sheet.token, owner: userName, system: sheet.system, authToken: opts.authToken ?? '', socket, reload: () => socket?.emit('requestMySheet') }
    : undefined;

  /** Every play prop a surface hands SheetRenderer: both spread it whole (8s1a). */
  const sheetProps = {
    ...actions, choicesRefused, recoveryOpen, allowFumbleShield, xpRate, encumbranceEnforced, hiddenTabs, vitals, carryingShown: showCarrying, playersChangeGear,
  } satisfies Partial<SheetRendererProps>;

  return {
    sheet, template, handleFieldChange, handleFieldsChange,
    allowFumbleShield, xpRate, encumbranceEnforced, overdraftAllowed, hiddenTabs, actions, sheetProps,
  };
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
