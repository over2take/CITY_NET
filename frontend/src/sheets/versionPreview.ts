// What PUBLISH would change, as the builder says it (4h3; approved mockup
// docs/mockups/version-preview.html, 2026-10-13). The server works it out
// (backend/systemBuilder/versionDiff.js, publishPreview.js, GET /api/systems/:id/publish-preview);
// this turns its answer into the page's lines: grouped BY CHANGE, or BY CHARACTER when someone
// plays the system, each saying what changes and, where something stops showing, that it is kept.

import { HEALTH_MODELS } from './setup';
import { PART_ROWS } from './wordsFeatures';

/** One change, as the server lists it (versionDiff.js). */
export interface Change {
  kind: 'sheet' | 'formula' | 'stat' | 'health' | 'currency' | 'part' | 'condition' | 'house_rule' | 'other';
  change: string;
  id: string;
  label?: string;
  from?: unknown;
  to?: unknown;
  options?: { value: string; label: string }[];
  value?: unknown;
  min?: number | null;
  max?: number | null;
  balance?: number;
  debt?: number;
}
export interface PreviewCharacter { kind: 'player' | 'npc'; username?: string; sheet_id?: number; name: string; changes: Change[] }
export type PublishPreview =
  | { first: true; problems: number }
  | { first: false; from: number; to: number; changes: Change[]; characters: PreviewCharacter[]; sample: Change[] | null; problems: number };

/** The groups BY CHANGE, in the page's order. */
export const GROUPS: { id: string; label: string; kinds: Change['kind'][] }[] = [
  { id: 'sheet', label: 'ON THE SHEET', kinds: ['sheet'] },
  { id: 'numbers', label: 'NUMBERS THAT WILL WORK OUT DIFFERENTLY', kinds: ['formula'] },
  { id: 'stats', label: 'STATS', kinds: ['stat'] },
  { id: 'health', label: 'HEALTH', kinds: ['health'] },
  { id: 'money', label: 'MONEY', kinds: ['currency'] },
  { id: 'features', label: 'FEATURES', kinds: ['part'] },
  { id: 'conditions', label: 'CONDITIONS', kinds: ['condition'] },
  { id: 'house_rules', label: 'HOUSE RULES', kinds: ['house_rule'] },
];

/** The sections that change nothing on a character, in words (versionDiff.js OTHER). */
export const OTHER_NAMES: Record<string, string> = {
  name: 'the name', description: 'the description', author: 'the author', license: 'the license',
  words: 'words', buildings: 'building and catalogue names', bank: 'bank settings', lookups: 'tables',
  npc: 'NPC tiers', rests: 'rests',
  rolls: 'rolls', symbols: 'symbols', dice: 'dice', target_seen: 'who sees a roll\'s target',
};

/** A value one character holds, or worked out, written plainly. */
export const valueText = (v: unknown): string => (v === null || v === undefined || v === '' ? 'nothing' : String(v));

const upper = (s: unknown) => String(s ?? '').toUpperCase();
const modelLabel = (id: unknown) => HEALTH_MODELS.find((m) => m.id === id)?.label ?? String(id);
const partLabel = (id: string) => PART_ROWS.find((p) => p.id === id)?.label ?? upper(id).replace(/_/g, ' ');
const range = (r: unknown) => {
  const { min, max } = (r ?? {}) as { min?: number | null; max?: number | null };
  if (min != null && max != null) return `${min} to ${max}`;
  if (min != null) return `at least ${min}`;
  if (max != null) return `at most ${max}`;
  return 'any number';
};

/** One line BY CHANGE: what it is, and what it means. `kept` where something stops showing. */
export interface Line { key: string; what: string; how: string; kept?: boolean }

