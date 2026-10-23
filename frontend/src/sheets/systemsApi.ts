// The system builder's requests to the server (4a1b2): backend/routes/systems.js, main admin only. Each
// answers { ok: true, value } or { ok: false, error }, the error being the server's own words
// ("Another system is already called Ember.") so the window can show them where they apply.
// What the answers mean is systemsLibrary.ts.

import type { InstallMode, InstallPreview, InstallResult, LibrarySystem } from './systemsLibrary';
import type { PublishPreview } from './versionPreview';
import type { CustomRenderSheet } from './customTemplates';
import type { GameCondition } from './tokenConditions';
import type { TableEntry } from './tableConditions';
import type { CustomDie } from '../types';

type Problem = { where: string; message: string };

/** A system's definition as stored: the builder edits it whole (backend/systemBuilder/definition.js). */
export type Definition = { format: number; name: string; author?: string; [section: string]: unknown };

/** The builder pages with a map, so a FORMS / GRAPH choice (backend routes/systems.js MAP_PAGES). */
export type MapPage = 'rules';
export type BuilderView = 'forms' | 'graph';

/** One system as GET /api/systems/:id answers (store.getSystem). */
export interface SystemCopies {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  draft: Definition | null;
  published: Definition | null;
  problems: Problem[];
}

/** One box of a tier worked out (backend/systemBuilder/tierRolls.js rollBox). */
export type TriedBox =
  | { value: number | string; dice: { count: number; sides: number; rolls: number[] }[] }
  | { blank: true }
  | { error: string };
/** A roll made by TEST ROLL (backend tableRolls.js rollField, rollStyles.js makeRoll). */
/** A handful of a system's own die thrown by TEST (backend routes/systems.js test-dice). */
export interface TestedDice {
  /** Each face as the log writes it: its number and its symbols' marks, '·' for a blank. */
  faces: string[];
  symbols: { counted: Record<string, number>; left: Record<string, number> };
  total: number;
  historyText: string;
}

export interface TestedRoll {
  /** The field it was rolled for, and every field it is rolled by. */
  field: string | null;
  fields: string[];
  result: {
    /** A kind of dice: a system's own die (`die`) has its faces' places and symbols (6c3). */
    groups: { name?: string; die?: string; signed?: true; sides: number | 'F'; faces: { value: number; kept: boolean; extra?: boolean; minus?: boolean; face?: number; blank?: true; symbols?: string[] }[] }[];
    dice: number; add: number; total: number; target: number | null; success: boolean | null; band: string | null;
    natural: { label: string; critical?: 'success' | 'failure' } | null;
    matches: { label: string; sets: number; critical?: 'success' | 'failure' }[];
    glitch: string | null; effects: string[]; critical: 'success' | 'failure' | null;
    changes: string[]; costs: { from: string; amount: number; adds?: true }[]; zero?: true;
    /** Conditions' modifiers on all rolls, each added as its own term (6b3b). */
    terms?: { label: string; amount: number }[];
    /** The symbols counted and what is left of each, when the roll's dice show any (6c3). */
    symbols?: { counted: Record<string, number>; left: Record<string, number> };
  };
  historyText: string;
  total: number;
}

/** A tier worked out for a level (tierRolls.js rollTier). */
export interface TriedTier { level: number; hp: TriedBox; defense: TriedBox; values: Record<string, TriedBox> }

/** A draft's rest tried on a made-up character (backend/systemBuilder/tryRest.js, 4f6a). */
export interface TriedRest {
  ok: true;
  rest: { id: string; name: string };
  /** The character after the rest, its formulas worked out again. */
  sheet: Record<string, unknown>;
  token: { current: number; max: number; temp: number } | null;
  conditions: { id: string; left?: number }[];
  changes: { what: string; label: string; from: number; to: number | null; pending?: string[] }[];
  gone: string[];
  rolls: { amount: string; value: number; dice: { count: number; sides: number; rolls: number[] }[] }[];
  /** The dice-log line the game would write. */
  line: string;
}

