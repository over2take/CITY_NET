import React, { useEffect, useState } from 'react';
import { TerminalWindow, TERMINAL_PREVIEW, useFolder, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { TvPortrait } from './TvPortrait';
import { GmNotes } from './GmNotes';
import { useWords, todaysWords, type WordLookup } from '../sheets/words';
import { useParts } from '../sheets/parts';
import { customTemplate, isCustomSystem, useCustomTemplate } from '../sheets/customTemplates';
import { othersSee } from '../sheets/publicLines';

// A token's info window - a player, an enemy or a friendly NPC - drawn as a terminal like
// the building window: the portrait in the corner, folders down the left, the open folder
// on the right, and the things you can do along the bottom.
//
// INFO says who it is, HEALTH how they are, QUICK ACTIONS (your own token) holds your rolls,
// and GM NOTES (the main admin, on NPCs) what only the GM knows. Which folders a viewer gets
// and which health panel they see is decided by the caller - tokenView() in tokenActions.ts,
// where it is tested - and handed over as slots; this lays them out.

export type TokenFolder = 'info' | 'health' | 'quick' | 'gm';

export interface TokenDefense {
  /** AC or DV, per game system. */
  label: string;
  melee: number;
  /** Null means "same as melee", shown as such rather than as a number nobody set. */
  ranged: number | null;
}

interface Props {
  location: any;
  title: string;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  titleControls?: React.ReactNode;
  /** The portrait, already decided: an NPC's comes only through its sheet link, silhouette and all. */
  portrait: { src: string; silhouette: boolean } | null;
  description: string;
  actions: TerminalAction[];

  /** The player behind a player's token, whose handle and role INFO shows. Null for NPCs. */
  operator: string | null;
  socket: any;

  /** The HEALTH folder's body: the panel that changes health, or the one that only watches it. */
  health: React.ReactNode;
  /** The GM's sections under HEALTH: defense to edit, and a manual initiative entry. */
  gmHealth?: {
    defense: TokenDefense;
    onSaveDefense: (melee: number | null, ranged: number | null) => Promise<void> | void;
    /** For a sheetless NPC not yet in the initiative order. */
    onAddToInit?: (score: number) => void;
  };
  /** Your own token's QUICK ACTIONS. Absent, there is no such folder. */
  quickActions?: React.ReactNode;
  /** An attack this viewer is setting up, one line above the buttons while it lasts. */
  attackStatus?: React.ReactNode;

  /**
   * The admin token, handed over only for the main admin on an NPC token - which is what
   * makes a GM NOTES folder appear. The notes are fetched with it; players never get one.
   */
  gmNotesToken?: string;

  /** The GM's tier picker for GENERATE_SHEET, shown in INFO when an NPC has no sheet. */
  tierPicker?: {
    tiers: { id: string; label: string }[];
    value: string;
    onChange: (id: string) => void;
    /** A custom system's level for the tier (4b4e); absent for the built-in systems. */
    level?: number;
    onLevelChange?: (level: number) => void;
  };

  /** Open this folder - HIT_POINTS asks for HEALTH. A new `seq` asks again. */
  folderRequest?: { folder: TokenFolder; seq: number } | null;
  /** Told which folder is open, so the sidebar can light HIT_POINTS while HEALTH shows. */
  onFolderChange?: (folder: TokenFolder) => void;
  /** The running game system, for a custom system's own words (GM NOTES, INITIATIVE SCORE). */
  gameSystem?: string;
}

export function TokenWindow({
  location, title, pos, setPos, onClose, titleControls, portrait, description, actions,
  operator, socket, health, gmHealth, quickActions, attackStatus, gmNotesToken, tierPicker,
  folderRequest, onFolderChange, gameSystem,
}: Props) {
  const word = useWords(gameSystem);
  // A custom system with combat off has no defense to show or edit (3b6b).
  const parts = useParts(gameSystem);
  const combatOn = parts('combat');
  // With token health off there is no health to show; the folder stays only for what the GM
  // still keeps in it, the defense (with combat) or a manual initiative score (3b6d).
  const healthOn = parts('token_health');
  const healthFolder = healthOn || (!!gmHealth && (combatOn || !!gmHealth.onAddToInit));
  const gm = word('gm', 'short', 'GM').toUpperCase();
  const folders: TerminalFolder<TokenFolder>[] = [
    { id: 'info', label: 'INFO' },
    ...(healthFolder ? [{ id: 'health' as const, label: 'HEALTH' }] : []),
    ...(quickActions ? [{ id: 'quick' as const, label: 'QUICK ACTIONS' }] : []),
    ...(gmNotesToken ? [{ id: 'gm' as const, label: `${gm} NOTES` }] : []),
  ];
  const [open, setOpen] = useFolder(folders, location?.id);
  // After useFolder's own reset, so a request that comes with a new token still wins.
  useEffect(() => {
    if (folderRequest) setOpen(folderRequest.folder);
  }, [folderRequest?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onFolderChange?.(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = location?.shape === 'enemy_rhombus' ? 'ENEMY' : location?.shape === 'friendly_rhombus' ? 'FRIENDLY' : 'PLAYER';

  return (
    <TerminalWindow
      title={title}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      titleControls={titleControls}
      preview={<TokenPreview portrait={portrait} shape={location?.shape} />}
      folders={folders}
      open={open}
      onOpen={setOpen}
      actions={actions}
      panelMode={open === 'gm' ? 'text' : 'controls'}
      header={(
        <>
          {open === 'info' && `${operator ? operator.toUpperCase() : kind} · DATA`}
          {open === 'health' && (healthOn ? 'VITALS · LIVE' : `${gm} ONLY`)}
          {open === 'quick' && 'YOUR TOKEN · ROLLS GO TO THE DICE TRAY'}
          {open === 'gm' && `${gm} ONLY · PLAYERS NEVER SEE THIS`}
        </>
      )}
      footer={attackStatus ? (
        <div data-testid="attack-status" style={{ fontFamily: 'monospace', fontSize: 11, padding: '4px 10px', border: '1px solid var(--green)', color: 'var(--green)' }}>
          {attackStatus}
        </div>
      ) : undefined}
    >
      {open === 'info' && (
        <>
          {operator && <IdLines username={operator} socket={socket} gameSystem={gameSystem} />}
          <div style={{ whiteSpace: 'pre-wrap' }}>{description || 'NO_DATA'}</div>
          {tierPicker && <TierPicker {...tierPicker} />}
        </>
      )}
      {open === 'health' && (
        <>
          {healthOn && health}
          {gmHealth && <GmHealth key={location?.id} {...gmHealth} word={word} showDefense={combatOn} />}
        </>
      )}
      {open === 'quick' && quickActions}
      {open === 'gm' && gmNotesToken && <GmNotes locationId={location?.id} token={gmNotesToken} gm={word('gm', 'short', 'GM')} />}
    </TerminalWindow>
  );
}

/** The portrait, or a token drawn in the color of its side when there is none. */
function TokenPreview({ portrait, shape }: { portrait: { src: string; silhouette: boolean } | null; shape?: string }) {
  const frame: React.CSSProperties = {
    width: TERMINAL_PREVIEW.width, height: TERMINAL_PREVIEW.height, flexShrink: 0, overflow: 'hidden', position: 'relative',
    border: '1px solid var(--green)', background: 'var(--black)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  if (portrait) {
    return (
      <div style={frame} data-testid="token-preview" data-kind="portrait">
        <TvPortrait src={portrait.src} silhouette={portrait.silhouette} />
      </div>
    );
  }
  // Enemy, friendly and player tokens are told apart on the map by color; the same here.
  const color = shape === 'enemy_rhombus' ? 'var(--danger)' : shape === 'friendly_rhombus' ? 'var(--cyan)' : 'var(--green)';
  return (
    <div style={frame} data-testid="token-preview" data-kind="token">
      <svg width="90" height="110" viewBox="0 0 90 110" role="img" aria-label="Token" style={{ color }}>
        <polygon points="45,4 86,55 45,106 4,55" fill="none" stroke="currentColor" strokeWidth="3" />
        <polyline points="4,55 86,55" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
        <polyline points="45,4 30,55 45,106 60,55 45,4" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      </svg>
    </div>
  );
}

const mono: React.CSSProperties = { fontFamily: 'monospace' };
const small: React.CSSProperties = { ...mono, fontSize: 11, padding: '3px 10px' };
const field: React.CSSProperties = {
  ...mono, fontSize: 12, width: 70, background: 'var(--black)', color: 'var(--green)',
  border: '1px solid var(--dark-green)', padding: '3px 6px',
};
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 };
const key: React.CSSProperties = { minWidth: 110, fontWeight: 'bold' };

/**
 * GENERATE_SHEET's tier, and for a custom system the level its tier is worked out and rolled for
 * (4b4e; approved mockup builder-npcs, 2026-10-07). The built-in systems' tiers take no level.
 */
function TierPicker({ tiers, value, onChange, level, onLevelChange }: {
  tiers: { id: string; label: string }[]; value: string; onChange: (id: string) => void;
  level?: number; onLevelChange?: (level: number) => void;
}) {
  return (
    <div style={{ whiteSpace: 'normal', marginTop: 12, borderTop: '1px solid var(--dark-green)', paddingTop: 10 }}>
      <label style={{ ...row, marginBottom: 0 }}>
        <span style={key}>SHEET TIER</span>
        <select
          aria-label="NPC tier"
          value={value || tiers[0]?.id}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...field, width: 'auto' }}
        >
          {tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      {level !== undefined && onLevelChange && (
        <label style={{ ...row, marginBottom: 0, marginTop: 6 }}>
          <span style={key}>LEVEL</span>
          <input type="number" aria-label="NPC level" min={0} max={99} value={level} style={{ ...field, width: 70 }}
            onChange={(e) => { if (e.target.value.trim() !== '') onLevelChange(Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)))); }} />
        </label>
      )}
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>Used by GENERATE_SHEET below.</div>
    </div>
  );
}

