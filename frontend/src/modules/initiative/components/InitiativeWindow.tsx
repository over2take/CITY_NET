import React, { useRef, useState } from 'react';
import { DraggableWindow } from '../../../components/DraggableWindow';
import { InitiativeCombatantRow } from './InitiativeCombatantRow';
import { InitiativeSideView } from './InitiativeSideView';
import { InitiativeControls } from './InitiativeControls';
import { beginOffered, npcAsksOn, waitingLine, type TurnAsk } from '../../../sheets/turnAsks';
import type { InitiativeState, ActiveCombat } from '../hooks/useInitiative';
import { getInitiativeSystem } from '../systems';
import { useWords } from '../../../sheets/words';
import { useParts } from '../../../sheets/parts';

interface Props {
  state: InitiativeState | null;
  activeCombats: ActiveCombat[];
  sceneKey: string | null;
  sceneLabel: string;
  isAdmin: boolean;
  onClose: () => void;
  onStart: (combatId?: number, mode?: string) => void;
  onListCombats: () => void;
  onNext: () => void;
  onEnd: () => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number, sideId?: string) => void;
  /** Player combatant id (e.g. "player:username") — used to show JOIN button when not yet in list */
  playerCombatantId?: string;
  onJoin?: (score: number | null, system: string, extraDice?: number) => void;
  inSidebar?: boolean;
  /** When set (building mode), NPCs without a matching floorIndex are hidden */
  currentFloorIndex?: number;
  /** TTRPG system key — controls counter label and SR6-specific UI */
  system?: string;
  /** BEGIN ROUND 1 (8a9c), the GM's, where the game's conditions act on turns. */
  onBegin?: () => void;
  /** The GM's: EACH TURN rolls waiting (sheets/turnAsks.ts); an NPC's on its row, a player's said beside NEXT. */
  asks?: TurnAsk[];
  rolling?: number[];
  onRollAsk?: (id: number) => void;
  /** A roll the tracker asked for and was refused, in words. */
  askError?: string | null;
}

/**
 * The tracker; nothing while the running game has initiative turned off (3b6a). A combat left
 * from before stays stored, and shows again when initiative is turned back on.
 */
export function InitiativeWindow(props: Props) {
  return useParts(props.system)('initiative') ? <InitiativeTracker {...props} /> : null;
}