/** Health tried on a pretend token (backend/systemBuilder/tryHealth.js). */
export interface TriedHealth {
  model: string;
  token: { current: number; max: number; temp: number };
  sheet: Record<string, unknown>;
  /** The action's report, or its refusal; null when nothing was done. */
  result: ({ ok: true; out?: boolean; placed?: string; turned?: number; penalty?: number } | { ok: false; error: string }) | null;
  full: Record<string, unknown>;
  others: Record<string, unknown>;
}

/** A built-in example as the library lists it (backend/systemBuilder/examples.js exampleList). */
export interface ExampleSummary { id: string; name: string; description: string }
/** A built-in game (4d1) or a genre starter (4d3). */
export type ExampleKind = 'example' | 'starter';

export type Answer<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number; changed?: boolean; problems?: Problem[] };

const UNREACHABLE = 'Could not reach the server.';

/** One request, its answer read whatever happened. `status` 0 when the server was never reached. */
const call = async <T>(fetcher: typeof fetch, token: string, url: string, method = 'GET', body?: unknown): Promise<Answer<T>> => {
  let res: Response;
  try {
    res = await fetcher(url, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, error: UNREACHABLE, status: 0 };
  }
  return answerOf<T>(res);
};

/** A zip sent as its own bytes (a system and its pictures, POST /api/systems/install/zip...). */
const sendZip = async <T>(fetcher: typeof fetch, token: string, url: string, zip: Blob): Promise<Answer<T>> => {
  let res: Response;
  try {
    res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/zip', Authorization: `Bearer ${token}` }, body: zip });
  } catch {
    return { ok: false, error: UNREACHABLE, status: 0 };
  }
  return answerOf<T>(res);
};

/** What the server answered: its JSON, or its own words for a refusal. */
const answerOf = async <T>(res: Response): Promise<Answer<T>> => {
  const json = await res.json().catch(() => null);
  if (res.ok) return { ok: true, value: json as T };
  return {
    ok: false,
    status: res.status,
    error: json && typeof json.error === 'string' ? json.error : UNREACHABLE,
    ...(json && json.changed === true ? { changed: true } : {}),
    ...(json && Array.isArray(json.problems) ? { problems: json.problems } : {}),
  };
};

