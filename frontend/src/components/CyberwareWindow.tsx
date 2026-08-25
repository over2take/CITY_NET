import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import bodySvg from '../assets/body.svg?raw';
import {
  CYBER_TYPES, typeById, wiredPanels, unwiredPanels, drawnFigureBox, looksLike,
  type Side, type Panel,
} from '../sheets/cyberwareLocations';
import {
  CYBERWARE_FIELD, readRows, normaliseRow, totalHumanityLoss, totalCost,
  rowLocation, rowsForPanel, describeMod, isSetKind, MOD_KINDS, MOD_KIND_LABEL,
  type CyberRow, type CyberMod, type ModKind,
} from '../sheets/cyberwareRows';
import type { SheetFieldValue } from '../sheets/types';

// The augmentation window: a body with what is installed where, and the table underneath.
//
// Two views of one list because the questions differ. What is in my left arm is answered
// by the diagram; what am I running, and what did it cost, is answered by the table — and
// no single ordering answers both.
//
// The wires are drawn from measured positions on the figure rather than guessed. See
// sheets/cyberwareLocations for why the anchors are fractions of the *drawing* rather than
// of the box it sits in, and why the figure's centreline is not 0.5.

interface Props {
  data: Record<string, unknown>;
  readOnly?: boolean;
  onFieldChange: (fieldId: string, value: SheetFieldValue) => void;
  onClose: () => void;
  /** Whose chrome this is, for the title bar. */
  who?: string;
}

const mono = (size: number): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: size, letterSpacing: 1,
});

const inputStyle: React.CSSProperties = {
  background: 'var(--black)', border: '1px solid var(--dark-green)', color: 'var(--green)',
  fontFamily: 'monospace', fontSize: 11, padding: '3px 5px', width: '100%',
};

type SortKey = 'name' | 'location' | 'hl' | 'cost';

/**
 * A row's modifiers, as chips beside its effect text.
 *
 * Chips rather than a sentence because these are the mechanically real part of a row and
 * the description often is not: an imported piece arrives with blank flavour text but its
 * modifiers intact, so `+6 Business` is frequently the only thing in the cell.
 */
function ModChips({ mods }: { mods: CyberMod[] }) {
  if (!mods.length) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, verticalAlign: 'middle' }}>
      {mods.map((m, i) => (
        <span
          key={`${m.kind}-${m.target}-${i}`}
          title={MOD_KIND_LABEL[m.kind]}
          style={{
            ...mono(10), letterSpacing: 0, padding: '0 4px', whiteSpace: 'nowrap',
            border: '1px solid var(--dark-green)', color: 'var(--cyan)',
            // A set reads as a claim about the final value, so it is marked out from the
            // adjustments rather than sitting in the same run of +2s.
            background: isSetKind(m.kind) ? 'var(--dark-green)' : 'transparent',
          }}
        >{describeMod(m)}</span>
      ))}
    </span>
  );
}

/**
 * The modifier list on the add form.
 *
 * One line per modifier rather than the stack of pickers the Companion walks you through:
 * the choices are what to change, which thing, and by how much, and three controls on a
 * line shows all three at once — including what you already added, which a modal hides.
 *
 * The target is free text because the stat and skill lists differ per system, and a fixed
 * dropdown would be wrong on two of the three this app supports.
 */
function ModEditor({ mods, onChange }: { mods: CyberMod[]; onChange: (next: CyberMod[]) => void }) {
  const patch = (i: number, change: Partial<CyberMod>) =>
    onChange(mods.map((m, n) => (n === i ? { ...m, ...change } : m)));

  return (
    <div style={{ marginTop: 6 }}>
      {mods.map((m, i) => (
        <div
          key={i}
          style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 0.5fr 20px', gap: 6, marginBottom: 4 }}
        >
          <select
            style={inputStyle} aria-label={`Modifier ${i + 1} kind`} value={m.kind}
            onChange={(e) => patch(i, { kind: e.target.value as ModKind })}
          >
            {MOD_KINDS.map((k) => <option key={k} value={k}>{MOD_KIND_LABEL[k]}</option>)}
          </select>
          <input
            style={inputStyle} placeholder="Stat, skill or roll"
            aria-label={`Modifier ${i + 1} target`} value={m.target}
            onChange={(e) => patch(i, { target: e.target.value })}
          />
          <input
            style={{ ...inputStyle, textAlign: 'right' }} type="number"
            aria-label={`Modifier ${i + 1} value`} value={m.value}
            onChange={(e) => patch(i, { value: Number(e.target.value) || 0 })}
          />
          <button
            type="button" aria-label={`Remove modifier ${i + 1}`}
            onClick={() => onChange(mods.filter((_, n) => n !== i))}
            style={{ ...mono(11), background: 'none', border: 'none', color: 'var(--danger, #aa3333)', cursor: 'pointer', padding: 0 }}
          >×</button>
        </div>
      ))}
      <button
        type="button" className="utility-btn" style={{ ...mono(9), padding: '2px 6px' }}
        onClick={() => onChange([...mods, { kind: 'stat', target: '', value: 0 }])}
      >+ MODIFIER</button>
    </div>
  );
}

