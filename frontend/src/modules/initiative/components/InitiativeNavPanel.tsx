import React from 'react';
import type { ActiveCombat } from '../hooks/useInitiative';
import { useWords } from '../../../sheets/words';
import { getInitiativeSystem } from '../systems';

interface Props {
  initiativeActive: boolean;
  activeCombats: ActiveCombat[];
  locations: any[];
  onRollEnemies?: () => void;
  onRollFriendlies?: () => void;
  onToggleTracker?: () => void;
  onJumpToScene?: (sceneKey: string) => void;
  onEndCombat?: (combatId: number) => void;
  onClose: () => void;
  /** The running game system, for a custom system's own words for initiative and the turn. */
  system?: string;
}

export function sceneLabel(sceneKey: string, locations: any[]): string {
  if (sceneKey === 'city:0') return 'CITY MAP';
  if (sceneKey.startsWith('building:')) {
    const locId = sceneKey.split(':')[1];
    const loc = locations.find((l: any) => String(l.id) === locId);
    return loc ? (loc.name || 'UNKNOWN').toUpperCase() : `BUILDING ${locId}`;
  }
  const [bmId, floorIdx] = sceneKey.split(':');
  const loc = locations.find((l: any) => String(l.id) === bmId);
  const floorNum = Number(floorIdx);
  const floorLabel = `LEVEL ${floorNum}`;
  return loc ? `${(loc.name || 'UNKNOWN').toUpperCase()} — ${floorLabel}` : `MAP ${bmId} — ${floorLabel}`;
}

export function InitiativeNavPanel({
  initiativeActive, activeCombats, locations,
  onRollEnemies, onRollFriendlies, onToggleTracker, onJumpToScene, onEndCombat, onClose, system,
}: Props) {
  const word = useWords(system);
  // Each scene's own count beside it (8a8), named as its tracker names it.
  const COUNTER = word('round', 'singular', getInitiativeSystem(system ?? 'generic').counterLabel).toUpperCase();
  const INITIATIVE = word('initiative', 'singular', 'INITIATIVE').toUpperCase();
  return (
    <div className="panel sidebar-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>{INITIATIVE}</h3>
        <button onClick={onClose} className="close-btn" style={{ position: 'static' }}>◀</button>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="utility-btn" style={{ flex: 1 }} onClick={onRollEnemies} disabled={!initiativeActive}>
            ROLL ENEMIES
          </button>
          <button className="utility-btn" style={{ flex: 1 }} onClick={onRollFriendlies} disabled={!initiativeActive}>
            ROLL FRIENDLIES
          </button>
        </div>
        <button className="upload-btn" style={{ width: '100%' }} onClick={onToggleTracker}>
          OPEN TRACKER
        </button>
        <div style={{ marginTop: '6px' }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', letterSpacing: '1px', marginBottom: '4px' }}>ACTIVE COMBATS</div>
          {activeCombats.length === 0 ? (
            <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', opacity: 0.5, padding: '6px 0', lineHeight: '1.5' }}>
              NO ACTIVE COMBATS. OPEN THE TRACKER AND CLICK START {INITIATIVE} TO BEGIN. EACH ACTIVE SCENE WILL APPEAR HERE FOR QUICK NAVIGATION.
            </div>
          ) : activeCombats.map((combat) => (
            <div key={combat.id} style={{ marginBottom: '8px', borderLeft: '2px solid var(--dark-green)', paddingLeft: '8px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '0.6rem', color: 'var(--dark-green)', marginBottom: '3px',
              }}>
                <span style={{ flex: 1 }}>COMBAT #{combat.id}</span>
                {onEndCombat && (
                  <button
                    className="utility-btn"
                    title={`End combat #${combat.id}`}
                    aria-label={`End combat ${combat.id}`}
                    style={{
                      padding: '1px 6px', fontSize: '0.55rem', lineHeight: 1.6,
                      background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)',
                    }}
                    onClick={() => onEndCombat(combat.id)}
                  >
                    END
                  </button>
                )}
              </div>
              {combat.scene_keys.map((sk) => (
                <button
                  key={sk}
                  className="utility-btn"
                  style={{ width: '100%', textAlign: 'left', marginBottom: '3px', fontSize: '0.65rem' }}
                  onClick={() => onJumpToScene?.(sk)}
                >
                  ▶ {combat.scene_labels?.[sk] || sceneLabel(sk, locations)}
                  {combat.scene_counters?.[sk] !== undefined ? ` · ${COUNTER} ${combat.scene_counters[sk]}` : ''}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
