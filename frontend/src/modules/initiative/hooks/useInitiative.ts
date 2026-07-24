import { useState, useEffect, useCallback, useRef, useReducer } from 'react';

export interface Combatant {
  id: string;
  name: string;
  portraitUrl?: string;
  score: number;
  breakdown?: string;
  diceResults?: Record<string, number[]>;
  exploded?: boolean;
  isNpc: boolean;
  isFriendly?: boolean;
  insertOrder?: number;
  floorIndex?: number;
  /** Side mode: which side this combatant belongs to ('pc' | 'npc') */
  sideId?: string;
}

export interface Side {
  id: string;
  name: string;
  score: number;
  isPlayerSide: boolean;
}

export interface InitiativeState {
  sceneKey: string;
  combatId: number;
  combatants: Combatant[];
  sides: Side[];
  turnIndex: number;
  turnCounter: number;
  passCounter: number;
  system: string;
  mode: 'individual' | 'side';
  /** SR6: true when end-of-pass decay eliminated everyone — everyone must reroll */
  newRound?: boolean;
}

export interface ActiveCombat {
  id: number;
  turn_counter: number;
  scene_keys: string[];
  scene_labels: Record<string, string>;
}

export function useInitiative(
  socketRef: React.MutableRefObject<any>,
  sceneKey: string | null,
  system = 'generic',
) {
  const [state, setState] = useState<InitiativeState | null>(null);
  const [activeCombats, setActiveCombats] = useState<ActiveCombat[]>([]);
  const currentSceneKey = useRef(sceneKey);
  currentSceneKey.current = sceneKey;
  const [socketReadyCount, forceReady] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!socketRef.current) {
      const interval = setInterval(() => {
        if (socketRef.current) {
          clearInterval(interval);
          forceReady();
        }
      }, 200);
      return () => clearInterval(interval);
    }

    const s = socketRef.current;

    setState(null);

    const onState = (data: InitiativeState) => {
      if (data.sceneKey === currentSceneKey.current) {
        setState(data);
        s.emit('initiative:list_combats');
      }
    };

    const onStarted = (data: { sceneKey: string }) => {
      if (data.sceneKey !== currentSceneKey.current) return;
    };

    const onEnded = (data: { sceneKey: string }) => {
      if (data.sceneKey === currentSceneKey.current) setState(null);
      s.emit('initiative:list_combats');
    };

    const onCombats = (rows: ActiveCombat[]) => setActiveCombats(rows);
    const onReconnect = () => { if (sceneKey) s.emit('initiative:join', { sceneKey }); };

    s.on('initiative:state', onState);
    s.on('initiative:started', onStarted);
    s.on('initiative:ended', onEnded);
    s.on('initiative:combats', onCombats);
    s.on('connect', onReconnect);

    if (sceneKey) s.emit('initiative:join', { sceneKey });

    return () => {
      s.off('initiative:state', onState);
      s.off('initiative:started', onStarted);
      s.off('initiative:ended', onEnded);
      s.off('initiative:combats', onCombats);
      s.off('connect', onReconnect);
    };
  }, [socketRef, sceneKey, socketReadyCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const listCombats = useCallback(() => {
    socketRef.current?.emit('initiative:list_combats');
  }, [socketRef]);

  const startInitiative = useCallback((combatId?: number, mode?: string) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:start', { sceneKey, combatId: combatId ?? null, system, mode });
  }, [socketRef, sceneKey, system]);

  const submitRoll = useCallback((combatant: Omit<Combatant, 'insertOrder'>) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:roll', { sceneKey, combatant });
  }, [socketRef, sceneKey]);

  const submitJoin = useCallback((combatant: Omit<Combatant, 'insertOrder'>) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:roll', { sceneKey, combatant, appendToEnd: true });
  }, [socketRef, sceneKey]);

  const rollNpcSide = useCallback((score: number, breakdown?: string, diceResults?: Record<string, number[]>) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:roll_side', { sceneKey, score, breakdown, diceResults });
  }, [socketRef, sceneKey]);

  const nextTurn = useCallback(() => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:next', { sceneKey });
  }, [socketRef, sceneKey]);

  const removeCombatant = useCallback((combatantId: string) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:remove', { sceneKey, combatantId });
  }, [socketRef, sceneKey]);

  const reorder = useCallback((fromIndex: number, toIndex: number, sideId?: string) => {
    if (!sceneKey) return;
    socketRef.current?.emit('initiative:reorder', { sceneKey, fromIndex, toIndex, sideId });
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
    submitJoin,
    rollNpcSide,
    nextTurn,
    removeCombatant,
    reorder,
    endInitiative,
  };
}