/** A change of the version's own, in words. Null for the ones that are said another way. */
export const changeLine = (c: Change): Line | null => {
  const key = `${c.kind}:${c.change}:${c.id}`;
  switch (`${c.kind}:${c.change}`) {
    case 'sheet:removed': return { key, what: upper(c.label), how: 'No longer on the sheet. A value anyone has stays on their sheet, hidden, and comes back if you put it back.', kept: true };
    case 'sheet:added': return { key, what: upper(c.label), how: 'New on the sheet.' };
    case 'sheet:renamed': return { key, what: `${upper(c.from)} → ${upper(c.to)}`, how: 'Renamed. The same box, so every value stays where it is.' };
    case 'sheet:gm_only': return { key, what: upper(c.label), how: 'Now GM-only: players can read it and no longer change it.' };
    case 'sheet:player_edit': return { key, what: upper(c.label), how: 'Players can change it again.' };
    case 'sheet:options_removed': return { key, what: upper(c.label), how: `No longer a choice: ${(c.options ?? []).map((o) => o.label).join(', ')}. Anyone who picked it keeps it until it is changed.`, kept: true };
    case 'formula:changed': return { key, what: upper(c.label), how: `Its formula is now ${c.to} (was ${c.from}).` };
    case 'formula:added': return { key, what: upper(c.label), how: `New: ${c.to}.` };
    case 'formula:removed': return { key, what: upper(c.label), how: 'No longer worked out. The last value stays on each sheet, hidden.', kept: true };
    case 'stat:range': return { key, what: upper(c.label), how: `Now ${range(c.to)} (was ${range(c.from)}). A value outside it is kept as it is.` };
    case 'health:changed': return { key, what: `${upper(modelLabel(c.from))} → ${upper(modelLabel(c.to))}`, how: 'How characters get hurt changes. The numbers on their tokens are kept.' };
    case 'currency:removed': return { key, what: upper(c.label), how: 'No longer one of the system\'s currencies. Balances are kept, hidden, and come back if it does.', kept: true };
    case 'currency:added': return { key, what: upper(c.label), how: 'A new currency: everyone starts with none.' };
    case 'part:off': return { key, what: `${partLabel(c.id)} OFF`, how: 'It stops showing. Everything it holds is kept, and comes back when it is turned on.', kept: true };
    case 'part:on': return { key, what: `${partLabel(c.id)} ON`, how: 'It shows again, with everything it held.' };
    case 'condition:removed': return { key, what: upper(c.label), how: 'No longer one of the conditions. A token that has it keeps it, not shown, and it comes back if the condition does.', kept: true };
    case 'condition:added': return { key, what: upper(c.label), how: 'A new condition.' };
    case 'formula:alternative': {
      const [from, to] = [c.from, c.to] as ({ rule: string; formula: string } | null)[];
      return to
        ? { key, what: upper(c.label), how: `With ${upper(to.rule)} on, worked out as ${to.formula}${from ? ` (was ${from.formula} with ${upper(from.rule)})` : ''}.` }
        : { key, what: upper(c.label), how: `No longer worked out another way with ${upper(from?.rule)} on.` };
    }
    case 'house_rule:added': return { key, what: upper(c.label), how: `A new house rule, starting ${c.to ? 'on' : 'off'}. The GM switches it in the GAME tab.` };
    case 'house_rule:removed': return { key, what: upper(c.label), how: 'No longer a house rule. What waited on it is always there now.' };
    case 'house_rule:renamed': return { key, what: `${upper(c.from)} → ${upper(c.to)}`, how: 'Renamed. Whether the table has it on stays as it is.' };
    case 'house_rule:starts': return { key, what: upper(c.label), how: `A game starting from now begins with it ${c.to ? 'on' : 'off'}. A table that already chose keeps its choice.` };
    default: return null;
  }
};

/** What one character's own change says, beside their name or under the version's line. */
export const characterLine = (c: Change): string => {
  switch (`${c.kind}:${c.change}`) {
    case 'formula:value': return c.from === null ? `${valueText(c.to)} (new)` : `${valueText(c.from)} → ${valueText(c.to)}`;
    case 'sheet:removed': return `has ${valueText(c.value)}, kept`;
    case 'sheet:options_removed': return `picked ${(c.options ?? []).find((o) => o.value === String(c.value))?.label ?? valueText(c.value)}, kept`;
    case 'stat:outside': return `has ${valueText(c.value)}, outside ${range({ min: c.min, max: c.max })}, kept`;
    case 'currency:held': return `holds ${valueText(c.balance)}${c.debt ? `, owes ${c.debt}` : ''}, kept`;
    case 'condition:on_token': return 'on their token, kept';
    default: return '';
  }
};

/** Which change of the version's a character's own change belongs under. */
const parentKey = (c: Change): string => {
  if (c.kind === 'formula' && c.change === 'value') return `formula:${c.id}`;
  if (c.kind === 'stat') return `stat:${c.id}`;
  if (c.kind === 'currency') return `currency:${c.id}`;
  if (c.kind === 'condition') return `condition:${c.id}`;
  return `sheet:${c.change}:${c.id}`;
};
/**
 * A field can change two ways at once (renamed and GM-only), so a sheet change is keyed by both; a
 * formula's alternative is keyed apart from its own formula's change, and a house rule by each change.
 */
