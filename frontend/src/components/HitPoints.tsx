import React, { useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import type { Location } from '../types';

interface HitPointsMenuProps {
  targetRhombus: Location | null;
  token: string;
  refreshLocations: () => void;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
}

export function HitPointsMenu({ targetRhombus, token, refreshLocations, pos, setPos, onClose }: HitPointsMenuProps) {
  const [actionAmount, setActionAmount] = useState(0);
  const [tempAmount, setTempAmount] = useState(0);
  const [maxAmount, setMaxAmount] = useState(0);

  const updateHealth = async (action: string, amount: number) => {
    if (!targetRhombus) return;
    const bodyData: any = { action, amount };
    if (action === 'set_temp') bodyData.hp_temp = amount;
    if (action === 'set_max') bodyData.hp_max = amount;
    await fetch(`/api/locations/${targetRhombus.id}/health`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(bodyData),
    });
    refreshLocations();
  };

  if (!targetRhombus) return (
    <DraggableWindow title="HIT_POINTS" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
      <div style={{ textAlign: 'center', opacity: 0.7, padding: '20px' }}>NO_TARGET_ACQUIRED</div>
    </DraggableWindow>
  );

  return (
    <DraggableWindow title={`HP: ${targetRhombus.name || 'UNKNOWN'}`} pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', color: 'var(--green)', textShadow: 'var(--glow)', fontWeight: 'bold' }}>
            {targetRhombus.hp_current || 0} / {targetRhombus.hp_max || 0}
          </div>
          {(targetRhombus.hp_temp ?? 0) > 0 && (
            <div style={{ color: '#00ccff', fontSize: '0.9rem', marginTop: '5px' }}>+ {targetRhombus.hp_temp} TEMP</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <input type="number" placeholder="0" value={actionAmount || ''} onChange={e => setActionAmount(parseInt(e.target.value) || 0)} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="upload-btn" onClick={() => updateHealth('heal', actionAmount)} style={{ flex: 1 }}>HEAL</button>
            <button className="upload-btn danger-btn" onClick={() => updateHealth('damage', actionAmount)} style={{ flex: 1 }}>DAMAGE</button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {token !== '' && (
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>MAX_HP</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input type="number" placeholder="0" value={maxAmount || ''} onChange={e => setMaxAmount(parseInt(e.target.value) || 0)} style={{ flex: 1 }} />
                <button className="upload-btn" style={{ minWidth: 'auto', padding: '0 15px' }} onClick={() => updateHealth('set_max', maxAmount)}>SET</button>
              </div>
            </div>
          )}
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>TEMP_HP</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="number" placeholder="0" max="100"
                value={tempAmount || ''}
                onChange={e => { let val = parseInt(e.target.value) || 0; if (val > 100) val = 100; setTempAmount(val); }}
                style={{ flex: 1 }}
              />
              <button className="upload-btn" style={{ minWidth: 'auto', padding: '0 15px' }} onClick={() => updateHealth('set_temp', tempAmount)}>SET</button>
            </div>
          </div>
        </div>
      </div>
    </DraggableWindow>
  );
}
