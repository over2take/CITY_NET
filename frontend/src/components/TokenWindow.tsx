import React, { useEffect, useState } from 'react';
import { TerminalWindow, useFolder, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { TvPortrait } from './TvPortrait';
import { GmNotes } from './GmNotes';

// A token's info window - a player, an enemy or a friendly NPC - drawn as a terminal like
// the building window: the portrait in the corner, folders down the left, the open folder
// on the right, and the things you can do along the bottom.
//
// It shows what the old token window showed, to the same people. Every rule about who sees
// what lives with the caller, which decides the buttons and which folders exist; this lays
// them out. The only rules kept here are the ones that were always the window's own: the AC
// edit belongs to the GM, and a player's ID comes from the server's public fields.

export type TokenFolder = 'info' | 'id' | 'defense' | 'combat' | 'gm';

export interface TokenDefense {
  /** AC or DV, per game system. */
  label: string;
  melee: number;
  /** Null means "same as melee", shown as such rather than as a number nobody set. */
  ranged: number | null;
}

/** The last attack roll against this token, as the server reported it. */
export interface TokenAttackResult {
  hit: boolean;
  roll: number;
  damage?: number;
  through?: number;
  shieldAbsorbed?: number;
  criticalInjury?: boolean;
  targetDown?: boolean;
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

  /** A player's token, which has an ID card to show. Null for NPCs. */
  playerUsername: string | null;
  socket: any;

  /** Shown to the GM and the token's owner; edited only by the GM. Null hides the folder. */
  defense: TokenDefense | null;
  canEditDefense: boolean;
  onSaveDefense?: (melee: number | null, ranged: number | null) => Promise<void> | void;

  /** Null when there is no combat folder for this viewer. */
  combat: {
    /** An attack against this token is in flight; the window opens COMBAT to show it. */
    active: boolean;
    /** What the attack in flight says, if there is one. */
    status: React.ReactNode | null;
    lastResult: TokenAttackResult | null;
    /** The GM's manual initiative entry for a sheetless NPC. */
    onAddToInit?: (score: number) => void;
  } | null;

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
  };
}

export function TokenWindow({
  location, title, pos, setPos, onClose, titleControls, portrait, description, actions,
  playerUsername, socket, defense, canEditDefense, onSaveDefense, combat, gmNotesToken, tierPicker,
}: Props) {
  const folders: TerminalFolder<TokenFolder>[] = [
    { id: 'info', label: 'INFO' },
    ...(playerUsername ? [{ id: 'id' as const, label: 'ID' }] : []),
    ...(defense ? [{ id: 'defense' as const, label: 'DEFENSE' }] : []),
    ...(combat ? [{ id: 'combat' as const, label: 'COMBAT' }] : []),
    ...(gmNotesToken ? [{ id: 'gm' as const, label: 'GM NOTES' }] : []),
  ];
  const [open, setOpen] = useFolder(folders, location?.id);

  // An attack just started against this token: show where its result will land.
  const attacking = !!combat?.active;
  useEffect(() => {
    if (attacking) setOpen('combat');
  }, [attacking]); // eslint-disable-line react-hooks/exhaustive-deps

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
      panelMode={open === 'info' || open === 'gm' ? 'text' : 'controls'}
      header={(
        <>
          {open === 'info' && `${kind} · DATA`}
          {open === 'id' && 'IDENT · PUBLIC RECORD'}
          {open === 'defense' && `${defense?.label ?? 'AC'} · ${canEditDefense ? 'GM CAN EDIT' : 'YOUR TOKEN'}`}
          {open === 'combat' && 'COMBAT'}
          {open === 'gm' && 'GM ONLY · PLAYERS NEVER SEE THIS'}
        </>
      )}
    >
      {open === 'info' && (
        <>
          {description || 'NO_DATA'}
          {tierPicker && (
            <TierPicker {...tierPicker} />
          )}
        </>
      )}
      {open === 'id' && playerUsername && <IdCard username={playerUsername} socket={socket} />}
      {open === 'defense' && defense && (
        <DefensePanel
          key={location?.id}
          defense={defense}
          canEdit={canEditDefense}
          onSave={onSaveDefense}
        />
      )}
      {open === 'gm' && gmNotesToken && <GmNotes locationId={location?.id} token={gmNotesToken} />}
      {open === 'combat' && combat && (
        <CombatPanel key={location?.id} status={combat.status} lastResult={combat.lastResult} onAddToInit={combat.onAddToInit} />
      )}
    </TerminalWindow>
  );
}