/** The requests, for one GM's token. */
export const systemsApi = (token: string, fetcher: typeof fetch = fetch) => {
  const id = (systemId: string) => `/api/systems/${encodeURIComponent(systemId)}`;
  return {
    list: () => call<LibrarySystem[]>(fetcher, token, '/api/systems'),
    /** One system with both copies and the draft's problems: the facts panel and the builder. */
    get: (systemId: string) => call<SystemCopies>(fetcher, token, id(systemId)),
    /** Store the builder's draft; its problems come back, stored either way. */
    saveDraft: (systemId: string, definition: Definition) =>
      call<{ problems: Problem[] }>(fetcher, token, `${id(systemId)}/draft`, 'PUT', { definition }),
    /**
     * A draft's formulas worked out from its sample character, without saving (STATS & RULES):
     * the values that can be worked out yet, and the formulas' problems.
     */
    previewValues: (definition: Definition) =>
      call<{ values: Record<string, number>; problems: Problem[] }>(fetcher, token, '/api/systems/preview-values', 'POST', { definition }),
    /**
     * TEST ROLL (6b1a): one of a draft's rolls made for its sample character by the table's own
     * engine, for `fieldId` or the first field it is rolled by, with the changes picked. Changes
     * nothing, logs nothing.
     */
    testRoll: (definition: Definition, rollId: string, fieldId?: string | null, changes: string[] = [], conditions: string[] = []) =>
      call<TestedRoll>(fetcher, token, '/api/systems/test-roll', 'POST', { definition, rollId, fieldId: fieldId ?? undefined, changes, conditions }),
    /** The DICE tab's TEST (6c2a): a handful of a draft's own die thrown on the server, its faces as the log writes them and its symbols counted. */
    /** The table's dice from CUSTOM_DIE.EXE (routes/custom_dice.js), for COPY FROM THE TABLE'S DICE. */
    tableDice: () => call<CustomDie[]>(fetcher, token, '/api/custom_dice'),
    testDice: (definition: Definition, dieId: string, count: number) =>
      call<TestedDice>(fetcher, token, '/api/systems/test-dice', 'POST', { definition, dieId, count }),
    /**
     * A draft's sheet as it would be drawn (its own or the starter, without the parts it turned
     * off), and the starter sheet CUSTOMIZE copies, without saving (CHARACTER SHEET).
     */
    previewSheet: (definition: Definition) =>
      call<{ sheet: CustomRenderSheet; starter: CustomRenderSheet }>(fetcher, token, '/api/systems/preview-sheet', 'POST', { definition }),
    /**
     * One of a draft's NPC tiers worked out and rolled for a level, without saving (NPCS, TRY IT):
     * each box's value and dice, or what is wrong with it.
     */
    tryTier: (definition: Definition, tier: string, level: number) =>
      call<TriedTier>(fetcher, token, '/api/systems/try-tier', 'POST', { definition, tier, level }),
    /**
     * A made-up character's health under a draft's model, without saving (TRY IT): an action, if
     * any, applied to a pretend token and sheet by the game's own rules, and the HEALTH folder's
     * views of the result for the owner (`full`) and for everyone else (`others`).
     */
    /**
     * One of a draft's rests on a made-up character (4f6a): previewed with dice waiting, or rolled
     * when `roll` (TRY IT's CALL A REST). Changes nothing.
     */
    tryRest: (definition: Definition, state: { rest: string; sheet?: Record<string, unknown>; token?: { current: number; max: number; temp?: number } | null; conditions?: { id: string }[]; roll?: boolean }) =>
      call<TriedRest>(fetcher, token, '/api/systems/try-rest', 'POST', { definition, ...state }),
    tryHealth: (definition: Definition, state: { token: { current: number; max: number; temp?: number }; sheet?: Record<string, unknown>; action?: Record<string, unknown> }) =>
      call<TriedHealth>(fetcher, token, '/api/systems/try-health', 'POST', { definition, ...state }),
    /**
     * What PUBLISH would change (4h1b, sheets/versionPreview.ts): the stored draft against the published
     * version, for every character playing it or on the SAMPLE values; `first` for a first version.
     */
    publishPreview: (systemId: string) => call<PublishPreview>(fetcher, token, `${id(systemId)}/publish-preview`),
    /** Make the stored draft what the game runs; refused, with `problems`, while it has any. */
    publish: (systemId: string) => call<{ version: number }>(fetcher, token, `${id(systemId)}/publish`, 'POST', {}),
    create: (name: string) => call<{ id: string }>(fetcher, token, '/api/systems', 'POST', { name }),
    /**
     * The built-in examples (4d1) or the genre starters (4d3) to copy: what each is called and
     * does, without its definition.
     */
    examples: (kind: ExampleKind = 'example') =>
      call<ExampleSummary[]>(fetcher, token, kind === 'starter' ? '/api/systems/examples?kind=starter' : '/api/systems/examples'),
    /** One example or starter whole, with which it is: its card in + NEW, and the builder looking at it. */
    example: (exampleId: string) =>
      call<{ id: string; kind: ExampleKind; definition: Definition }>(fetcher, token, `/api/systems/examples/${encodeURIComponent(exampleId)}`),
    /** A new draft copied from a built-in example under the GM's own name; no link back. */
    createFromExample: (name: string, example: string) => call<{ id: string }>(fetcher, token, '/api/systems', 'POST', { name, example }),
    /** A running system's house rules switched at the table (4j5a): the GM or a granted editor. */
    setHouseRules: (systemId: string, rules: Record<string, boolean>) =>
      call<{ house_rules: import('./types').HouseRuleState[] }>(fetcher, token, `${id(systemId)}/house-rules`, 'PUT', { rules }),
    /** Whether the builder's first-time tour has been seen (4i): one setting, on the server. */
    tourSeen: () => call<{ seen: boolean }>(fetcher, token, '/api/systems/tour'),
    /** The tour seen (finished or skipped), or to be shown again the next time the builder opens. */
    setTourSeen: (seen: boolean) => call<{ seen: boolean }>(fetcher, token, '/api/systems/tour', 'PUT', { seen }),
    /** FORMS or GRAPH on each builder page with a map (Phase 5: STATS & RULES only), as last picked. */
    views: () => call<{ views: Record<MapPage, BuilderView> }>(fetcher, token, '/api/systems/view'),
    setView: (page: MapPage, view: BuilderView) => call<{ page: MapPage; view: BuilderView }>(fetcher, token, '/api/systems/view', 'PUT', { page, view }),
    rename: (systemId: string, name: string) => call<{ name: string }>(fetcher, token, `${id(systemId)}/name`, 'PUT', { name }),
    duplicate: (systemId: string) => call<{ id: string; name: string }>(fetcher, token, `${id(systemId)}/duplicate`, 'POST', {}),
    remove: (systemId: string) => call<{ deleted: true }>(fetcher, token, id(systemId), 'DELETE'),
    preview: (file: string) => call<InstallPreview>(fetcher, token, '/api/systems/install/preview', 'POST', { file }),
    install: (file: string, mode: InstallMode, replaceChanges = false) =>
      call<InstallResult>(fetcher, token, '/api/systems/install', 'POST', { file, mode, ...(replaceChanges ? { replaceChanges: true } : {}) }),
    /** The same for a zip of a system and its pictures, sent as it is. */
    previewZip: (zip: Blob) => sendZip<InstallPreview>(fetcher, token, '/api/systems/install/zip/preview', zip),
    installZip: (zip: Blob, mode: InstallMode, replaceChanges = false) =>
      sendZip<InstallResult>(fetcher, token, `/api/systems/install/zip?mode=${encodeURIComponent(mode)}${replaceChanges ? '&replaceChanges=1' : ''}`, zip),
    /**
     * A currency's or a condition's icon image (PNG, WebP or SVG, a quarter of a megabyte at most),
     * stored by the server under its content hash: the address the currency's or condition's
     * `icon` then names.
     */
    /**
     * A built-in game's own conditions, the whole set replaced (4e2c2; the GAME tab): the game's list
     * comes back, the standard ones first.
     */
    saveTableConditions: (system: string, conditions: Record<string, TableEntry>) =>
      call<{ conditions: GameCondition[] }>(fetcher, token, `/api/systems/table-conditions/${encodeURIComponent(system)}`, 'PUT', { conditions }),
    uploadIcon: async (file: File, kind: 'currency' | 'condition' = 'currency'): Promise<Answer<{ icon: string }>> => {
      const form = new FormData();
      form.append('icon', file);
      let res: Response;
      try {
        res = await fetcher(`/api/systems/${kind}-icons`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      } catch {
        return { ok: false, error: UNREACHABLE, status: 0 };
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json && typeof json.icon === 'string') return { ok: true, value: { icon: json.icon } };
      return { ok: false, status: res.status, error: json && typeof json.error === 'string' ? json.error : 'The icon could not be uploaded.' };
    },
    /**
     * A published system as a file to save, its name and contents: with `images`, a zip of it and
     * its uploaded pictures when it has some; otherwise its .citysys without them.
     */
    exportFile: async (systemId: string, images = false): Promise<Answer<{ fileName: string; file: Blob }>> => {
      let res: Response;
      try {
        res = await fetcher(`${id(systemId)}/export${images ? '?images=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        return { ok: false, error: UNREACHABLE, status: 0 };
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        return { ok: false, status: res.status, error: json && typeof json.error === 'string' ? json.error : UNREACHABLE };
      }
      const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      return { ok: true, value: { fileName: named ? named[1] : 'system.citysys', file: await res.blob() } };
    },
    /**
     * The blank PDF form a draft would give players to fill in and upload through IMPORT (4h2c),
     * made by the server from the draft as it stands (POST /api/systems/form.pdf). Changes nothing.
     */
    formPdf: async (definition: Definition): Promise<Answer<Blob>> => {
      let res: Response;
      try {
        res = await fetcher('/api/systems/form.pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ definition }),
        });
      } catch {
        return { ok: false, error: UNREACHABLE, status: 0 };
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        return { ok: false, status: res.status, error: json && typeof json.error === 'string' ? json.error : UNREACHABLE };
      }
      return { ok: true, value: await res.blob() };
    },
  };
};