function InitiativeTracker({
  state, activeCombats, sceneKey, sceneLabel, isAdmin,
  onClose, onStart, onListCombats, onNext, onEnd, onRemove, onReorder,
  playerCombatantId, onJoin,
  inSidebar = false,
  currentFloorIndex,
  system = 'generic',
  onBegin = () => {},
  asks = [],
  rolling = [],
  onRollAsk,
  askError = null,
}: Props) {
  const activeSystem = state?.system || system;
  const activeMode = state?.mode || 'individual';
  // Opens just right of the side panel (rail 48 + panel 320), not on it: at x 80 it sat over the INITIATIVE menu's ACTIVE
  // COMBATS, so a GM jumping fight to fight had to shut it first (found by 8i2's journeys).
  const [pos, setPos] = useState({ x: 384, y: 120 });
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

  const headerLabel = 'INITIATIVE.EXE';
  const systemDef = getInitiativeSystem(activeSystem);
  // A custom system's own words for initiative and the turn; today's text otherwise, so the
  // built-in systems keep their ROUND and PASS.
  const word = useWords(activeSystem);
  const INITIATIVE = word('initiative', 'singular', 'INITIATIVE').toUpperCase();
  const INIT = word('initiative', 'short', 'INIT').toUpperCase();
  const ROUND = word('round', 'singular', systemDef.counterLabel).toUpperCase();
  const count = state ? (activeSystem === 'shadowrun_6e' ? state.passCounter : state.turnCounter) : 1;
  // BEGIN ROUND 1 until the round has begun, where it does anything (8a9c); the GM's alone.
  const begin = isAdmin && beginOffered(state);
  /** The GM's buttons under the order, in either style. */
  const controls = (disabled: boolean, nextLabel: string) => (
    <InitiativeControls
      begin={begin}
      beginLabel={`BEGIN ${ROUND} ${count}`}
      nextLabel={nextLabel}
      disabled={disabled}
      endLabel={`END ${INIT}`}
      onNext={onNext}
      onBegin={onBegin}
      onEnd={onEnd}
      waiting={waitingLine(asks, sceneKey)}
      error={askError}
    />
  );
  /** This NPC's rolls waiting on the GM, on its row. */
  const rowAsks = (id: string) => (isAdmin ? npcAsksOn(asks, id, sceneKey) : []);

  const content = (
    <>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--green)', opacity: 0.65, letterSpacing: '1px' }}>{sceneLabel}</div>
        {state && activeMode === 'individual' && (
          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '2px', color: 'var(--green)', textShadow: 'var(--glow)', marginTop: '2px' }}>
            {/* The count of laps of the order: a ROUND (8a8, the user's call: "this pr"), the system's own word for one. */}
            {`${ROUND} ${count}${begin ? ' · NOT BEGUN' : ''}`}
          </div>
        )}
      </div>

      {/* ── No active initiative ───────────────────────────────────────── */}
      {!state && isAdmin && (
        <div>
          {!showJoin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button className="upload-btn" style={{ width: '100%' }} onClick={() => onStart()}>
                START {INITIATIVE}
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
              <div style={{ fontSize: '0.65rem', marginBottom: '6px', color: 'var(--green)', opacity: 0.65 }}>SELECT COMBAT TO JOIN</div>
              {activeCombats.map((c) => (
                <button
                  key={c.id}
                  className="utility-btn"
                  style={{ width: '100%', marginBottom: 4, textAlign: 'left' }}
                  onClick={() => { onStart(c.id); setShowJoin(false); }}
                >
                  COMBAT #{c.id}
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
        <div style={{ fontSize: '0.7rem', color: 'var(--green)', opacity: 0.65, padding: '8px 0' }}>
          NO ACTIVE {INITIATIVE} IN THIS SCENE
        </div>
      )}

      {/* ── Side-based mode ────────────────────────────────────────────── */}
      {state && activeMode === 'side' && (
        <InitiativeSideView
          state={state}
          isAdmin={isAdmin}
          onRemove={onRemove}
          onReorder={onReorder}
          currentFloorIndex={currentFloorIndex}
          playerCombatantId={playerCombatantId}
          onJoin={onJoin}
          counter={`${ROUND} ${state.turnCounter}${begin ? ' · NOT BEGUN' : ''}`}
          controls={controls}
          rowAsks={rowAsks}
          rolling={rolling}
          onRollAsk={isAdmin ? onRollAsk : undefined}
        />
      )}

      {/* ── Individual mode ────────────────────────────────────────────── */}
      {state && activeMode === 'individual' && (
        <>
          {/* SR6: new round banner */}
          {state.newRound && (
            <div style={{ marginBottom: '8px', padding: '4px 8px', border: '1px solid var(--warning)', color: 'var(--warning)', fontSize: '0.65rem', letterSpacing: '1px', textAlign: 'center' }}>
              NEW ROUND — REROLL INITIATIVE
            </div>
          )}

          {(() => {
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
                  <div style={{ fontSize: '0.65rem', color: 'var(--green)', opacity: 0.65, padding: '6px 0' }}>
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
                        asks={rowAsks(c.id)}
                        rolling={rolling}
                        onRollAsk={isAdmin ? onRollAsk : undefined}
                      />
                    </div>
                  ))
                )}
              </div>
            );
          })()}

          {/* Admin controls */}
          {isAdmin && controls(state.combatants.length === 0 && !state.newRound, state.newRound ? 'CLEAR' : 'NEXT')}

          {/* Player late-join button */}
          {!isAdmin && onJoin && playerCombatantId && !state.combatants.some(c => c.id === playerCombatantId) && (
            <div style={{ marginTop: '8px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
              {activeSystem === 'shadowrun_6e' && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--green)', opacity: 0.65, letterSpacing: '1px', marginBottom: '4px' }}>EXTRA DICE (WIRED REFLEXES)</div>
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
                JOIN {INITIATIVE}
              </button>
              <div style={{ fontSize: '0.6rem', color: 'var(--green)', opacity: 0.65, textAlign: 'center', marginTop: '4px' }}>
                {activeSystem === 'shadowrun_6e'
                  ? `ROLL REA + INT + ${1 + (extraDice ?? 0)}d6 — ADDED TO BOTTOM`
                  : activeSystem === 'cyberpunk_red'
                  ? 'ROLL REF + 1d10 — ADDED TO BOTTOM'
                  : activeSystem === 'cities_without_number'
                  ? 'ROLL DEX MOD + 1d8 — ADDED TO BOTTOM'
                  : 'ROLL 1d20 — ADDED TO BOTTOM'}
              </div>
            </div>
          )}
        </>
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