export function CyberwareWindow({ data, readOnly, onFieldChange, onClose, who }: Props) {
  const [pos, setPos] = useState({ x: 90, y: 60 });
  const rows = useMemo(() => readRows(data), [data]);

  const stageRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const [wires, setWires] = useState<React.ReactNode[]>([]);

  const [sortKey, setSortKey] = useState<SortKey>('location');
  const [asc, setAsc] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  const [draft, setDraft] = useState<CyberRow | null>(null);
  /** The panel whose + was pressed, while it is asking what to put there. */
  const [placing, setPlacing] = useState<Panel | null>(null);
  const placingRef = useRef<HTMLDivElement>(null);

  const write = (next: CyberRow[]) => onFieldChange(CYBERWARE_FIELD, next);

  /**
   * Draw a wire from each panel to its point on the figure.
   *
   * Measured from the live layout rather than computed from constants: the panels grow as
   * chrome is added, so where a wire starts is only knowable once the browser has laid it
   * out. Re-run whenever the rows change, since that is what changes panel heights.
   */
  useEffect(() => {
    const stage = stageRef.current;
    const box = figureRef.current;
    if (!stage || !box) return undefined;

    const paint = () => {
      const sb = stage.getBoundingClientRect();
      const cb = box.getBoundingClientRect();
      const fig = drawnFigureBox(cb.width, cb.height);
      const out: React.ReactNode[] = [];

      wiredPanels().forEach((panel) => {
        const el = panelRefs.current.get(panel.key);
        if (!el || !panel.anchor) return;
        const r = el.getBoundingClientRect();
        const onLeft = r.left - sb.left < sb.width / 2;
        const x1 = (onLeft ? r.right : r.left) - sb.left;
        const y1 = r.top - sb.top + r.height / 2;
        const x2 = cb.left - sb.left + fig.left + fig.width * panel.anchor[0];
        const y2 = cb.top - sb.top + fig.top + fig.height * panel.anchor[1];
        const stub = onLeft ? x1 + 14 : x1 - 14;
        const filled = rowsForPanel(rows, panel.typeId, panel.side).length > 0;
        const stroke = filled ? 'var(--cyan)' : 'var(--dark-green)';
        out.push(
          <g key={panel.key}>
            <path d={`M${x1} ${y1} H${stub} L${x2} ${y2}`} fill="none" stroke={stroke} strokeWidth={1} />
            <circle cx={x2} cy={y2} r={3} fill={filled ? 'var(--cyan)' : 'none'} stroke={filled ? 'var(--cyan)' : 'var(--grid-section)'} />
          </g>,
        );
      });
      setWires(out);
    };

    paint();
    // Guarded rather than assumed: jsdom has no ResizeObserver, and a window that throws
    // where it is missing is worse than one whose wires simply do not follow a resize.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(paint);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [rows]);

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'hl') return (a.hl - b.hl) * dir;
      if (sortKey === 'cost') {
        // Unpriced sorts last either way: missing information, not a low price.
        if (a.cost === null && b.cost === null) return 0;
        if (a.cost === null) return 1;
        if (b.cost === null) return -1;
        return (a.cost - b.cost) * dir;
      }
      const x = sortKey === 'location' ? rowLocation(a) : a.name;
      const y = sortKey === 'location' ? rowLocation(b) : b.name;
      return x.localeCompare(y) * dir;
    });
  }, [rows, sortKey, asc]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc);
    else { setSortKey(k); setAsc(true); }
  };
  const arrow = (k: SortKey) => (k === sortKey ? (asc ? ' ▲' : ' ▼') : '');

  const removeRow = (row: CyberRow) => {
    // By identity, not by index: the table is sorted, so the row on screen is not the row
    // at that position in the stored array.
    const i = rows.indexOf(row);
    if (i >= 0) write([...rows.slice(0, i), ...rows.slice(i + 1)]);
  };

  const commitDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return;
    // Through the normaliser rather than stored as typed: a "+ MODIFIER" line the player
    // added and then left blank is not a modifier, and normaliseRow already drops those.
    write([...rows, normaliseRow({ ...draft, name })]);
    setDraft(null);
  };

  /**
   * What a panel's + does.
   *
   * Going straight to a blank form was wrong after an import: every imported piece arrives
   * unfiled, so the commonest reason to press + on an arm is to put something already on
   * the sheet into it. Asking first costs one click and saves retyping a piece you have.
   *
   * With nothing waiting to be placed there is nothing to ask about, so it opens the form.
   */
  const addInto = (panel: Panel) => {
    setDraft(null);
    if (unfiledRows.length) setPlacing(panel);
    else setDraft(normaliseRow({ type: panel.typeId, side: panel.side }));
  };

  /**
   * Take a piece out of the body part it is in, without throwing it away.
   *
   * Distinct from removing it: uninstalling chrome and never having owned it are different
   * things, and the table's × does the second. This puts it back among the unplaced, where
   * it can be filed somewhere else.
   */
  const unfile = (row: CyberRow) => {
    const i = rows.indexOf(row);
    if (i < 0) return;
    const next = [...rows];
    next[i] = { ...row, type: '', side: null };
    write(next);
  };

  /** Move a piece already on the sheet into the panel that asked for it. */
  const fileInto = (row: CyberRow, panel: Panel) => {
    const i = rows.indexOf(row);
    if (i < 0) return;
    const next = [...rows];
    next[i] = { ...row, type: panel.typeId, side: panel.side };
    write(next);
    setPlacing(null);
  };

  useEffect(() => {
    if (!placing) return;
    // Opened from a panel that may be a screenful above it. Guarded because jsdom has no
    // scrollIntoView and an unguarded call takes the whole window down under test.
    placingRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [placing]);

  const hl = totalHumanityLoss(rows);
  const spent = totalCost(rows);
  const unfiledRows = rows.filter((r) => !r.type);

  const panelBox = (panel: Panel) => {
    const mine = rowsForPanel(rows, panel.typeId, panel.side);
    const filled = mine.length > 0;
    return (
      <div
        key={panel.key}
        ref={(el) => { if (el) panelRefs.current.set(panel.key, el); }}
        style={{
          border: `1px ${filled ? 'solid var(--green)' : 'dashed var(--grid-section)'}`,
          padding: '4px 7px', background: 'var(--black)', position: 'relative', zIndex: 2,
        }}
      >
        <div style={{
          ...mono(9), color: filled ? 'var(--green)' : 'var(--grid-section)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: filled ? '1px solid var(--dark-green)' : 'none',
          paddingBottom: filled ? 2 : 0,
        }}>
          <span>{panel.label.toUpperCase()}{filled ? ` · ${mine.length}` : ' · EMPTY'}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => addInto(panel)}
              aria-label={`Add to ${panel.label}`}
              style={{ ...mono(11), background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', padding: 0 }}
            >+</button>
          )}
        </div>
        {mine.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            style={{
              ...mono(11), color: 'var(--cyan)', paddingTop: 2, letterSpacing: 0,
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6,
            }}
          >
            <span>{r.name} <span style={{ color: 'var(--grid-section)' }}>HL {r.hl}</span></span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => unfile(r)}
                aria-label={`Take ${r.name} out of ${panel.label}`}
                title="Take out — keeps the piece, unplaces it"
                style={{
                  ...mono(11), background: 'none', border: 'none', color: 'color-mix(in srgb, var(--green) 55%, transparent)',
                  cursor: 'pointer', padding: 0, lineHeight: 1,
                }}
              >−</button>
            )}
          </div>
        ))}
      </div>
    );
  };

  const left = wiredPanels().filter((p) => CYBER_TYPES.find((t) => t.id === p.typeId) && (p.side === 'r' || (p.side === null && p.typeId === 'cyberaudio')));
  const right = wiredPanels().filter((p) => !left.includes(p));

  return (
    <DraggableWindow
      title={who ? `AUGMENTATION — ${who.toUpperCase()}` : 'AUGMENTATION'}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: 760, maxWidth: '95vw' }}
      contentStyle={{ maxHeight: '80vh', overflowY: 'auto' }}
    >
      <div style={{ ...mono(10), color: 'var(--cyan)', display: 'flex', justifyContent: 'space-between', paddingBottom: 6 }}>
        <span>{rows.length} INSTALLED{unfiledRows.length ? ` · ${unfiledRows.length} UNFILED` : ''}</span>
        <span>HUMANITY LOSS {hl}{spent > 0 ? ` · ${spent.toLocaleString()}eb` : ''}</span>
      </div>

      {!readOnly && placing && (
        <div ref={placingRef} style={{ marginBottom: 8, border: '1px solid var(--cyan)', padding: 7 }}>
          <div style={{ ...mono(9), color: 'var(--cyan)', paddingBottom: 4 }}>
            PUT SOMETHING IN {placing.label.toUpperCase()}
          </div>
          {[...unfiledRows]
            // Likely matches first, by name. Only an ordering — the export never says
            // where a piece went, so nothing here decides for you.
            .sort((a, b) => Number(looksLike(placing.typeId, b.name)) - Number(looksLike(placing.typeId, a.name)))
            .map((r, i) => {
              const fits = looksLike(placing.typeId, r.name);
              return (
                <button
                  key={`${r.name}-${i}`}
                  type="button"
                  onClick={() => fileInto(r, placing)}
                  style={{
                    ...mono(11), letterSpacing: 0, display: 'block', width: '100%',
                    textAlign: 'left', background: 'none', cursor: 'pointer', padding: '3px 4px',
                    border: '1px solid transparent',
                    color: fits ? 'var(--cyan)' : 'var(--grid-section)',
                  }}
                >
                  {r.name}
                  <span style={{ color: 'var(--grid-section)' }}> HL {r.hl}</span>
                  {fits && <span style={{ color: 'var(--cyan)' }}> · fits</span>}
                </button>
              );
            })}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="utility-btn" onClick={() => setPlacing(null)}>CANCEL</button>
            <button
              type="button"
              className="upload-btn"
              onClick={() => {
                setDraft(normaliseRow({ type: placing.typeId, side: placing.side }));
                setPlacing(null);
              }}
            >NEW PIECE</button>
          </div>
        </div>
      )}

      <div
        ref={stageRef}
        style={{
          position: 'relative', display: 'grid',
          gridTemplateColumns: '1fr 210px 1fr', gap: 12, minHeight: 340,
        }}
      >
        <svg style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', width: '100%', height: '100%' }}>
          {wires}
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', zIndex: 2 }}>
          {left.map(panelBox)}
        </div>

        <div ref={figureRef} style={{ position: 'relative' }}>
          <div
            aria-hidden
            style={{ position: 'absolute', inset: 0, color: 'var(--green)', opacity: 0.35 }}
            dangerouslySetInnerHTML={{ __html: bodySvg }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', zIndex: 2 }}>
          {right.map(panelBox)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
        {unwiredPanels().map(panelBox)}
      </div>

      {unfiledRows.length > 0 && (
        <div style={{ ...mono(9), color: 'color-mix(in srgb, var(--green) 55%, transparent)', marginTop: 6 }}>
          ◌ use + on a body part to place unfiled pieces
        </div>
      )}

      <div style={{ marginTop: 10, borderTop: '1px solid var(--dark-green)' }}>
        <button
          type="button"
          onClick={() => setListOpen(!listOpen)}
          style={{ ...mono(9), background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', padding: '6px 0' }}
        >
          {listOpen ? '▼' : '▶'} ALL CYBERWARE
        </button>

        {listOpen && (
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--dark-green)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th
                    title="Not yet placed on a body part"
                    style={{
                      position: 'sticky', top: 0, background: 'var(--black)',
                      borderBottom: '1px solid var(--dark-green)', width: 18, padding: '4px 4px 4px 6px',
                      ...mono(10), color: 'var(--dark-green)',
                    }}
                  >◌</th>
                  {([['name', 'NAME'], ['location', 'TYPE'], ['hl', 'HL'], ['cost', 'EB']] as [SortKey, string][])
                    .map(([k, lbl]) => (
                      <th
                        key={k}
                        onClick={() => sortBy(k)}
                        style={{
                          ...mono(9), color: 'var(--green)', cursor: 'pointer', padding: '4px 6px',
                          textAlign: k === 'hl' || k === 'cost' ? 'right' : 'left',
                          position: 'sticky', top: 0, background: 'var(--black)',
                          borderBottom: '1px solid var(--dark-green)', whiteSpace: 'nowrap',
                        }}
                      >{lbl}{arrow(k)}</th>
                    ))}
                  <th style={{ ...mono(9), color: 'var(--green)', padding: '4px 6px', textAlign: 'left', position: 'sticky', top: 0, background: 'var(--black)', borderBottom: '1px solid var(--dark-green)' }}>EFFECT</th>
                  {!readOnly && <th style={{ position: 'sticky', top: 0, background: 'var(--black)', borderBottom: '1px solid var(--dark-green)', width: 22 }} aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan={readOnly ? 6 : 7} style={{ ...mono(11), color: 'var(--grid-section)', padding: '4px 6px', letterSpacing: 0 }}>
                    Nothing installed. Add a piece, or import a character.
                  </td></tr>
                )}
                {sorted.map((r, i) => (
                  <tr key={`${r.name}-${i}`}>
                    <td
                      title={r.type ? rowLocation(r) : 'Not yet placed — use + on a body part'}
                      style={{ padding: '3px 4px 3px 6px', textAlign: 'center', ...mono(12) }}
                    >
                      <span style={{ color: r.type ? 'var(--green)' : 'color-mix(in srgb, var(--green) 75%, transparent)' }}>
                        {r.type ? '●' : '◌'}
                      </span>
                    </td>
                    <td style={{ ...mono(11), color: 'var(--cyan)', padding: '3px 6px', letterSpacing: 0 }}>{r.name}</td>
                    <td style={{ ...mono(11), color: r.type ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', padding: '3px 6px', letterSpacing: 0 }}>{rowLocation(r)}</td>
                    <td style={{ ...mono(11), color: 'var(--cyan)', padding: '3px 6px', textAlign: 'right' }}>{r.hl}</td>
                    <td style={{ ...mono(11), color: r.cost === null ? 'var(--dark-green)' : 'var(--cyan)', padding: '3px 6px', textAlign: 'right' }}>
                      {r.cost === null ? '—' : r.cost.toLocaleString()}
                    </td>
                    <td style={{ ...mono(11), color: 'var(--grid-section)', padding: '3px 6px', letterSpacing: 0 }}>
                      {r.data && <span style={{ marginRight: r.mods.length ? 6 : 0 }}>{r.data}</span>}
                      <ModChips mods={r.mods} />
                    </td>
                    {!readOnly && (
                      <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => removeRow(r)}
                          aria-label={`Remove ${r.name}`}
                          style={{ ...mono(11), background: 'none', border: 'none', color: 'var(--danger, #aa3333)', cursor: 'pointer', padding: 0 }}
                        >×</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!readOnly && (draft ? (
        <div style={{ marginTop: 8, border: '1px solid var(--dark-green)', padding: 7 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.6fr 0.6fr 0.7fr', gap: 6 }}>
            <input
              autoFocus style={inputStyle} placeholder="Name" aria-label="Cyberware name"
              value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <select
              style={inputStyle} aria-label="Install type" value={draft.type}
              onChange={(e) => {
                const t = typeById(e.target.value);
                // Drop a side the new type cannot have, rather than leaving a Fashionware
                // marked R because it used to be an arm.
                setDraft({ ...draft, type: e.target.value, side: t?.paired ? (draft.side ?? 'r') : null });
              }}
            >
              <option value="">Unfiled</option>
              {CYBER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select
              style={{ ...inputStyle, opacity: typeById(draft.type)?.paired ? 1 : 0.35 }}
              aria-label="Side" disabled={!typeById(draft.type)?.paired}
              value={draft.side ?? ''}
              onChange={(e) => setDraft({ ...draft, side: (e.target.value || null) as Side })}
            >
              <option value="r">R</option>
              <option value="l">L</option>
            </select>
            <input
              style={inputStyle} type="number" placeholder="HL" aria-label="Humanity loss"
              value={draft.hl} onChange={(e) => setDraft({ ...draft, hl: Number(e.target.value) || 0 })}
            />
            <input
              style={inputStyle} type="number" placeholder="eb" aria-label="Price in eddies"
              value={draft.cost ?? ''}
              onChange={(e) => setDraft({ ...draft, cost: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
          <input
            style={{ ...inputStyle, marginTop: 6 }} placeholder="Effect" aria-label="Effect"
            value={draft.data} onChange={(e) => setDraft({ ...draft, data: e.target.value })}
          />
          <ModEditor mods={draft.mods} onChange={(mods) => setDraft({ ...draft, mods })} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="utility-btn" onClick={() => setDraft(null)}>CANCEL</button>
            <button type="button" className="upload-btn" onClick={commitDraft} disabled={!draft.name.trim()}>ADD</button>
          </div>
        </div>
      ) : (
        <button type="button" className="utility-btn" style={{ marginTop: 8 }} onClick={() => setDraft(normaliseRow({}))}>
          + ADD CYBERWARE
        </button>
      ))}
    </DraggableWindow>
  );
}
