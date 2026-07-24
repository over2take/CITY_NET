import React from 'react';
import type { ActiveCombat } from '../hooks/useInitiative';

interface Props {
  initiativeActive: boolean;
  activeCombats: ActiveCombat[];
  locations: any[];
  onRollEnemies?: () => void;
  onRollFriendlies?: () => void;
  onToggleTracker?: () => void;
  onJumpToScene?: (sceneKey: string) => void;
  onClose: () => void;
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
  onRollEnemies, onRollFriendlies, onToggleTracker, onJumpToScene, onClose,
}: Props) {
  return (
    <div className="panel sidebar-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>INITIATIVE</h3>
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
              NO ACTIVE COMBATS. OPEN THE TRACKER AND CLICK START INITIATIVE TO BEGIN. EACH ACTIVE SCENE WILL APPEAR HERE FOR QUICK NAVIGATION.
            </div>
          ) : activeCombats.map((combat) => (
            <div key={combat.id} style={{ marginBottom: '8px', borderLeft: '2px solid var(--dark-green)', paddingLeft: '8px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', marginBottom: '3px' }}>
                COMBAT #{combat.id} — TURN {combat.turn_counter}
              </div>
              {combat.scene_keys.map((sk) => (
                <button
                  key={sk}
                  className="utility-btn"
                  style={{ width: '100%', textAlign: 'left', marginBottom: '3px', fontSize: '0.65rem' }}
                  onClick={() => onJumpToScene?.(sk)}
                >
                  ▶ {combat.scene_labels?.[sk] || sceneLabel(sk, locations)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
