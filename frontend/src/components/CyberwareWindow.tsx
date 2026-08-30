import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import bodySvg from '../assets/body.svg?raw';
import {
  typesFor, typeById, wiredPanels, unwiredPanels, drawnFigureBox,
  type Side, type Panel,
} from '../sheets/cyberwareLocations';
import {
  CYBERWARE_FIELD, readRows, normaliseRow, totalHumanityLoss, totalCost,
  rowLocation, rowsForPanel, needsPlacing, panelRank, describeMod, isSetKind, isNoteKind,
  MOD_KINDS, MOD_KIND_LABEL,
  type CyberRow, type CyberMod, type ModKind,
} from '../sheets/cyberwareRows';
import type { SheetFieldValue, SheetTemplate } from '../sheets/types';
import { targetOptions } from '../sheets/modTargets';
import { CWN_CYBERWARE, cyberById } from '../sheets/cwnCyberwarePresets';

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
  /** The system's sheet, which is where the modifier pickers get their stats and skills. */
  template?: SheetTemplate;
  readOnly?: boolean;
  onFieldChange: (fieldId: string, value: SheetFieldValue) => void;
  onClose: () => void;
  /** Whose chrome this is, for the title bar. */
  who?: string;
}

/**
 * Which system's install categories to offer.
 *
 * Taken from the template rather than a prop of its own: the template id *is* the system
 * key, and the window already needs the template for the modifier pickers.
 */
const systemOf = (template?: SheetTemplate): string => template?.id ?? '';

/**
 * What each system calls the two costs a piece carries.
 *
 * One stored number apiece, two vocabularies. Cyberpunk RED spends Humanity and prices in
 * eurodollars; Cities Without Number spends System Strain and prices in credits. Printing
 * "HUMANITY LOSS" over a CWN sheet names a stat that system does not have, and the column
 * headings are the same problem in three characters.
 */
const WORDS: Record<string, { cost: string; costShort: string; money: string }> = {
  cyberpunk_red: { cost: 'HUMANITY LOSS', costShort: 'HL', money: 'eb' },
  cities_without_number: { cost: 'STRAIN', costShort: 'STR', money: 'cr' },
};

const wordsFor = (system: string) => WORDS[system] ?? { cost: 'COST', costShort: 'COST', money: '' };

const mono = (size: number): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: size, letterSpacing: 1,
});

const inputStyle: React.CSSProperties = {
  background: 'var(--black)', border: '1px solid var(--dark-green)', color: 'var(--green)',
  fontFamily: 'monospace', fontSize: 11, padding: '3px 5px', width: '100%',
};

type SortKey = 'name' | 'location' | 'hl' | 'cost';

/** What the amount column is asking for, which depends on what the modifier does. */
const amountHeading = (mod: CyberMod): string => {
  if (isNoteKind(mod.kind)) return 'VALUE';
  return isSetKind(mod.kind) ? 'TO' : 'BY';
};

/**
 * A row being typed in, where the humanity loss box is allowed to be empty.
 *
 * A stored row's `hl` is always a number, because an import states it and 0 there means
 * zero. A box being filled in is a different thing: starting it at 0 shows a value nobody
 * entered, and — since a placeholder only appears when a field is empty — leaves the
 * narrow box unlabelled next to one that does say "eb". Empty until typed in, and
 * normaliseRow turns it back into 0 on the way to storage.
 */
type Draft = Omit<CyberRow, 'hl'> & { hl: number | '' };

/** A blank form, optionally knowing where it is going to be installed. */
const newDraft = (partial: Partial<CyberRow> = {}): Draft =>
  ({ ...normaliseRow(partial), hl: '' });

/**
 * A form control with a heading over it.
 *
 * A heading rather than a placeholder, because a placeholder is gone the moment you type
 * into the box — which is exactly when you might want to check what the box was for. It
 * also cannot appear at all on a field that starts with a value in it, which is what left
 * the humanity box reading as a bare 0 with nothing to say it was humanity.
 *
 * The `aria-label` on the control stays: it is the accessible name, and these headings are
 * abbreviated for a narrow column.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ ...mono(9), color: 'var(--grid-section)', display: 'block', marginBottom: 2 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

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
          title={isNoteKind(m.kind)
            ? 'Shown for reference — the app does not apply this'
            : MOD_KIND_LABEL[m.kind]}
          style={{
            ...mono(10), letterSpacing: 0, padding: '0 4px', whiteSpace: 'nowrap',
            border: '1px solid var(--dark-green)',
            // A note is there to be read, not applied, so it does not wear the colour the
            // numbers that change your rolls wear.
            color: isNoteKind(m.kind) ? 'var(--green)' : 'var(--cyan)',
            borderStyle: isNoteKind(m.kind) ? 'dashed' : 'solid',
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
 * The target is a picker built from the sheet template, so it offers this system's stats
 * and this system's skills — see sheets/modTargets. A typed name could be a typo or a
 * skill from a different game; a chosen one is neither.
 */
