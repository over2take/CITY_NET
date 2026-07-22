import React, { useState } from 'react';
import { DraggableWindow } from '../../../components/DraggableWindow';

interface Props {
  sceneLabel: string;
  userName: string;
  userId: string;
  portraitUrl?: string;
  onRoll: (score: number) => void;
  onClose: () => void;
}

function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function InitiativeRollPrompt({ sceneLabel, userName, userId, portraitUrl, onRoll, onClose }: Props) {
  const [pos, setPos] = useState({ x: Math.max(0, window.innerWidth / 2 - 150), y: Math.max(0, window.innerHeight / 2 - 120) });
  const [rolled, setRolled] = useState<number | null>(null);

  const handleRoll = () => {
    const score = rollD20();
    setRolled(score);
    onRoll(score);
  };

  return (
    <DraggableWindow
      title="INITIATIVE_ROLL"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: 280 }}
    >
      <div style={{ padding: '8px 4px', textAlign: 'center' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--dark-green)', letterSpacing: '1px', marginBottom: '10px' }}>
          {sceneLabel}
        </div>

        {portraitUrl && (
          <img src={portraitUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 2, marginBottom: 8, border: '1px solid var(--dark-green)' }} />
        )}

        <div style={{ fontSize: '0.7rem', marginBottom: '14px', color: 'var(--green)' }}>
          {userName.toUpperCase()}
        </div>

        {rolled !== null ? (
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--green)', marginBottom: '6px' }}>
              {rolled}
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)' }}>ADDED TO TRACKER</div>
          </div>
        ) : (
          <button
            className="upload-btn"
            style={{ width: '100%', padding: '10px', fontSize: '0.85rem', letterSpacing: '2px' }}
            onClick={handleRoll}
          >
            ROLL
          </button>
        )}

        <div style={{ fontSize: '0.6rem', color: 'var(--dark-green)', marginTop: 10 }}>
          1d20 GENERIC INITIATIVE
        </div>
      </div>
    </DraggableWindow>
  );
}