/**
 * A player's handle and role, from their sheet's public fields - INFO's first lines. A custom
 * system shows its character's name and every field its sheet shows to EVERYONE, by their own
 * labels (publicLines.ts, 4b3e).
 *
 * Asked of the server rather than read off anything the viewer holds: `requestQuickSheet`
 * returns only fields the server marks public, which is why stream spectators may ask too.
 * Nothing shows until it answers, and nothing when there is no sheet: the header already
 * names the player.
 */
function IdLines({ username, socket, gameSystem }: { username: string; socket: any; gameSystem?: string }) {
  const [data, setData] = useState<{ exists: boolean; fields?: Record<string, unknown> } | null>(null);
  useEffect(() => {
    setData(null);
    if (!socket) return;
    const handler = (d: any) => { if (d && d.username === username) setData(d); };
    socket.on('quickSheetData', handler);
    socket.emit('requestQuickSheet', { username });
    return () => { socket.off?.('quickSheetData', handler); };
  }, [socket, username]);

  useCustomTemplate(gameSystem);
  const custom = isCustomSystem(gameSystem) ? customTemplate(gameSystem) : undefined;

  if (!data?.exists) return null;
  const f = data.fields ?? {};
  if (custom) {
    return (
      <div data-testid="id-lines" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--dark-green)' }}>
        {othersSee(custom, f).map((line) => (
          <div key={line.label} style={row}><span style={key}>{line.label.toUpperCase()}</span>{line.value}</div>
        ))}
      </div>
    );
  }
  const text = (v: unknown) => (v == null || v === '' ? null : String(v));
  const handle = text(f.handle);
  const name = text(f.name);
  const role = text(f.role);
  const shown = handle || name;
  if (!shown && !role) return null;
  return (
    <div data-testid="id-lines" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--dark-green)' }}>
      {shown && <div style={row}><span style={key}>HANDLE</span>{shown.toUpperCase()}</div>}
      {handle && name && <div style={row}><span style={key}>NAME</span>{name}</div>}
      {role && <div style={row}><span style={key}>ROLE</span>{role.toUpperCase()}</div>}
    </div>
  );
}

