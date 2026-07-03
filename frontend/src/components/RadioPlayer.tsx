import React, { useEffect, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';

export interface MusicStateType {
  playing: boolean;
  trackId: number | null;
  src: string | null;
  name: string | null;
  position: number;
  shuffle: boolean;
  loop: boolean;
}

interface RadioPlayerProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  isAdmin: boolean;
  socket: any;
  audioRef: React.RefObject<HTMLAudioElement>;
  musicState: MusicStateType;
  volume: number;
  onVolumeChange: (v: number) => void;
}

function fmt(secs: number) {
  const s = Math.floor(secs);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function RadioPlayer({
  pos, setPos, onClose, isAdmin, socket, audioRef, musicState, volume, onVolumeChange,
}: RadioPlayerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubbing = useRef(false);

  // Sync currentTime display from the audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { if (!scrubbing.current) setCurrentTime(audio.currentTime); };
    const onDur = () => setDuration(audio.duration || 0);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDur);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDur);
    };
  }, [audioRef]);

  const emitIfAdmin = (event: string, payload: object = {}) => {
    if (!isAdmin || !socket) return;
    socket.emit(event, payload);
  };

  const handlePlayPause = () => {
    if (musicState.playing) {
      emitIfAdmin('musicPause', { position: audioRef.current?.currentTime ?? musicState.position });
    } else {
      // Admin re-triggers play from current position
      if (!socket || !isAdmin) return;
      socket.emit('musicLoad', { trackId: musicState.trackId, src: musicState.src, name: musicState.name });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value);
    setCurrentTime(pos);
    if (audioRef.current) audioRef.current.currentTime = pos;
    emitIfAdmin('musicSeek', { position: pos });
  };

  const handleNext = () => emitIfAdmin('musicNext', {});
  const handlePrev = () => emitIfAdmin('musicPrev', {});
  const handleShuffle = () => emitIfAdmin('musicShuffle', { enabled: !musicState.shuffle });
  const handleLoop = () => emitIfAdmin('musicLoop', { enabled: !musicState.loop });

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <DraggableWindow
      title="RADIO_FEED"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '260px', zIndex: 1100 }}
      contentStyle={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      {/* Track name */}
      <div
        style={{
          fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--green)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          borderBottom: '1px solid var(--dark-green)', paddingBottom: '6px',
          minHeight: '1.1em',
        }}
      >
        {musicState.name ?? <span style={{ opacity: 0.4 }}>NO_TRACK</span>}
      </div>

      {/* Scrubber */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.5}
          value={currentTime}
          disabled={!isAdmin || !musicState.src}
          onMouseDown={() => { scrubbing.current = true; }}
          onMouseUp={() => { scrubbing.current = false; }}
          onChange={handleSeek}
          style={{ width: '100%', accentColor: 'var(--green)', cursor: isAdmin ? 'pointer' : 'default' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '0.65rem', opacity: 0.6 }}>
          <span>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
        <TransportBtn
          label="⇄"
          active={musicState.shuffle}
          onClick={handleShuffle}
          disabled={!isAdmin}
          title="SHUFFLE"
        />
        <TransportBtn label="◁◁" onClick={handlePrev} disabled={!isAdmin} title="PREV" />
        <TransportBtn
          label={musicState.playing ? '⏸' : '▶'}
          onClick={handlePlayPause}
          disabled={!isAdmin || !musicState.src}
          title={musicState.playing ? 'PAUSE' : 'PLAY'}
          primary
        />
        <TransportBtn label="▷▷" onClick={handleNext} disabled={!isAdmin} title="NEXT" />
        <TransportBtn
          label="↺"
          active={musicState.loop}
          onClick={handleLoop}
          disabled={!isAdmin}
          title="LOOP"
        />
      </div>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', opacity: 0.6, minWidth: '28px' }}>VOL</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--green)' }}
        />
        <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', opacity: 0.6, minWidth: '28px', textAlign: 'right' }}>
          {Math.round(volume * 100)}%
        </span>
      </div>

      {!isAdmin && (
        <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', opacity: 0.35, textAlign: 'center' }}>
          LISTEN_ONLY
        </div>
      )}
    </DraggableWindow>
  );
}

interface TransportBtnProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  title?: string;
}

function TransportBtn({ label, onClick, disabled, active, primary, title }: TransportBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: active ? 'var(--dark-green)' : 'transparent',
        color: disabled ? 'var(--dark-green)' : active ? 'var(--green)' : 'var(--text)',
        border: `1px solid ${disabled ? 'var(--dark-green)' : 'var(--dark-green)'}`,
        borderRadius: '2px',
        padding: primary ? '4px 12px' : '3px 7px',
        fontFamily: 'monospace',
        fontSize: primary ? '1rem' : '0.8rem',
        cursor: disabled ? 'default' : 'pointer',
        minWidth: primary ? '36px' : '28px',
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}
