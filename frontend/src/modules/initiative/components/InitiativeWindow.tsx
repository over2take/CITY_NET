import React, { useRef, useState } from 'react';
import { DraggableWindow } from '../../../components/DraggableWindow';
import { InitiativeCombatantRow } from './InitiativeCombatantRow';
import type { InitiativeState, ActiveCombat } from '../hooks/useInitiative';

interface Props {
  state: InitiativeState | null;
  activeCombats: ActiveCombat[];
  sceneKey: string | null;
  sceneLabel: string;
  isAdmin: boolean;
  onClose: () => void;
  onStart: (combatId?: number) => void;
  onListCombats: () => void;
  onNext: () => void;
  onEnd: () => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  inSidebar?: boolean;
}

export function InitiativeWindow({
  state, activeCombats, sceneKey, sceneLabel, isAdmin,
  onClose, onStart, onListCombats, onNext, onEnd, onRemove, onReorder,
  inSidebar = false,
}: Props) {
  const [pos, setPos] = useState({ x: 80, y: 120 });
  const [showJoin, setShowJoin] = useState(false);
  const dragFrom = useRef<number | null>(null);

  const handleDragStart = (index: number) => { dragFrom.current = index; };
  const handleDragOver = (_index: number) => {};
  const handleDrop = (toIndex: number) => {
    if (dragFrom.current !== null && dragFrom.current !== toIndex) {
      onReorder(dragFrom.current, toIndex);
    }
    dragFrom.current = null;
  };

  const headerLabel = state ? `TURN ${state.turnCounter}` : 'INITIATIVE';

  const content = (
    <>
      <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', letterSpacing: '1px', marginBottom: '8px' }}>
        {sceneLabel}
      </div>

      {/* ── No active initiative ───────────────────────────────────────── */}
      {!state && isAdmin && (
        <div>
          {!showJoin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button className="upload-btn" style={{ width: '100%' }} onClick={() => onStart()}>
                START INITIATIVE
              </button>
              {activeCombats.length > 0 && (
                <button
                  className="utility-btn"
                  style={{ width: '100%' }}
                  onClick={() => { onListCombats(); setShowJoin(true); }}
                >
                  JOIN EXISTING COMBAT
                </button>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '0.65rem', marginBottom: '6px', color: 'var(--dark-green)' }}>SELECT COMBAT TO JOIN</div>
              {activeCombats.map((c) => (
                <button
                  key={c.id}
                  className="utility-btn"
                  style={{ width: '100%', marginBottom: 4, textAlign: 'left' }}
                  onClick={() => { onStart(c.id); setShowJoin(false); }}
                >
                  COMBAT #{c.id} — TURN {c.turn_counter}
                  {c.scenes ? ` [${c.scenes}]` : ''}
                </button>
              ))}
              <button className="utility-btn" style={{ width: '100%', marginTop: 4 }} onClick={() => setShowJoin(false)}>
                CANCEL
              </button>
            </div>
          )}
        </div>
      )}

      {!state && !isAdmin && (
        <div style={{ fontSize: '0.7rem', color: 'var(--dark-green)', padding: '8px 0' }}>
          NO ACTIVE INITIATIVE IN THIS SCENE
        </div>
      )}

      {/* ── Active initiative ──────────────────────────────────────────── */}
      {state && (
        <div>
          <div style={{ marginBottom: '8px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '4px' }}>
            {state.combatants.length === 0 ? (
              <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', padding: '6px 0' }}>
                WAITING FOR ROLLS...
              </div>
            ) : (
              state.combatants.map((c, i) => (
                <InitiativeCombatantRow
                  key={c.id}
                  combatant={c}
                  index={i}
                  isActive={i === state.turnIndex}
                  isAdmin={isAdmin}
                  onRemove={onRemove}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(i)}
                />
              ))
            )}
          </div>

          {isAdmin && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="upload-btn"
                style={{ flex: 1 }}
                onClick={onNext}
                disabled={state.combatants.length === 0}
              >
                NEXT
              </button>
              <button
                className="utility-btn"
                style={{ flex: 1, color: '#ff4444', borderColor: '#ff4444' }}
                onClick={onEnd}
              >
                END INIT
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (inSidebar) {
    return (
      <div className="panel sidebar-panel">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3 style={{ margin: 0 }}>{headerLabel}</h3>
          <button onClick={onClose} className="close-btn" style={{ position: 'static' }}>◀</button>
        </header>
        {content}
      </div>
    );
  }

  return (
    <DraggableWindow
      title={headerLabel}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: 300, minHeight: 120 }}
    >
      {content}
    </DraggableWindow>
  );
}
