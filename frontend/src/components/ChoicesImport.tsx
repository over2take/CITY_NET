import React, { useRef, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import type { ChoiceList } from '../sheets/choices';
import {
  MAX_BYTES, exampleFile, listFile, fileName, withImported, lineRange, partText, addedFeatureText, type ImportPreview,
} from '../sheets/choicesImport';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { downloadText } from '../utils/downloadText';

// IMPORT on a CHOICES list (choices import 2; approved mockup docs/mockups/choices-import.html,
// 2026-10-28): over the list and option columns, a file of options and features pasted or uploaded,
// read by the server (PREVIEW) and put into the draft (APPLY) only for the text previewed. Mistakes
// are warned of by line, as the user asked: named at the top, each a link selecting its line, and
// marked beside the text. What it reads and writes is sheets/choicesImport.ts.

interface Props {
  definition: Definition;
  list: ChoiceList;
  api?: ReturnType<typeof systemsApi>;
  edit: (next: Definition) => void;
  onClose: () => void;
  /** After APPLY: the ids it added, and what to say. */
  onApplied: (added: string[], message: string) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const link: React.CSSProperties = { background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' };
/** The text box's and its line numbers' line height, which must agree for the marks to line up. */
const LINE = 18;
const lines: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12, lineHeight: `${LINE}px`, padding: '6px 8px', margin: 0, boxSizing: 'border-box' };

const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`;
const idsOf = (list: ChoiceList) => list.options.flatMap((o) => [o.id, ...(Array.isArray(o.features) ? o.features : [])
  .map((f) => (f && typeof f === 'object' ? (f as { id?: unknown }).id : null)).filter((id): id is string => typeof id === 'string')]);

function Group({ title, items, tone }: { title: string; items: React.ReactNode[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div role="group" aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={small}>{title}</span>
      {items.map((item, i) => <span key={i} style={{ color: tone, fontSize: 12, lineHeight: 1.45 }}>{item}</span>)}
    </div>
  );
}

export function ChoicesImport({ definition, list, api, edit, onClose, onApplied }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /** The text that preview was of: APPLY is offered only while the box still matches it. */
  const [previewed, setPreviewed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const many = (list.many || list.id).toUpperCase();
  const tooBig = new Blob([text]).size > MAX_BYTES;
  const stale = previewed !== null && previewed !== text;
  const current = preview && !stale ? preview : null;
  const skipped = current?.skipped ?? [];
  const bad = new Map(skipped.map((s) => [s.line, s.message]));
  const canApply = !!current && current.changes > 0 && !busy;

  const change = (next: string) => { setText(next); setMessage(null); };
  const runPreview = async () => {
    if (!api || !text.trim() || tooBig) return;
    setBusy(true);
    setMessage(null);
    const r = await api.importChoices(definition, list.id, text);
    setBusy(false);
    if (!r.ok) { setPreview(null); setPreviewed(null); setMessage(r.error); return; }
    setPreview(r.value);
    setPreviewed(text);
  };
  const apply = () => {
    if (!current || !canApply) return;
    const before = new Set(idsOf(list));
    edit(withImported(definition, current.list));
    onApplied(idsOf(current.list).filter((id) => !before.has(id)),
      `APPLIED · ${plural(current.changes, 'CHANGE')} IN THE DRAFT${skipped.length ? `, ${plural(skipped.length, 'LINE')} SKIPPED` : ''} · SAVED WITH IT, LIVE ON PUBLISH`);
  };
  const goTo = (line: number) => {
    const el = box.current;
    if (!el) return;
    const { from, to } = lineRange(text, line);
    el.focus();
    el.setSelectionRange(from, to);
    el.scrollTop = Math.max(0, (line - 4) * LINE);
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { setMessage(`That file is ${Math.round(f.size / 1000)} KB. Split it into files of under ${MAX_BYTES / 1000} KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => { change(String(reader.result ?? '')); setPreview(null); setPreviewed(null); };
    reader.readAsText(f);
  };
  const lineLink = (line: number) => (
    <button key={line} type="button" style={link} aria-label={`Go to line ${line}`} onClick={() => goTo(line)}>{`line ${line}`}</button>
  );

  return (
    <section aria-label={`Import ${list.many || list.id}`} style={{ gridColumn: '2 / -1', border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <FieldName hint={HINTS['choices.import']} style={small}>IMPORT · {many}</FieldName>
        <button type="button" className="utility-btn" style={btn} onClick={onClose}>CLOSE</button>
      </div>
      <p style={why}>
        Options and their features for {many}, matched by name: a name already here is updated, a new one is added, and nothing is
        deleted. Words, {list.levelled ? 'levels, ' : ''}requirements and uses come from the file; what else a feature does stays as
        the builder has it. There is no undo, so download this list first to keep a copy.
      </p>
      <div style={row}>
        <button type="button" className="utility-btn" style={btn} title="What this list holds now, to keep as a copy or edit and import back"
          onClick={() => downloadText(fileName(definition, list, 'list'), listFile(definition, list))}>DOWNLOAD THIS LIST</button>
        <button type="button" className="utility-btn" style={btn} title={`A file in the right shape for ${many}, with made-up rows to replace`}
          onClick={() => downloadText(fileName(definition, list, 'example'), exampleFile(definition, list))}>DOWNLOAD EXAMPLE</button>
        <button type="button" className="utility-btn" style={btn} onClick={() => file.current?.click()}>UPLOAD FILE</button>
        <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-label="File to import" style={{ display: 'none' }}
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', border: '1px solid var(--dark-green)', height: 280, resize: 'vertical', overflow: 'hidden' }}>
        <div ref={gutter} aria-hidden="true" data-testid="import-gutter"
          style={{ ...lines, overflow: 'hidden', borderRight: '1px solid var(--dark-green)', color: 'var(--green)', opacity: 0.85, userSelect: 'none', textAlign: 'right' }}>
          {text.split('\n').map((_, i) => {
            const mistake = bad.get(i + 1);
            return (
              <div key={i} title={mistake} data-bad={mistake ? 'true' : undefined}
                style={mistake ? { background: 'var(--warning)', color: 'var(--black)', padding: '0 2px' } : { opacity: 0.55, padding: '0 2px' }}>
                {mistake ? '!' : ''}{i + 1}
              </div>
            );
          })}
        </div>
        <textarea ref={box} value={text} aria-label="Text to import" spellCheck={false} className="cyber-scroll"
          placeholder={`Paste a table here, or upload a file.\n\n[options]\nname, description, requires\n\n[features]\n${list.levelled ? 'option, feature, level, words, uses, refill' : 'option, feature, words, uses, refill'}`}
          onChange={(e) => change(e.target.value)}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
          style={{ ...lines, background: 'var(--black)', color: 'var(--green)', border: 0, resize: 'none', whiteSpace: 'pre', overflow: 'auto', height: '100%', width: '100%', outline: 'none' }} />
      </div>
      {tooBig && <p style={{ ...why, color: 'var(--danger)' }}>That is too much to read at once. Split it into pieces of under {MAX_BYTES / 1000} KB.</p>}

      <div style={row}>
        <button type="button" className="utility-btn" style={btn} disabled={!api || !text.trim() || tooBig || busy}
          title={api ? undefined : 'Needs the server'} onClick={runPreview}>{busy ? 'READING…' : 'PREVIEW'}</button>
        <button type="button" className="utility-btn active" style={btn} disabled={!canApply}
          title={stale ? 'The text changed since it was previewed. PREVIEW it again first.' : undefined} onClick={apply}>
          {current && current.changes > 0 ? `APPLY ${plural(current.changes, 'CHANGE')}${skipped.length ? `, SKIP ${plural(skipped.length, 'LINE')}` : ''}` : 'APPLY'}
        </button>
        {stale && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>CHANGED SINCE PREVIEW · PREVIEW AGAIN</span>}
      </div>
      {message && <p role="alert" style={{ ...why, color: 'var(--danger)' }}>{message}</p>}

      {current && (
        <div role="status" aria-label="Preview" style={{ borderTop: '1px solid var(--dark-green)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {skipped.length > 0 && (
            <div role="alert" style={{ border: '1px solid var(--warning)', color: 'var(--warning)', padding: '6px 10px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ letterSpacing: 1 }}>⚠ {skipped.length === 1 ? '1 LINE HAS A MISTAKE' : `${skipped.length} LINES HAVE MISTAKES`} AND WILL BE SKIPPED</span>
              <span>
                On {skipped.map((s, i) => [i ? (i === skipped.length - 1 ? ' and ' : ', ') : '', lineLink(s.line)])}.
                {' '}Fix {skipped.length === 1 ? 'it' : 'them'} and PREVIEW again, or APPLY the rest without {skipped.length === 1 ? 'it' : 'them'}.
              </span>
            </div>
          )}
          <span style={{ color: 'var(--cyan)', fontSize: 12, letterSpacing: 1 }}>
            {plural(current.changes, 'CHANGE')} · {current.same} ALREADY THE SAME{skipped.length ? ` · ${plural(skipped.length, 'LINE')} SKIPPED` : ''}
          </span>
          <Group title={`NEW ${many}`} tone="var(--cyan)" items={current.added.options.map((o) => `${o.option.toUpperCase()}${o.requires ? ` · REQUIRES ${o.requires}` : ''}`)} />
          <Group title="CHANGED" tone="var(--green)" items={current.changed.options.map((o) => `${o.option.toUpperCase()} · ${o.parts.map((p) => partText(definition, p)).join(' · ')}`)} />
          <Group title="NEW FEATURES" tone="var(--cyan)" items={current.added.features.map((f) => addedFeatureText(definition, f))} />
          <Group title="CHANGED FEATURES" tone="var(--green)" items={current.changed.features.map((f) => `${f.option.toUpperCase()} · ${f.feature.toUpperCase()} · ${f.parts.map((p) => partText(definition, p)).join(' · ')}`)} />
          <Group title="SKIPPED, NOTHING FROM THESE LINES GOES IN" tone="var(--warning)"
            items={skipped.map((s) => <>{lineLink(s.line)}{` · ${s.message}`}</>)} />
          <Group title="GOOD TO KNOW" tone="var(--green)"
            items={[...current.notes.map((n) => `LINE ${n.line} · ${n.message}`), 'Nothing is deleted: options and features not in the file stay as they are.']} />
          {current.changes === 0 && <p style={{ ...why, color: 'var(--warning)' }}>Nothing in that changes {many}, so there is nothing to apply.</p>}
        </div>
      )}
    </section>
  );
}
