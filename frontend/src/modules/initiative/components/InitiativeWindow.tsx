import React, { useRef, useState } from 'react';
import { DraggableWindow } from '../../../components/DraggableWindow';
import { InitiativeCombatantRow } from './InitiativeCombatantRow';
import type { InitiativeState, ActiveCombat } from '../hooks/useInitiative';
import { getInitiativeSystem } from '../systems';

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
  /** Player combatant id (e.g. "player:username") — used to show JOIN button when not yet in list */
  playerCombatantId?: string;
  onJoin?: (score: number | null, system: string, extraDice?: number) => void;
  inSidebar?: boolean;
  /** When set (building mode), NPCs without a matching floorIndex are hidden */
  currentFloorIndex?: number;
  /** TTRPG system key — controls counter label and SR6-specific UI */
  system?: string;
}

export function InitiativeWindow({
  state, activeCombats, sceneKey, sceneLabel, isAdmin,
  onClose, onStart, onListCombats, onNext, onEnd, onRemove, onReorder,
  playerCombatantId, onJoin,
  inSidebar = false,
  currentFloorIndex,
  system = 'generic',
}: Props) {
  // Prefer the system recorded on the active combat (ground truth) over the prop
  const activeSystem = state?.system || system;
  const [pos, setPos] = useState({ x: 80, y: 120 });
  const [showJoin, setShowJoin] = useState(false);
  const [extraDice, setExtraDice] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  const handleDragStart = (index: number) => { dragFrom.current = index; };
  const handleDragOver = (index: number) => { setDragOverIndex(index); };
  const handleDrop = (toIndex: number) => {
    if (dragFrom.current !== null && dragFrom.current !== toIndex) {
      onReorder(dragFrom.current, toIndex);
    }
    dragFrom.current = null;
    setDragOverIndex(null);
  };

  const headerLabel = 'Initiative.exe';

  const content = (
    <>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', letterSpacing: '1px' }}>{sceneLabel}</div>
        {state && (
          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '2px', color: 'var(--green)', textShadow: 'var(--glow)', marginTop: '2px' }}>
            {`${getInitiativeSystem(activeSystem).counterLabel} ${activeSystem === 'shadowrun_6e' ? state.passCounter : state.turnCounter}`}
          </div>
        )}
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
                  {c.scene_keys?.length ? ` [${c.scene_keys.length} SCENE${c.scene_keys.length > 1 ? 'S' : ''}]` : ''}
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

      {/* ── SR6: new round banner ─────────────────────────────────────── */}
      {state?.newRound && (
        <div style={{ marginBottom: '8px', padding: '4px 8px', border: '1px solid #ffcc00', color: '#ffcc00', fontSize: '0.65rem', letterSpacing: '1px', textAlign: 'center' }}>
          NEW ROUND — REROLL INITIATIVE
        </div>
      )}

      {/* ── Active initiative ──────────────────────────────────────────── */}
      {state && (() => {
        const visibleCombatants = currentFloorIndex !== undefined
          ? state.combatants.filter(c => !c.isNpc || c.floorIndex === undefined || c.floorIndex === currentFloorIndex)
          : state.combatants;
        const activeCombatantId = state.combatants[state.turnIndex]?.id;
        const indexById = new Map(state.combatants.map((c, i) => [c.id, i]));
        return (
          <div
            style={{ marginBottom: '8px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '4px' }}
            onDragLeave={() => setDragOverIndex(null)}
          >
            {visibleCombatants.length === 0 ? (
              <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', padding: '6px 0' }}>
                WAITING FOR ROLLS...
              </div>
            ) : (
              visibleCombatants.map((c, i) => (
                <div key={c.id}>
                  {dragOverIndex === i && dragFrom.current !== null && dragFrom.current !== i && (
                    <div style={{ height: 2, background: 'var(--green)', boxShadow: 'var(--glow)', margin: '1px 0' }} />
                  )}
                  <InitiativeCombatantRow
                    combatant={c}
                    index={indexById.get(c.id) ?? i}
                    isActive={c.id === activeCombatantId}
                    isAdmin={isAdmin}
                    onRemove={onRemove}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(i)}
                  />
                </div>
              ))
            )}
          </div>
        );
      })()}

      {/* ── Admin controls ─────────────────────────────────────────────── */}
      {isAdmin && state && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className="upload-btn"
            style={{ flex: 1, width: 'auto' }}
            onClick={onNext}
            disabled={state.combatants.length === 0 && !state.newRound}
          >
            {state.newRound ? 'CLEAR' : 'NEXT'}
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

      {/* ── Player late-join button ────────────────────────────────────── */}
      {!isAdmin && state && onJoin && playerCombatantId && !state.combatants.some(c => c.id === playerCombatantId) && (
        <div style={{ marginTop: '8px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
          {activeSystem === 'shadowrun_6e' && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', letterSpacing: '1px', marginBottom: '4px' }}>EXTRA DICE (WIRED REFLEXES)</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className="utility-btn"
                    style={{
                      flex: 1,
                      background: extraDice === n ? 'var(--green)' : 'transparent',
                      color: extraDice === n ? 'var(--black)' : 'var(--dark-green)',
                      borderColor: extraDice === n ? 'var(--green)' : undefined,
                      fontWeight: extraDice === n ? 'bold' : undefined,
                    }}
                    onClick={() => setExtraDice(extraDice === n ? null : n)}
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            className="upload-btn"
            style={{ width: '100%' }}
            onClick={() => onJoin(null, activeSystem, extraDice ?? 0)}
          >
            JOIN INITIATIVE
          </button>
          <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', textAlign: 'center', marginTop: '4px' }}>
            {activeSystem === 'shadowrun_6e'
              ? `ROLL REA + INT + ${1 + (extraDice ?? 0)}d6 — ADDED TO BOTTOM`
              : activeSystem === 'cyberpunk_red'
              ? 'ROLL REF/2 + 1d10 — ADDED TO BOTTOM'
              : 'ROLL 1d20 — ADDED TO BOTTOM'}
          </div>
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
      windowStyle={{ width: isAdmin ? 360 : 240, minWidth: isAdmin ? 300 : 200, minHeight: 120 }}
      contentStyle={{ maxHeight: 'none', overflowY: 'visible' }}
    >
      {content}
    </DraggableWindow>
  );
}
