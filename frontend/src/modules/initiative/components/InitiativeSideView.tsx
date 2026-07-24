import React, { useRef, useState } from 'react';
import { InitiativeCombatantRow } from './InitiativeCombatantRow';
import type { InitiativeState, Side } from '../hooks/useInitiative';
import { getInitiativeSystem } from '../systems';

interface Props {
  state: InitiativeState;
  isAdmin: boolean;
  onNext: () => void;
  onEnd: () => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number, sideId?: string) => void;
  currentFloorIndex?: number;
  playerCombatantId?: string;
  onJoin?: (score: number | null, system: string) => void;
}

export function InitiativeSideView({
  state, isAdmin, onNext, onEnd, onRemove, onReorder, currentFloorIndex,
  playerCombatantId, onJoin,
}: Props) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverSideId, setDragOverSideId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const dragSideId = useRef<string | null>(null);

  const sortedSides: Side[] = [...state.sides].sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return a.isPlayerSide ? -1 : 1;
  });

  const activeSide = sortedSides[state.turnIndex] ?? null;
  const sys = getInitiativeSystem(state.system);
  const playerAlreadyIn = playerCombatantId
    ? state.combatants.some((c) => c.id === playerCombatantId)
    : true;

  const handleDragStart = (sideId: string, index: number) => {
    dragFrom.current = index;
    dragSideId.current = sideId;
  };
  const handleDragOver = (sideId: string, index: number) => {
    if (dragSideId.current === sideId) {
      setDragOverIndex(index);
      setDragOverSideId(sideId);
    }
  };
  const handleDrop = (sideId: string, toIndex: number) => {
    if (dragFrom.current !== null && dragSideId.current === sideId && dragFrom.current !== toIndex) {
      onReorder(dragFrom.current, toIndex, sideId);
    }
    dragFrom.current = null;
    dragSideId.current = null;
    setDragOverIndex(null);
    setDragOverSideId(null);
  };

  return (
    <div>
      {/* Counter */}
      <div style={{ fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '2px', color: 'var(--green)', textShadow: 'var(--glow)', marginBottom: '8px' }}>
        {`${sys.counterLabel} ${state.turnCounter}`}
      </div>

      {/* Sides */}
      {sortedSides.length === 0 ? (
        <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', padding: '6px 0' }}>
          WAITING FOR ROLLS...
        </div>
      ) : (
        sortedSides.map((side) => {
          const isActiveSide = activeSide?.id === side.id;
          const members = state.combatants.filter((c) => {
            if (c.sideId !== side.id) return false;
            if (!side.isPlayerSide && currentFloorIndex !== undefined) {
              return c.floorIndex === undefined || c.floorIndex === currentFloorIndex;
            }
            return true;
          });

          return (
            <div
              key={side.id}
              style={{
                marginBottom: '10px',
                border: `1px solid ${isActiveSide ? 'var(--green)' : 'var(--dark-green)'}`,
                boxShadow: isActiveSide ? 'var(--glow)' : 'none',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              {/* Side header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 8px',
                background: isActiveSide ? 'var(--green)' : 'transparent',
                color: isActiveSide ? 'var(--black)' : 'var(--green)',
              }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '1px' }}>
                  {side.name}
                </span>
                <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>
                  {side.score > 0 ? `INIT ${side.score}` : 'NOT ROLLED'}
                </span>
              </div>

              {/* Members */}
              <div
                style={{ padding: '4px' }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverIndex(null);
                    setDragOverSideId(null);
                  }
                }}
              >
                {members.length === 0 ? (
                  <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', padding: '4px', textAlign: 'center' }}>
                    {side.isPlayerSide ? 'WAITING FOR PLAYER ROLLS...' : 'NO COMBATANTS'}
                  </div>
                ) : (
                  members.map((c, i) => (
                    <div key={c.id}>
                      {dragOverIndex === i && dragOverSideId === side.id && dragFrom.current !== null && dragFrom.current !== i && (
                        <div style={{ height: 2, background: 'var(--green)', boxShadow: 'var(--glow)', margin: '1px 0' }} />
                      )}
                      <InitiativeCombatantRow
                        combatant={c}
                        index={i}
                        isActive={isActiveSide}
                        isAdmin={isAdmin}
                        onRemove={onRemove}
                        onDragStart={(idx) => handleDragStart(side.id, idx)}
                        onDragOver={(idx) => handleDragOver(side.id, idx)}
                        onDrop={() => handleDrop(side.id, i)}
                      />
                    </div>
                  ))
                )}

              </div>
            </div>
          );
        })
      )}

      {/* Player join button */}
      {!isAdmin && onJoin && !playerAlreadyIn && (
        <div style={{ marginTop: '8px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
          <button
            className="upload-btn"
            style={{ width: '100%' }}
            onClick={() => onJoin(null, state.system)}
          >
            JOIN INITIATIVE
          </button>
          <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', textAlign: 'center', marginTop: '4px' }}>
            ROLL DEX MOD + 1d8 — ADDED TO PLAYERS SIDE
          </div>
        </div>
      )}

      {/* Admin controls */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <button
            className="upload-btn"
            style={{ flex: 1, width: 'auto' }}
            onClick={onNext}
            disabled={sortedSides.length === 0}
          >
            NEXT
          </button>
          <button
            className="upload-btn"
            style={{ flex: 1, width: 'auto', background: 'transparent', color: '#ff4444', borderColor: '#ff4444' }}
            onClick={onEnd}
          >
            END INIT
          </button>
        </div>
      )}
    </div>
  );
}