const ownKey = (c: Change): string => (c.kind === 'sheet' || c.kind === 'house_rule' || (c.kind === 'formula' && c.change === 'alternative')
  ? `${c.kind}:${c.change}:${c.id}` : `${c.kind}:${c.id}`);

/** A line BY CHANGE with who it reaches: each character's own value, or on the sample. */
export interface GroupLine extends Line { who: { name: string; text: string }[] }
export interface Group { id: string; label: string; lines: GroupLine[] }

/**
 * The page BY CHANGE: each group with its lines, in order, and under each the characters it reaches
 * with their own value. A worked-out value that changes without its formula changing (it reads one
 * that did) gets a line of its own. On the sample when nobody plays it.
 */
export const byChange = (p: Extract<PublishPreview, { first: false }>): Group[] => {
  const people = p.characters.length
    ? p.characters.flatMap((ch) => ch.changes.map((c) => ({ name: ch.name, c })))
    : (p.sample ?? []).map((c) => ({ name: 'SAMPLE', c }));
  const lines = new Map<string, { kind: Change['kind']; line: GroupLine }>();
  for (const c of p.changes) {
    const line = changeLine(c);
    if (line) lines.set(ownKey(c), { kind: c.kind, line: { ...line, who: [] } });
  }
  for (const { name, c } of people) {
    // A number that moves only because its formula's alternative changed goes under that.
    const own = parentKey(c);
    const key = !lines.has(own) && c.kind === 'formula' && lines.has(`formula:alternative:${c.id}`) ? `formula:alternative:${c.id}` : own;
    if (!lines.has(key)) {
      // A number that moves because a formula it reads changed.
      lines.set(key, { kind: c.kind, line: { key: `${c.kind}:value:${c.id}`, what: upper(c.label), how: 'Reads a value that changes.', who: [] } });
    }
    lines.get(key)!.line.who.push({ name, text: characterLine(c) });
  }
  return GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    lines: [...lines.values()].filter((l) => g.kinds.includes(l.kind)).map((l) => l.line),
  })).filter((g) => g.lines.length);
};

/** One character BY CHARACTER: their own changes, each with what it is and what it means for them. */
export interface CharacterView { name: string; kind: 'player' | 'npc'; lines: { key: string; what: string; text: string; kept: boolean }[] }

export const byCharacter = (p: Extract<PublishPreview, { first: false }>): CharacterView[] => p.characters.map((ch) => ({
  name: ch.name,
  kind: ch.kind,
  lines: ch.changes.map((c) => ({
    key: `${c.kind}:${c.change}:${c.id}`,
    what: upper(c.label),
    text: characterLine(c),
    kept: c.kind !== 'formula',
  })),
}));

/** The one line for what changes nothing on a character, or null. */
export const otherLine = (p: Extract<PublishPreview, { first: false }>): string | null => {
  const names = p.changes.filter((c) => c.kind === 'other').map((c) => OTHER_NAMES[c.id] ?? c.id);
  if (!names.length) return null;
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `Also in v${p.to}, changing nothing on a character: ${list}.`;
};

/** Whether the new version changes anything a character would notice. */
export const changesCharacters = (p: Extract<PublishPreview, { first: false }>): boolean => byChange(p).length > 0;

/** The heading: "PUBLISH v3 · WHAT CHANGES FROM v2", with who plays it when someone does. */
export const headline = (p: Extract<PublishPreview, { first: false }>, system: string): string =>
  `PUBLISH v${p.to} · WHAT CHANGES FROM v${p.from}${p.characters.length ? ` FOR THE ${p.characters.length} CHARACTER${p.characters.length === 1 ? '' : 'S'} PLAYING ${upper(system)}` : ''}`;

/** The line under it: who plays it, and where the numbers come from. */
export const subline = (p: Extract<PublishPreview, { first: false }>, system: string): string => {
  const names = p.characters.map((c) => c.name);
  const who = names.length
    ? `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} ${names.length === 1 ? 'plays' : 'play'} ${system} v${p.from} now.`
    : `Nobody plays ${system} yet.`;
  if (!changesCharacters(p)) return who;
  const numbers = names.length ? 'worked out from their own sheets' : 'with numbers worked out on the SAMPLE values from STATS & RULES';
  return `${who} This is what v${p.to} changes, ${numbers}. Nothing is deleted: anything that stops showing is kept and comes back if you put it back.`;
};