function ModEditor({ mods, template, onChange }: {
  mods: CyberMod[];
  template?: SheetTemplate;
  onChange: (next: CyberMod[]) => void;
}) {
  const patch = (i: number, change: Partial<CyberMod>) =>
    onChange(mods.map((m, n) => (n === i ? { ...m, ...change } : m)));

  /**
   * Switching what a modifier changes clears what it pointed at, unless the new list
   * still has it. A skill named Business and a stat named Business are not the same
   * target, and keeping the old text would leave a modifier aimed at nothing.
   */
  const changeKind = (i: number, kind: ModKind) => {
    const target = mods[i].target;
    const kept = targetOptions(kind, template).some((o) => o.value === target);
    patch(i, { kind, target: kept ? target : '' });
  };

  const cols = '1.2fr 1.3fr 0.5fr 20px';

  return (
    <div style={{ marginTop: 6 }}>
      {/* Once above the list rather than per line: the columns do not change meaning as
          modifiers are added, and repeating them would read as three separate forms. */}
      {mods.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: cols, gap: 6, marginBottom: 2,
          ...mono(9), color: 'var(--grid-section)',
        }}>
          <span>MODIFIES</span><span>WHAT</span>
          {/* BY for an adjustment, TO for a replacement — the column means a different
              thing in each case, and one heading for both reads as a lie in one of them.
              A list holding both says so rather than picking a side. */}
          {/* The column means a different thing per kind — adjust by, replace with, or
              simply a value to read — so a mixed list names every meaning in it rather
              than picking one and being wrong about the others. */}
          <span style={{ textAlign: 'right' }}>
            {[...new Set(mods.map(amountHeading))].join(' / ')}
          </span>
          <span />
        </div>
      )}
      {mods.map((m, i) => (
        <div
          key={i}
          style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, marginBottom: 4 }}
        >
          <select
            style={inputStyle} aria-label={`Modifier ${i + 1} kind`} value={m.kind}
            onChange={(e) => changeKind(i, e.target.value as ModKind)}
          >
            {MOD_KINDS.map((k) => <option key={k} value={k}>{MOD_KIND_LABEL[k]}</option>)}
          </select>
          {isNoteKind(m.kind) ? (
            // Typed rather than chosen: a note names whatever the table needs to see, and
            // there is no list of those.
            <input
              style={inputStyle} placeholder="Quickhack DV"
              aria-label={`Modifier ${i + 1} target`} value={m.target}
              onChange={(e) => patch(i, { target: e.target.value })}
            />
          ) : (
            <select
              style={inputStyle} aria-label={`Modifier ${i + 1} target`} value={m.target}
              onChange={(e) => patch(i, { target: e.target.value })}
            >
              <option value="">—</option>
              {targetOptions(m.kind, template, m.target)
                .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <input
            style={{ ...inputStyle, textAlign: 'right' }} type="number"
            aria-label={`Modifier ${i + 1} value`} value={m.value}
            onChange={(e) => patch(i, { value: Number(e.target.value) || 0 })}
          />
          <button
            type="button" aria-label={`Remove modifier ${i + 1}`}
            onClick={() => onChange(mods.filter((_, n) => n !== i))}
            style={{ ...mono(11), background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 0 }}
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

export function CyberwareWindow({ data, template, readOnly, onFieldChange, onClose, who }: Props) {
  const [pos, setPos] = useState({ x: 90, y: 60 });
  const rows = useMemo(() => readRows(data), [data]);
  const system = systemOf(template);
  const types = useMemo(() => typesFor(system), [system]);
  const words = wordsFor(system);
  // Sorted by where it goes, then by name, which is how someone hunts for a piece.
  const catalogue = useMemo(
    () => (system === 'cities_without_number'
      ? [...CWN_CYBERWARE].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      : []),
    [system],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const [wires, setWires] = useState<React.ReactNode[]>([]);

  const [sortKey, setSortKey] = useState<SortKey>('location');
  const [asc, setAsc] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  /**
   * The row the form is editing, or null when it is adding a new one.
   *
   * Held by identity rather than index, like every other row operation here: the table is
   * sorted, so a position on screen is not a position in the stored array.
   */
  const [editing, setEditing] = useState<CyberRow | null>(null);
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

      wiredPanels(system).forEach((panel) => {
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

  const closeForm = () => { setDraft(null); setEditing(null); };

  /** Open the form on a piece that already exists, rather than on a blank one. */
  const editRow = (row: CyberRow) => {
    setPlacing(null);
    setEditing(row);
    setDraft({ ...row });
  };

  const commitDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return;
    // Through the normaliser rather than stored as typed: a "+ MODIFIER" line the player
    // added and then left blank is not a modifier, and normaliseRow already drops those.
    const row = normaliseRow({ ...draft, name });

    if (editing) {
      // Replaced in place, so an edit keeps the piece where it is in the list rather than
      // moving it to the end as a delete-and-re-add would.
      const i = rows.indexOf(editing);
      if (i >= 0) write([...rows.slice(0, i), row, ...rows.slice(i + 1)]);
    } else {
      write([...rows, row]);
    }
    closeForm();
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
    else setDraft(newDraft({ type: panel.typeId, side: panel.side, placed: true }));
  };

  /**
   * Take a piece out of the body part it is in, without throwing it away.
   *
   * Distinct from removing it: uninstalling chrome and never having owned it are different
   * things, and the table's × does the second. This puts it back among the unplaced, where
   * it can be filed somewhere else.
   */
  /**
   * Take a piece out of the body without forgetting what it is.
   *
   * What a piece *is* was answered in the list, and taking it out of an eye does not make
   * it stop being a Cybereye — clearing the type threw away something the player had
   * typed, and they had to say it again to put it back.
   *
   * A paired type keeps its type and loses only its side, which is exactly the state a
   * piece is in before anyone has chosen a socket. An unpaired type has no side to lose:
   * for those the type *is* the placement, so it has to go or the piece could never leave.
   */
  const unfile = (row: CyberRow) => {
    const i = rows.indexOf(row);
    if (i < 0) return;
    const next = [...rows];
    // The type survives, whatever it is. Taking a Light Tattoo off does not make it stop
    // being Fashionware any more than taking an eye out stops it being a Cybereye — and
    // the piece is unplaced because `placed` says so, not because the type went missing.
    next[i] = { ...row, side: null, placed: false };
    write(next);
  };

  /**
   * Say what a piece is, without saying where it goes.
   *
   * The two are separate decisions and only the second one needs the body diagram. An
   * import knows neither, so leaving typing to placement meant nothing in the list could
   * ever describe itself — every piece read Unfiled until someone dropped it on a limb.
   *
   * A side that the new type cannot have is dropped, and a paired type keeps the side it
   * had: retyping a Cyberarm R to a Cyberleg leaves it on the right.
   */
  const retype = (row: CyberRow, typeId: string) => {
    const i = rows.indexOf(row);
    if (i < 0) return;
    const next = [...rows];
    // Placement is left exactly as it was. Naming a type says what a piece is; the body
    // diagram is what puts it somewhere, and one should never quietly do the other's job.
    next[i] = { ...row, type: typeId, side: typeById(typeId)?.paired ? row.side : null };
    write(next);
  };

  /** Move a piece already on the sheet into the panel that asked for it. */
  const fileInto = (row: CyberRow, panel: Panel) => {
    const i = rows.indexOf(row);
    if (i < 0) return;
    const next = [...rows];
    next[i] = { ...row, type: panel.typeId, side: panel.side, placed: true };
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
  // Includes a paired type nobody has picked a side for: a Cybereye that is not in an eye
  // yet appears in neither panel, so it has to read as unplaced or it vanishes.
  const unfiledRows = rows.filter(needsPlacing);

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
            <span>{r.name} <span style={{ color: 'var(--grid-section)' }}>{words.costShort} {r.hl}</span></span>
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

  // The figure's own right hangs down the left of the screen, so paired panels sort by
  // side. The unpaired ones sit on the midline and belong to neither column, so they
  // alternate to keep the two sides even — which for Cyberpunk RED puts Cyberaudio left
  // and the Neural Link right, exactly where a hardcoded rule used to put them.
  const wired = wiredPanels(system);
  let midlineSeen = 0;
  const left = wired.filter((p) => (p.side === 'r' ? true : p.side === null && midlineSeen++ % 2 === 0));
  const right = wired.filter((p) => !left.includes(p));

  return (
    <>
      <style>{`
        /* Scoped here because this list scrolls itself: a container inside a window does
           not inherit the window's scrollbar styling, so without this it draws the
           browser's own, which is wider and sits over the row buttons. */
        .cyber-scroll { scrollbar-width: thin; scrollbar-color: var(--dark-green) var(--black); }
        .cyber-scroll::-webkit-scrollbar { width: 8px; }
        .cyber-scroll::-webkit-scrollbar-track { background: var(--black); }
        .cyber-scroll::-webkit-scrollbar-thumb { background: var(--dark-green); border: 1px solid var(--green); }
      `}</style>
    <DraggableWindow
      title={who ? `AUGMENTATION — ${who.toUpperCase()}` : 'AUGMENTATION'}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: 760, maxWidth: '95vw' }}
      contentStyle={{ maxHeight: '80vh', overflowY: 'auto' }}
    >
      <div style={{ ...mono(10), color: 'var(--cyan)', display: 'flex', justifyContent: 'space-between', paddingBottom: 6 }}>
        {/* Installed means installed *somewhere*, so it counts the placed pieces rather
            than every row. Counting all of them read "9 INSTALLED · 9 UNFILED", which says
            two contradictory things about the same nine pieces. */}
        <span>
          {rows.length - unfiledRows.length} INSTALLED
          {unfiledRows.length ? ` · ${unfiledRows.length} UNFILED` : ''}
        </span>
        <span>{words.cost} {hl}{spent > 0 ? ` · ${spent.toLocaleString()}${words.money}` : ''}</span>
      </div>

      {!readOnly && placing && (
        <div ref={placingRef} style={{ marginBottom: 8, border: '1px solid var(--cyan)', padding: 7 }}>
          <div style={{ ...mono(9), color: 'var(--cyan)', paddingBottom: 4 }}>
            PUT SOMETHING IN {placing.label.toUpperCase()}
          </div>
          {[...unfiledRows]
            // Likely matches first, by name. Only an ordering — the export never says
            // where a piece went, so nothing here decides for you.
            .sort((a, b) => panelRank(b, placing.typeId) - panelRank(a, placing.typeId))
            .map((r, i) => {
              const fits = panelRank(r, placing.typeId) > 0;
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
                  <span style={{ color: 'var(--grid-section)' }}> {words.costShort} {r.hl}</span>
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
                setDraft(newDraft({ type: placing.typeId, side: placing.side, placed: true }));
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
        {unwiredPanels(system).map(panelBox)}
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
          // The table scrolls itself rather than through the window, so it never picked
          // up the themed scrollbar and was drawing the browser's default 17px one over
          // the last column, which is where the edit and remove buttons live.
          <div className="cyber-scroll" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--dark-green)', paddingRight: 6 }}>
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
                  {([['name', 'NAME'], ['location', 'TYPE'], ['hl', words.costShort], ['cost', words.money.toUpperCase()]] as [SortKey, string][])
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
                      /* Placed, not merely typed: a Cyberleg not yet put in a leg is still
                         waiting, and a filled dot beside it claims otherwise. */
                      title={needsPlacing(r) ? 'Not yet placed — use + on a body part' : rowLocation(r)}
                      style={{ padding: '3px 4px 3px 6px', textAlign: 'center', ...mono(12) }}
                    >
                      <span style={{ color: needsPlacing(r) ? 'color-mix(in srgb, var(--green) 75%, transparent)' : 'var(--green)' }}>
                        {needsPlacing(r) ? '◌' : '●'}
                      </span>
                    </td>
                    <td style={{ ...mono(11), color: 'var(--cyan)', padding: '3px 6px', letterSpacing: 0 }}>{r.name}</td>
                    <td style={{ ...mono(11), padding: '3px 6px', letterSpacing: 0 }}>
                      {readOnly ? (
                        <span style={{ color: r.type ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)' }}>
                          {rowLocation(r)}
                        </span>
                      ) : (
                        // Editable here, not only by placing the piece on the body. An
                        // import carries no install location, so every piece arrives
                        // Unfiled — and if placing were the only way to set a type, then
                        // nothing in the list could ever say what it was before it was
                        // placed. Saying "this is a Cyberleg" and choosing which leg are
                        // two decisions, and this is the first one.
                        <select
                          aria-label={`Install type for ${r.name}`}
                          value={r.type}
                          onChange={(e) => retype(r, e.target.value)}
                          style={{
                            ...mono(11), letterSpacing: 0, padding: 0, width: '100%',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: r.type ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)',
                          }}
                        >
                          <option value="">Unfiled</option>
                          {/* The type, never the placement. This column is what the piece
                              *is*, which the player set and installing does not change;
                              showing "Cybereye L" here read as the type having been
                              rewritten by putting it in an eye. Which eye is a fact about
                              the body, and the diagram is where the body is. */}
                          {types.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={{ ...mono(11), color: 'var(--cyan)', padding: '3px 6px', textAlign: 'right' }}>{r.hl}</td>
                    <td style={{ ...mono(11), color: r.cost === null ? 'var(--dark-green)' : 'var(--cyan)', padding: '3px 6px', textAlign: 'right' }}>
                      {r.cost === null ? '—' : r.cost.toLocaleString()}
                    </td>
                    <td style={{ ...mono(11), color: 'var(--grid-section)', padding: '3px 6px', letterSpacing: 0 }}>
                      {r.data && <span style={{ marginRight: r.mods.length ? 6 : 0 }}>{r.data}</span>}
                      <ModChips mods={r.mods} />
                    </td>
                    {!readOnly && (
                      <td style={{ padding: '3px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {/* Anything on this list can be wrong: a name mistyped, a cost
                            guessed, an effect that turned out to do something else. */}
                        <button
                          type="button"
                          onClick={() => editRow(r)}
                          aria-label={`Edit ${r.name}`}
                          title="Edit this piece"
                          style={{ ...mono(10), background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', padding: '0 4px 0 0' }}
                        >✎</button>
                        <button
                          type="button"
                          onClick={() => removeRow(r)}
                          aria-label={`Remove ${r.name}`}
                          style={{ ...mono(11), background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 0 }}
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
          {/* Fill the form from the book rather than typing six fields off a page. Only
              where there is a catalogue to offer - Cyberpunk RED has none, and an empty
              picker is worse than no picker. Everything it fills stays editable: a piece
              can be modified, salvaged or house-ruled, and the entry is a starting point
              rather than a contract. */}
          {catalogue.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <Field label="FROM THE BOOK">
                <select
                  style={inputStyle}
                  aria-label="Pick from catalogue"
                  value=""
                  onChange={(e) => {
                    const preset = cyberById(e.target.value);
                    if (!preset) return;
                    setDraft({
                      ...draft,
                      name: preset.name,
                      // Keep where it is going if the form was opened from a body panel:
                      // the book says which kind of slot a piece needs, not which arm.
                      type: draft.type || preset.type,
                      hl: preset.strain,
                      cost: preset.price,
                      conc: preset.conc,
                      data: preset.effect,
                      mods: (preset.mods ?? []).map((m) => ({ ...m })),
                    });
                  }}
                >
                  <option value="">— pick a piece to fill the form —</option>
                  {catalogue.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.type.toUpperCase()} · {c.strain} · {c.price.toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.6fr 0.7fr', gap: 6 }}>
            <Field label="NAME">
              <input
                autoFocus style={inputStyle} aria-label="Cyberware name"
                value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="LOCATION">
              <select
                style={inputStyle} aria-label="Install type" value={draft.type}
                onChange={(e) => {
                  const t = typeById(e.target.value);
                  // Drop a side the new type cannot have, rather than leaving a Fashionware
                  // marked R because it used to be an arm.
                  setDraft({ ...draft, type: e.target.value, side: t?.paired ? draft.side : null });
                }}
              >
                <option value="">Unfiled</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="HUMANITY">
              <input
                style={inputStyle} type="number" aria-label="Humanity loss" value={draft.hl}
                onChange={(e) => setDraft({ ...draft, hl: e.target.value === '' ? '' : Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="EDDIES">
              <input
                style={inputStyle} type="number" aria-label="Price in eddies"
                value={draft.cost ?? ''}
                onChange={(e) => setDraft({ ...draft, cost: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </div>
          <div style={{ marginTop: 6 }}>
            <Field label="EFFECT">
              <input
                style={inputStyle} aria-label="Effect"
                value={draft.data} onChange={(e) => setDraft({ ...draft, data: e.target.value })}
              />
            </Field>
          </div>
          <ModEditor mods={draft.mods} template={template} onChange={(mods) => setDraft({ ...draft, mods })} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="utility-btn" onClick={closeForm}>CANCEL</button>
            <button type="button" className="upload-btn" onClick={commitDraft} disabled={!draft.name.trim()}>
              {editing ? 'SAVE' : 'ADD'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="utility-btn" style={{ marginTop: 8 }} onClick={() => { setEditing(null); setDraft(newDraft()); }}>
          + ADD CYBERWARE
        </button>
      ))}
    </DraggableWindow>
    </>
  );
}
