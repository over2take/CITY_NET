import { useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import type { DirectorState, StreamerCameraMode, StreamerVisibility } from '../types';

const CAMERA_MODES: { key: StreamerCameraMode; label: string; hint: string }[] = [
  { key: 'director', label: 'DIRECTOR', hint: 'Camera glides to broadcast targets and holds' },
  { key: 'mirror', label: 'MIRROR', hint: 'Camera follows your view (smoothed)' },
  { key: 'locked', label: 'LOCKED', hint: 'Camera frozen — roam freely unseen' },
];

const VISIBILITY_FLAGS: { key: keyof StreamerVisibility; label: string }[] = [
  { key: 'showHealthBars', label: 'HEALTH_BARS' },
  { key: 'showPlayerNames', label: 'NAME_TAGS' },
  { key: 'showRoads', label: 'ROADS' },
];

export function StreamerDirectorPanel({ pos, setPos, onClose, directorState, updateDirector, spectatorCount }: {
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  directorState: DirectorState;
  updateDirector: (partial: Partial<DirectorState>) => void;
  spectatorCount: number;
}) {
  const [titleInput, setTitleInput] = useState(directorState.sceneTitle);
  const streamerUrl = `${window.location.origin}/?streamer=true`;
  const isLive = spectatorCount > 0;

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' };
  const sectionLabel: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '2px', color: 'var(--green)', opacity: 0.7, marginBottom: '4px' };

  return (
    <DraggableWindow
      title="BROADCAST_CONTROLS"
      pos={pos} setPos={setPos} onClose={onClose}
      windowStyle={{ width: '300px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '10px', textAlign: 'left' }}>

        <div style={{ ...row, justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: isLive ? '#ff3333' : '#666', textShadow: isLive ? '0 0 8px #ff0000' : 'none', letterSpacing: '2px' }}>
            {isLive ? `● LIVE — ${spectatorCount} FEED${spectatorCount > 1 ? 'S' : ''}` : '○ NO_FEEDS'}
          </span>
          <button className="utility-btn" style={{ margin: 0 }} onClick={() => window.open(streamerUrl, 'citynet_streamer', 'width=1280,height=720')}>
            OPEN_FEED
          </button>
        </div>
        <div style={{ fontSize: '0.55rem', color: '#888', wordBreak: 'break-all' }}>
          OBS_BROWSER_SOURCE: {streamerUrl}
        </div>

        <div>
          <div style={sectionLabel}>CAMERA_MODE</div>
          <div style={{ display: 'flex', gap: '5px' }}>
            {CAMERA_MODES.map(m => (
              <button
                key={m.key}
                className="utility-btn"
                title={m.hint}
                style={{ margin: 0, flex: 1, background: directorState.cameraMode === m.key ? 'var(--green)' : undefined, color: directorState.cameraMode === m.key ? '#000' : undefined }}
                onClick={() => updateDirector({ cameraMode: m.key })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={sectionLabel}>DIRECTOR_TARGET</div>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.65rem', color: directorState.target ? 'var(--green)' : '#666' }}>
              {directorState.target ? `LOCKED [${directorState.target.lookAt.map(n => Math.round(n)).join(', ')}]` : 'NONE — use BROADCAST_THIS on any object'}
            </span>
            {directorState.target && (
              <button className="utility-btn danger-btn" style={{ margin: 0 }} onClick={() => updateDirector({ target: null })}>RELEASE</button>
            )}
          </div>
        </div>

        <div>
          <div style={sectionLabel}>SCENE_TITLE</div>
          <div style={row}>
            <input
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              placeholder="e.g. ZONE_4 // THE_HEIST"
              style={{ flex: 1, minWidth: 0 }}
              onKeyDown={e => { if (e.key === 'Enter') updateDirector({ sceneTitle: titleInput }); }}
            />
            <button className="utility-btn" style={{ margin: 0 }} onClick={() => updateDirector({ sceneTitle: titleInput })}>SET</button>
            {directorState.sceneTitle && (
              <button className="utility-btn" style={{ margin: 0 }} onClick={() => { setTitleInput(''); updateDirector({ sceneTitle: '' }); }}>X</button>
            )}
          </div>
        </div>

        <div>
          <div style={sectionLabel}>AUDIENCE_LAYERS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {VISIBILITY_FLAGS.map(f => (
              <button
                key={f.key}
                className="utility-btn"
                style={{ margin: 0, textAlign: 'left' }}
                onClick={() => updateDirector({ visibility: { ...directorState.visibility, [f.key]: !directorState.visibility[f.key] } })}
              >
                [{directorState.visibility[f.key] ? '✓' : ' '}] {f.label}
              </button>
            ))}
            <button
              className="utility-btn"
              style={{ margin: 0, textAlign: 'left' }}
              onClick={() => updateDirector({ letterbox: !directorState.letterbox })}
            >
              [{directorState.letterbox ? '✓' : ' '}] LETTERBOX
            </button>
          </div>
        </div>

      </div>
    </DraggableWindow>
  );
}
