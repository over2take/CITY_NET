import React, { useEffect, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import type { CustomRenderSheet } from '../sheets/customTemplates';
import {
  sheetOf, fieldKind, pagesOf, sectionsOn, LAYOUTS, TYPES,
  withCustomized, withAutomatic, tabNameProblem, withNewTab, withTabName, withTabMoved, withoutTab,
  withNewSection, withSection, withSectionMoved, sectionRemoveProblem, withoutSection,
  withFieldMoved,
} from '../sheets/sheetDesigner';

// The builder's CHARACTER SHEET page (4b3c): the layout players' sheets are drawn with (approved
// mockup docs/mockups/builder-sheet.html, 2026-10-07). A system's sheet is AUTOMATIC, the server's
// starter sheet built from its stats, formulas and health model, until CUSTOMIZE copies that in to
// arrange by hand: tabs, then their sections, then fields, each picked on the left and set in the
// middle. What it reads and writes is sheets/sheetDesigner.ts; every change goes through the
// builder's `edit`, which autosaves it. Field settings, the tray and the preview come in 4b3d.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the starter sheet and the sheet as drawn (POST /api/systems/preview-sheet). */
  api?: ReturnType<typeof systemsApi>;
}

type Pick = { kind: 'tab' | 'section' | 'field'; id: string } | { kind: 'none' };

/** How long after the last change the sheet is asked for again; the first time, at once. */
export const SHEET_PREVIEW_DELAY_MS = 400;

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const mini: React.CSSProperties = { fontFamily: 'monospace', fontSize: 10, padding: '0 5px', lineHeight: '16px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px', minWidth: 0, boxSizing: 'border-box',
};
const danger: React.CSSProperties = { ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' };
const col: React.CSSProperties = { minHeight: 0, overflowY: 'auto', padding: 12, borderRight: '1px solid var(--dark-green)', fontSize: 12 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };
const segBtn = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '4px 9px', cursor: 'pointer',
});
const node = (on: boolean, indent: number): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', paddingLeft: 4 + indent * 14,
  border: `1px solid ${on ? 'var(--green)' : 'transparent'}`, background: on ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'none',
});
const nodeName: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'none', border: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: '2px 0',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const kindTag: React.CSSProperties = { fontSize: 9, letterSpacing: 1, opacity: 0.6, flexShrink: 0 };

/**
 * A name box that keeps what is typed while the builder won't store it (blank, or a tab name
 * already taken), showing why, so the GM fixes it in place.
 */
