import { useState, useEffect, useCallback, useRef } from 'react';

export interface Combatant {
  id: string;
  name: string;
  portraitUrl?: string;
  score: number;
  isNpc: boolean;
  insertOrder?: number;
}

export interface InitiativeState {
  sceneKey: string;
  combatId: number;
  combatants: Combatant[];
  turnIndex: number;
  turnCounter: number;
  passCounter: number;
}

export interface ActiveCombat {
  id: number;
  turn_counter: number;
  scenes: string;
}

export function useInitiative(
  socketRef: React.MutableRefObject<any>,
  sceneKey: string | null,
) {
  const [state, setState] = useState<InitiativeState | null>(null);
  const [activeCombats, setActiveCombats] = useState<ActiveCombat[]>([]);
  const currentSceneKey = useRef(sceneKey);
  currentSceneKey.current = sceneKey;

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onState = (data: InitiativeState) => {
      if (data.sceneKey === currentSceneKey.current) setState(data);
    };

    const onStarted = (data: { sceneKey: string; combatId: number }) => {
      if (data.sceneKey === currentSceneKey.current && !state) {
        setState({ sceneKey: data.sceneKey, combatId: data.combatId, combatants: [], turnIndex: 0, turnCounter: 1, passCounter: 1 });
      }
    };

    const onEnded = (data: { sceneKey: string }) => {
      if (data.sceneKey === currentSceneKey.current) setState(null);
    };

    const onCombats = (rows: ActiveCombat[]) => setActiveCombats(rows);

    s.on('initiative:state', onState);
    s.on('initiative:started', onStarted);
    s.on('initiative:ended', onEnded);
    s.on('initiative:combats', onCombats);

    // Rejoin on reconnect / scene change
    if (sceneKey) s.emit('initiative:join', { sceneKey });

    return () => {
      s.off('initiative:state', onState);
      s.off('initiative:started', onStarted);
      s.off('initiative:ended', onEnded);
      s.off('initiative:combats', onCombats);
    };
  }, [socketRef, sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const listCombats = useCallback(() => {
    socketRef.current?.emit('initiative:list_combats');
  }, [socketRef]);

  const startInitiative = useCallback((combatId?: number) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:start', { sceneKey, combatId: combatId ?? null });
  }, [socketRef, sceneKey]);

  const submitRoll = useCallback((combatant: Omit<Combatant, 'insertOrder'>) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:roll', { sceneKey, combatant });
  }, [socketRef, sceneKey]);

  const nextTurn = useCallback(() => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:next', { sceneKey });
  }, [socketRef, sceneKey]);

  const removeCombatant = useCallback((combatantId: string) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:remove', { sceneKey, combatantId });
  }, [socketRef, sceneKey]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:reorder', { sceneKey, fromIndex, toIndex });
  }, [socketRef, sceneKey]);

  const endInitiative = useCallback(() => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:end', { sceneKey });
  }, [socketRef, sceneKey]);

  return {
    state,
    activeCombats,
    listCombats,
    startInitiative,
    submitRoll,
    nextTurn,
    removeCombatant,
    reorder,
    endInitiative,
  };
}