/** The portrait, or a token drawn in the color of its side when there is none. */
function TokenPreview({ portrait, shape }: { portrait: { src: string; silhouette: boolean } | null; shape?: string }) {
  const frame: React.CSSProperties = {
    width: 180, height: 140, flexShrink: 0, overflow: 'hidden', position: 'relative',
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

function TierPicker({ tiers, value, onChange }: { tiers: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
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
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>Used by GENERATE_SHEET below.</div>
    </div>
  );
}

/**
 * A player's ID card: handle, role and blurb from their sheet's public fields.
 *
 * What the quick sheet card used to show in a window of its own, until nothing could open
 * it. Asked of the server rather than read off anything the viewer holds: `requestQuickSheet`
 * returns only fields the server marks public, which is why stream spectators may ask too.
 */
function IdCard({ username, socket }: { username: string; socket: any }) {
  const [data, setData] = useState<{ exists: boolean; fields?: Record<string, unknown> } | null>(null);
  useEffect(() => {
    setData(null);
    if (!socket) return;
    const handler = (d: any) => { if (d && d.username === username) setData(d); };
    socket.on('quickSheetData', handler);
    socket.emit('requestQuickSheet', { username });
    return () => { socket.off?.('quickSheetData', handler); };
  }, [socket, username]);

  if (!data) return <span style={{ opacity: 0.7 }}>FETCHING_IDENT…</span>;
  if (!data.exists) {
    return (
      <div>
        <div style={row}><span style={key}>OPERATOR</span>{username.toUpperCase()}</div>
        <div style={{ opacity: 0.7 }}>NO_IDENT_ON_FILE</div>
      </div>
    );
  }
  const f = data.fields ?? {};
  const text = (v: unknown) => (v == null || v === '' ? null : String(v));
  const handle = text(f.handle);
  const name = text(f.name);
  const role = text(f.role);
  const blurb = text(f.description);
  return (
    <div>
      <div style={row}><span style={key}>HANDLE</span>{(handle || name || username).toUpperCase()}</div>
      {handle && name && <div style={row}><span style={key}>NAME</span>{name}</div>}
      {role && <div style={row}><span style={key}>ROLE</span>{role.toUpperCase()}</div>}
      <div style={row}><span style={key}>OPERATOR</span>{username.toUpperCase()}</div>
      {blurb && (
        <div style={{ whiteSpace: 'pre-wrap', borderTop: '1px solid var(--dark-green)', paddingTop: 8, marginTop: 4 }}>
          {blurb}
        </div>
      )}
    </div>
  );
}

/** AC or DV: the GM edits it here; the token's owner sees it; nobody else gets this folder. */
function DefensePanel({ defense, canEdit, onSave }: {
  defense: TokenDefense; canEdit: boolean; onSave?: (melee: number | null, ranged: number | null) => Promise<void> | void;
}) {
  const [edit, setEdit] = useState<{ melee: string; ranged: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const L = defense.label;

  if (canEdit && edit) {
    const save = async () => {
      setSaving(true);
      try {
        await onSave?.(edit.melee === '' ? null : parseInt(edit.melee, 10), edit.ranged === '' ? null : parseInt(edit.ranged, 10));
        setEdit(null);
      } finally {
        setSaving(false);
      }
    };
    return (
      <div>
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
      </div>
    );
  }

  return (
    <div>
      <div style={row}><span style={key}>MELEE_{L}</span>{defense.melee}</div>
      <div style={row}>
        <span style={key}>RANGED_{L}</span>
        {defense.ranged != null ? defense.ranged : <span style={{ opacity: 0.7 }}>{defense.melee} (melee)</span>}
      </div>
      {canEdit && (
        <button
          type="button"
          className="utility-btn"
          style={small}
          onClick={() => setEdit({ melee: String(defense.melee), ranged: defense.ranged != null ? String(defense.ranged) : '' })}
        >EDIT_{L}</button>
      )}
    </div>
  );
}

/** Where an attack stands, how the last one went, and the GM's manual initiative entry. */
function CombatPanel({ status, lastResult, onAddToInit }: {
  status: React.ReactNode | null; lastResult: TokenAttackResult | null; onAddToInit?: (score: number) => void;
}) {
  const [score, setScore] = useState('');
  const valid = score !== '' && !Number.isNaN(Number(score)) && Number(score) >= 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {status && (
        <div style={{ border: '1px solid var(--green)', padding: '6px 10px' }}>{status}</div>
      )}
      {lastResult ? (
        <div
          data-testid="attack-result"
          style={{
            padding: '6px 10px',
            color: lastResult.hit ? 'var(--green)' : 'var(--danger)',
            border: `1px solid ${lastResult.hit ? 'var(--green)' : 'var(--danger)'}`,
          }}
        >
          {lastResult.hit ? 'HIT!' : 'MISS'} — rolled {lastResult.roll}
          {lastResult.damage !== undefined && (
            <> · DMG {lastResult.damage}{lastResult.through !== undefined && ` (${lastResult.through} through armor)`}</>
          )}
          {(lastResult.shieldAbsorbed ?? 0) > 0 && <> · SHIELD −{lastResult.shieldAbsorbed}</>}
          {lastResult.criticalInjury && <> · CRIT INJURY!</>}
          {lastResult.targetDown && <> · TARGET DOWN</>}
        </div>
      ) : !status && (
        <div style={{ opacity: 0.7 }}>NO ATTACKS AGAINST THIS TOKEN YET</div>
      )}
      {onAddToInit && (
        <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 6 }}>INITIATIVE SCORE</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" min="1" max="99" placeholder="SCORE" aria-label="Initiative score"
              value={score} onChange={(e) => setScore(e.target.value)} style={field}
            />
            <button
              type="button"
              className="utility-btn"
              disabled={!valid}
              onClick={() => { onAddToInit(Number(score)); setScore(''); }}
              style={small}
            >ADD TO INIT</button>
          </div>
        </div>
      )}
    </div>
  );
}