function NameBox({ value, aria, max, problem, onChange }: { value: string; aria: string; max: number; problem: (text: string) => string | null; onChange: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const why = problem(text);
  return (
    <>
      <input type="text" aria-label={aria} maxLength={max} value={text} style={{ ...input, ...(why ? { borderColor: 'var(--danger)' } : {}) }}
        aria-invalid={why ? true : undefined}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />
      {why && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{why}</span>}
    </>
  );
}

const blankProblem = (what: string) => (text: string) => (text.trim() ? null : `A ${what} needs a name.`);

export function SheetPage({ definition, edit, api }: Props) {
  const [preview, setPreview] = useState<{ sheet: CustomRenderSheet; starter: CustomRenderSheet } | null>(null);
  const [asked, setAsked] = useState(false);
  const [pick, setPick] = useState<Pick>({ kind: 'none' });
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmTab, setConfirmTab] = useState<string | null>(null);
  const [tabDest, setTabDest] = useState('');
  const [confirmSection, setConfirmSection] = useState<string | null>(null);

  // The starter and the sheet as drawn, from the server: at once the first time, then a moment
  // after the last change. A late answer never overwrites a newer one.
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewSheet(definition).then((r) => {
        if (live && r.ok) setPreview(r.value);
      });
      setAsked(true);
    }, asked ? SHEET_PREVIEW_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition]); // eslint-disable-line react-hooks/exhaustive-deps

  const own = sheetOf(definition);
  const sheet = own ?? preview?.sheet ?? null;
  const set = (next: Definition, nextPick?: Pick) => {
    edit(next);
    if (nextPick) setPick(nextPick);
    setConfirmTab(null);
    setConfirmSection(null);
  };
  const choose = (p: Pick) => { setPick(p); setConfirmTab(null); setConfirmSection(null); };

  // What the pick names, if it is still there.
  const pickedTab = own && pick.kind === 'tab' && own.tabs?.includes(pick.id) ? pick.id : null;
  const pickedSection = own && pick.kind === 'section' ? own.sections.find((s) => s.id === pick.id) ?? null : null;
  const pickedField = own && pick.kind === 'field' ? own.sections.flatMap((s) => s.fields).find((f) => f.id === pick.id) ?? null : null;

  const customize = () => {
    if (!preview) return;
    const next = withCustomized(definition, preview.starter);
    const first = sheetOf(next)!.sections[0];
    set(next, first ? { kind: 'section', id: first.id } : { kind: 'none' });
  };

  const fieldTag = (f: CustomRenderSheet['sections'][number]['fields'][number]) => {
    const kind = fieldKind(definition, f);
    if (kind === 'formula') return 'WORKED OUT';
    if (kind === 'linked') return 'LINKED';
    return TYPES.find((t) => t.id === f.type)?.label ?? f.type.toUpperCase();
  };

  const tree = sheet && (
    <div data-testid="sheet-tree">
      {pagesOf(sheet).map((tab, ti) => (
        <div key={tab ?? '(one page)'} style={{ marginTop: ti ? 10 : 0 }} role="group" aria-label={tab === null ? 'One page, no tabs' : `${tab} tab`}>
          {tab === null ? (
            <>
              <div style={{ ...node(false, 0), color: 'var(--green)', fontWeight: 'bold', letterSpacing: 1 }}>ONE PAGE · NO TABS</div>
              {own && <p style={{ ...why, fontSize: 11, margin: '2px 0 4px 14px' }}>Everything shows on one page. + TAB splits it into tabs again.</p>}
            </>
          ) : (
            <div style={{ ...node(pickedTab === tab, 0), color: 'var(--green)', fontWeight: 'bold', letterSpacing: 1 }}>
              {own ? <button type="button" style={nodeName} aria-label={`${tab} tab`} aria-current={pickedTab === tab || undefined} onClick={() => choose({ kind: 'tab', id: tab })}>{tab}</button>
                : <span style={{ ...nodeName, cursor: 'default' }}>{tab}</span>}
              {own && (
                <>
                  <button type="button" className="utility-btn" style={mini} aria-label={`Move the ${tab} tab up`} disabled={ti === 0} onClick={() => set(withTabMoved(definition, tab, -1))}>▲</button>
                  <button type="button" className="utility-btn" style={mini} aria-label={`Move the ${tab} tab down`} disabled={ti === pagesOf(sheet).length - 1} onClick={() => set(withTabMoved(definition, tab, 1))}>▼</button>
                </>
              )}
            </div>
          )}
          {sectionsOn(sheet, tab).map((s, si, list) => (
            <React.Fragment key={s.id}>
              <div style={node(pickedSection?.id === s.id, 1)}>
                {own ? <button type="button" style={nodeName} aria-label={`${s.label} section`} aria-current={pickedSection?.id === s.id || undefined} onClick={() => choose({ kind: 'section', id: s.id })}>{s.label}</button>
                  : <span style={{ ...nodeName, cursor: 'default' }}>{s.label}</span>}
                <span style={kindTag}>{LAYOUTS.find((l) => l.id === s.layout)?.label ?? s.layout.toUpperCase()}</span>
                {own && (
                  <>
                    <button type="button" className="utility-btn" style={mini} aria-label={`Move ${s.label} up`} disabled={si === 0} onClick={() => set(withSectionMoved(definition, s.id, -1))}>▲</button>
                    <button type="button" className="utility-btn" style={mini} aria-label={`Move ${s.label} down`} disabled={si === list.length - 1} onClick={() => set(withSectionMoved(definition, s.id, 1))}>▼</button>
                  </>
                )}
              </div>
              {s.fields.map((f, fi) => (
                <div key={f.id} style={{ ...node(pickedField?.id === f.id, 2), opacity: 0.9 }}>
                  {own ? <button type="button" style={nodeName} aria-label={`${f.label} field`} aria-current={pickedField?.id === f.id || undefined} onClick={() => choose({ kind: 'field', id: f.id })}>{f.label}</button>
                    : <span style={{ ...nodeName, cursor: 'default' }}>{f.label}</span>}
                  <span style={kindTag}>{fieldTag(f)}</span>
                  {own && (
                    <>
                      <button type="button" className="utility-btn" style={mini} aria-label={`Move ${f.label} up`} disabled={fi === 0} onClick={() => set(withFieldMoved(definition, f.id, -1))}>▲</button>
                      <button type="button" className="utility-btn" style={mini} aria-label={`Move ${f.label} down`} disabled={fi === s.fields.length - 1} onClick={() => set(withFieldMoved(definition, f.id, 1))}>▼</button>
                    </>
                  )}
                </div>
              ))}
            </React.Fragment>
          ))}
          {own && (
            <div style={{ paddingLeft: 18, marginTop: 3 }}>
              <button type="button" className="utility-btn" style={mini} aria-label={tab === null ? 'Add a section' : `Add a section to ${tab}`}
                onClick={() => {
                  const next = withNewSection(definition, tab);
                  set(next, { kind: 'section', id: sheetOf(next)!.sections.at(-1)!.id });
                }}>+ SECTION</button>
            </div>
          )}
        </div>
      ))}
      {own && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="utility-btn" style={btn} disabled={(own.tabs?.length ?? 0) >= 12}
            title={(own.tabs?.length ?? 0) >= 12 ? 'A sheet has at most 12 tabs.' : undefined}
            onClick={() => {
              const next = withNewTab(definition);
              set(next, { kind: 'tab', id: sheetOf(next)!.tabs!.at(-1)! });
            }}>+ TAB</button>
        </div>
      )}
    </div>
  );

  const tabSettings = pickedTab && own && (() => {
    const tab = pickedTab;
    const secs = sectionsOn(own, tab);
    const others = (own.tabs ?? []).filter((t) => t !== tab);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }} data-testid="tab-settings">
        <span style={small}>TAB</span>
        <label style={label}>
          <span style={small}>NAME</span>
          <NameBox value={tab} aria="Tab name" max={20} problem={(text) => tabNameProblem(definition, tab, text)}
            onChange={(text) => {
              if (tabNameProblem(definition, tab, text)) return;
              set(withTabName(definition, tab, text), { kind: 'tab', id: text.trim() });
            }} />
        </label>
        <span style={why}>{secs.length} section{secs.length === 1 ? '' : 's'}.</span>
        {confirmTab !== tab ? (
          <div><button type="button" className="utility-btn" style={btn} onClick={() => { setConfirmTab(tab); setTabDest(others[0] ?? ''); }}>REMOVE TAB</button></div>
        ) : (
          <div role="group" aria-label={`Remove ${tab}`} style={{ border: '1px solid var(--danger)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {others.length === 0 ? (
              <span style={why}>{tab} is the last tab. Removed, the sheet becomes one page with no tabs{secs.length ? `, its ${secs.length} section${secs.length === 1 ? '' : 's'} staying in order` : ''}.</span>
            ) : (
              <>
                <span style={why}>Remove {tab}?{secs.length ? ` Its ${secs.length} section${secs.length === 1 ? '' : 's'} (${secs.map((s) => s.label).join(', ')}) move to:` : ' It has no sections.'}</span>
                {secs.length > 0 && (
                  <select aria-label="Move its sections to" value={tabDest} style={input} onChange={(e) => setTabDest(e.target.value)}>
                    {others.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="utility-btn" style={danger}
                onClick={() => {
                  const dest = others.includes(tabDest) ? tabDest : others[0];
                  set(withoutTab(definition, tab, dest), dest ? { kind: 'tab', id: dest } : { kind: 'none' });
                }}>{others.length ? `REMOVE ${tab}` : 'MAKE IT ONE PAGE'}</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmTab(null)}>KEEP IT</button>
            </div>
          </div>
        )}
      </div>
    );
  })();

  const sectionSettings = pickedSection && own && (() => {
    const s = pickedSection;
    const blocked = sectionRemoveProblem(definition, s.id);
    const ownFields = s.fields.filter((f) => fieldKind(definition, f) === 'plain' && !(preview?.starter.sections.some((x) => x.fields.some((y) => y.id === f.id))));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }} data-testid="section-settings">
        <span style={small}>SECTION</span>
        <label style={label}>
          <span style={small}>NAME</span>
          <NameBox key={s.id} value={s.label} aria="Section name" max={60} problem={blankProblem('section')}
            onChange={(text) => set(withSection(definition, s.id, { label: text }))} />
        </label>
        {own.tabs && own.tabs.length > 0 && (
          <label style={label}>
            <span style={small}>ON TAB</span>
            <select aria-label="On tab" value={s.tab ?? ''} style={input} onChange={(e) => set(withSection(definition, s.id, { tab: e.target.value }))}>
              {own.tabs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
        <div role="group" aria-label="Looks like" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={small}>LOOKS LIKE</span>
          <span style={{ display: 'inline-flex', border: '1px solid var(--green)', alignSelf: 'flex-start' }}>
            {LAYOUTS.map((l) => (
              <button key={l.id} type="button" style={segBtn(s.layout === l.id)} aria-pressed={s.layout === l.id}
                onClick={() => set(withSection(definition, s.id, { layout: l.id }))}>{l.label}</button>
            ))}
          </span>
        </div>
        {s.layout === 'grid' && (
          <label style={label}>
            <span style={small}>COLUMNS</span>
            <input type="number" min={1} max={8} aria-label="Columns" value={s.columns ?? 1} style={{ ...input, width: 70 }}
              onChange={(e) => { if (e.target.value.trim() !== '') set(withSection(definition, s.id, { columns: Number(e.target.value) })); }} />
          </label>
        )}
        {confirmSection !== s.id ? (
          <div>
            <button type="button" className="utility-btn" style={btn} disabled={!!blocked} title={blocked ?? undefined}
              onClick={() => { if (s.fields.length) setConfirmSection(s.id); else set(withoutSection(definition, s.id), s.tab ? { kind: 'tab', id: s.tab } : { kind: 'none' }); }}>
              REMOVE SECTION
            </button>
            {blocked && <p style={{ ...why, fontSize: 11, margin: '4px 0 0' }}>{blocked}</p>}
          </div>
        ) : (
          <div role="group" aria-label={`Remove ${s.label}`} style={{ border: '1px solid var(--danger)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={why}>
              Remove {s.label}? Stats, formulas and the starter&apos;s fields on it go back to NOT ON THE SHEET YET
              {ownFields.length ? `; its own fields (${ownFields.map((f) => f.label).join(', ')}) go with it.` : '.'}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="utility-btn" style={danger}
                onClick={() => set(withoutSection(definition, s.id), s.tab ? { kind: 'tab', id: s.tab } : { kind: 'none' })}>REMOVE {s.label}</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmSection(null)}>KEEP IT</button>
            </div>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div data-testid="sheet-page" style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', border: '1px solid var(--dark-green)' }}>
        {own ? (
          <>
            <span style={{ ...small, color: 'var(--cyan)', opacity: 1 }}>CUSTOMIZED</span>
            <span style={why}>Your own layout.</span>
            <span style={{ flex: 1 }} />
            {confirmReset ? (
              <>
                <span style={why}>Throw your layout away and go back to the automatic sheet?</span>
                <button type="button" className="utility-btn" style={danger} onClick={() => { setConfirmReset(false); set(withAutomatic(definition), { kind: 'none' }); }}>BACK TO AUTOMATIC</button>
                <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmReset(false)}>KEEP MINE</button>
              </>
            ) : (
              <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmReset(true)}>BACK TO AUTOMATIC</button>
            )}
          </>
        ) : (
          <>
            <span style={{ ...small, opacity: 1 }}>AUTOMATIC</span>
            <span style={why}>The starter sheet, built from your stats, formulas and health model.</span>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 360, display: 'grid', gridTemplateColumns: '280px minmax(0, 320px)', border: '1px solid var(--dark-green)' }}>
        <div style={col} className="cyber-scroll">
          {tree ?? <p style={why}>LOADING…</p>}
        </div>
        <div style={col} className="cyber-scroll">
          {!own ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <p style={{ ...why, margin: 0 }}>
                The starter sheet arranges itself from your stats, formulas and health model. CUSTOMIZE copies it so you can change its tabs, sections and fields.
              </p>
              <div>
                <button type="button" className="utility-btn" style={{ ...btn, background: 'var(--green)', color: 'var(--black)' }} disabled={!preview} onClick={customize}>
                  CUSTOMIZE THIS SHEET
                </button>
              </div>
            </div>
          ) : tabSettings || sectionSettings || (pickedField ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="field-settings">
              <span style={small}>FIELD <span style={{ opacity: 0.6 }}>@{pickedField.id}</span></span>
              <b style={{ color: 'var(--green)' }}>{pickedField.label}</b>
              <span style={why}>{fieldTag(pickedField)}. Settings for fields arrive in the next update; ▲ ▼ move it.</span>
            </div>
          ) : (
            <p style={{ ...why, margin: 0 }}>Pick a tab, section or field on the left, or add one.</p>
          ))}
        </div>
      </div>
    </div>
  );
}