/** AC or DV as it stands, ranged shown as the melee value when none is set. */
export function DefenseReadout({ defense }: { defense: TokenDefense }) {
  const L = defense.label;
  return (
    <>
      <div style={row}><span style={key}>MELEE_{L}</span>{defense.melee}</div>
      <div style={row}>
        <span style={key}>RANGED_{L}</span>
        {defense.ranged != null ? defense.ranged : <span style={{ opacity: 0.7 }}>{defense.melee} (melee)</span>}
      </div>
    </>
  );
}

const sectionHead: React.CSSProperties = { fontSize: 10, opacity: 0.8, letterSpacing: 1, marginBottom: 6 };
const divider: React.CSSProperties = { borderTop: '1px solid var(--dark-green)', marginTop: 12, paddingTop: 10 };

/**
 * The GM's part of HEALTH: defense to edit, and a sheetless NPC's initiative by hand. Defense
 * belongs to combat, so it is not shown where the game has combat turned off.
 */
function GmHealth({ defense, onSaveDefense, onAddToInit, word = todaysWords, showDefense = true }: NonNullable<Props['gmHealth']> & { word?: WordLookup; showDefense?: boolean }) {
  const [edit, setEdit] = useState<{ melee: string; ranged: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [score, setScore] = useState('');
  const L = defense.label;
  const validScore = score !== '' && !Number.isNaN(Number(score)) && Number(score) >= 1;

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await onSaveDefense(edit.melee === '' ? null : parseInt(edit.melee, 10), edit.ranged === '' ? null : parseInt(edit.ranged, 10));
      setEdit(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {showDefense && <div style={divider}>
        <div style={sectionHead}>{L} · GM</div>
        {edit ? (
          <>
            <label style={row}>
              <span style={key}>MELEE_{L}</span>
              <input type="number" min="0" aria-label={`Melee ${L}`} value={edit.melee}
                onChange={(e) => setEdit({ ...edit, melee: e.target.value })} style={field} />
            </label>
            <label style={row}>
              <span style={key}>RANGED_{L}</span>
              <input type="number" min="0" aria-label={`Ranged ${L}`} value={edit.ranged}
                onChange={(e) => setEdit({ ...edit, ranged: e.target.value })} style={field} />
              <span title={`Leave blank to use Melee ${L}`} style={{ cursor: 'help' }}>?</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="utility-btn" disabled={saving} onClick={save} style={small}>
                {saving ? 'SAVING…' : 'SAVE'}
              </button>
              <button type="button" className="utility-btn" disabled={saving} onClick={() => setEdit(null)} style={small}>CANCEL</button>
            </div>
          </>
        ) : (
          <>
            <DefenseReadout defense={defense} />
            <button
              type="button"
              className="utility-btn"
              style={small}
              onClick={() => setEdit({ melee: String(defense.melee), ranged: defense.ranged != null ? String(defense.ranged) : '' })}
            >EDIT_{L}</button>
          </>
        )}
      </div>}
      {onAddToInit && (
        <div style={divider}>
          <div style={sectionHead}>{word('initiative', 'singular', 'INITIATIVE').toUpperCase()} SCORE</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" min="1" max="99" placeholder="SCORE" aria-label={`${word('initiative', 'singular', 'Initiative')} score`}
              value={score} onChange={(e) => setScore(e.target.value)} style={field}
            />
            <button
              type="button"
              className="utility-btn"
              disabled={!validScore}
              onClick={() => { onAddToInit(Number(score)); setScore(''); }}
              style={small}
            >ADD TO {word('initiative', 'short', 'INIT').toUpperCase()}</button>
          </div>
        </div>
      )}
    </>
  );
}
