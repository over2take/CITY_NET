// Custom game systems' sheets, as templates the ordinary SheetRenderer draws.
//
// A published custom system comes from the server as a render copy (GET /api/systems/render/:id,
// built by backend/systemBuilder/runtime.js): its layout and words, never its formulas. This turns
// that into a SheetTemplate and keeps it, so getTemplate() answers for a custom system exactly as
// it does for a built-in one. A template not loaded yet is fetched the first time it is asked for;
// until it arrives the generic one stands in, and a window event tells the app to redraw.

import { useEffect, useReducer } from 'react';
import type { Currency } from './currencies';
import type { SheetTemplate, SheetSection, SheetField, SheetFieldType, SheetLinkSource, SectionLayout } from './types';

export interface CustomRenderField {
  id: string;
  label: string;
  type: SheetFieldType;
  visibility?: 'public' | 'private';
  sensitivity?: 'combat';
  maxField?: string;
  hint?: string;
  placeholder?: string;
  unit?: string;
  options?: { value: string; label: string }[];
  source?: SheetLinkSource;
  /** Who changes it: the owner (the default) or only the GM. */
  edit?: 'player' | 'gm';
}

export interface CustomRenderSheet {
  tabs?: string[];
  header?: { nameField?: string; subtitleFields?: string[]; hpField?: string; hpMaxField?: string; chips?: { field: string; label: string }[] };
  sections: { id: string; label: string; layout: SectionLayout; tab?: string; columns?: number; fields: CustomRenderField[] }[];
}

/** A system's own names for the app's building types and catalogues, and which it turned off. */
export interface CustomBuildings {
  types?: Record<string, { name?: string; on?: boolean }>;
  /** A catalogue may name the currency it is priced in (sheets/currencies.ts catalogueCurrencyFor). */
  catalogues?: Record<string, { name?: string; on?: boolean; currency?: string }>;
}

export interface CustomRender {
  id: string;
  name: string;
  /** Every term in every form, resolved by the server (the system's word or the neutral default). */
  words: Record<string, { singular: string; plural: string; short: string }>;
  parts: Record<string, { on: boolean }>;
  /** The building types and shop catalogues it renamed or turned off (backend systemBuilder/buildings.js). */
  buildings?: CustomBuildings;
  /** Its own money, the first the main one (sheets/currencies.ts); empty when it has the app's. */
  currencies?: Currency[];
  derived: string[];
  sheet: CustomRenderSheet;
  /** NPCs' own layout (null: they use the character sheet) and GENERATE_SHEET's tiers. */
  npc?: { sheet: CustomRenderSheet | null; tiers: { id: string; label: string }[] };
}

/** Fired on window when a custom template has been loaded, so the app can redraw. */
export const CUSTOM_TEMPLATE_EVENT = 'citynet:custom-template-loaded';

const cache = new Map<string, SheetTemplate>();
const pending = new Map<string, Promise<SheetTemplate | null>>();

/** Custom systems' ids: sys_ and sixteen hex digits (backend/systemBuilder/store.js). */
export const isCustomSystem = (id: string | null | undefined): id is string =>
  typeof id === 'string' && /^sys_[0-9a-f]{16}$/.test(id);

/** One layout as a template. Derived values read-only; only armor writes through to the token,
 *  as on the built-in sheets - HP and cash change on the token and in the bank. */
const layoutTemplate = (id: string, name: string, sheet: CustomRenderSheet | undefined, derived: Set<string>): SheetTemplate => {
  const sections: SheetSection[] = (sheet?.sections || []).map((s) => ({
    id: s.id,
    label: s.label,
    layout: s.layout,
    ...(s.tab ? { tab: s.tab } : {}),
    ...(s.columns ? { columns: s.columns } : {}),
    fields: (s.fields || []).map((f): SheetField => ({
      id: f.id,
      label: f.label,
      type: f.type,
      ...(f.visibility ? { visibility: f.visibility } : {}),
      ...(f.sensitivity ? { sensitivity: f.sensitivity } : {}),
      ...(f.maxField ? { maxField: f.maxField } : {}),
      ...(f.hint ? { hint: f.hint } : {}),
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      ...(f.unit ? { unit: f.unit } : {}),
      ...(f.options ? { options: f.options } : {}),
      ...(f.source ? { source: f.source, ...(f.source === 'token_ac' ? { sourceWritable: true } : {}) } : {}),
      ...(derived.has(f.id) ? { derived: true as const } : {}),
      ...(f.edit === 'gm' ? { gmOnly: true as const } : {}),
    })),
  }));
  const header = sheet?.header;
  return {
    id,
    name,
    tabs: sheet?.tabs,
    ...(header && header.nameField ? { header: { ...header, nameField: header.nameField } } : { header: { nameField: 'name' } }),
    sections,
  };
};

/** A render copy as a template, with the NPC layout and tiers when the system has them. */
export const templateFromRender = (render: CustomRender): SheetTemplate => {
  const derived = new Set(render.derived || []);
  const tiers = render.npc?.tiers?.length ? { npcTiers: render.npc.tiers } : {};
  const npcSheet = render.npc?.sheet;
  return {
    ...layoutTemplate(render.id, render.name, render.sheet, derived),
    ...(render.words ? { words: render.words } : {}),
    ...(render.parts ? { parts: render.parts } : {}),
    ...(render.buildings ? { buildings: render.buildings } : {}),
    ...(render.currencies ? { currencies: render.currencies } : {}),
    ...tiers,
    ...(npcSheet ? { npcLayout: { ...layoutTemplate(render.id, render.name, npcSheet, derived), ...tiers } } : {}),
  };
};

/** The layout an NPC's sheet is drawn with: the system's NPC layout, or the template itself. */
export const npcTemplateOf = (template: SheetTemplate): SheetTemplate => template.npcLayout ?? template;

/** A loaded custom template, or undefined. */
export const customTemplate = (id: string): SheetTemplate | undefined => cache.get(id);

/** Put a template in place, e.g. from a render copy already in hand. */
export const registerCustomTemplate = (render: CustomRender): SheetTemplate => {
  const template = templateFromRender(render);
  cache.set(render.id, template);
  try { window.dispatchEvent(new CustomEvent(CUSTOM_TEMPLATE_EVENT, { detail: { id: render.id } })); } catch { /* no window in some tests */ }
  return template;
};

/** Fetch a custom system's template once; later calls share the same request. */
export const loadCustomTemplate = (id: string, fetcher: typeof fetch = fetch): Promise<SheetTemplate | null> => {
  if (!isCustomSystem(id)) return Promise.resolve(null);
  const have = cache.get(id);
  if (have) return Promise.resolve(have);
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const request = fetcher(`/api/systems/render/${id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((render: CustomRender | null) => (render ? registerCustomTemplate(render) : null))
    .catch(() => null)
    .finally(() => { pending.delete(id); });
  pending.set(id, request);
  return request;
};

/** For tests: forget every loaded template. */
export const clearCustomTemplates = () => { cache.clear(); pending.clear(); };

/**
 * Redraw when `system`'s template arrives, fetching it if nobody has yet. For the lookups that
 * read a custom system's render copy (useWords, useParts); a built-in id is never fetched.
 */
export function useCustomTemplate(system: string | null | undefined) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onLoaded = (e: Event) => { if ((e as CustomEvent).detail?.id === system) redraw(); };
    window.addEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
    if (system) void loadCustomTemplate(system);
    return () => window.removeEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
  }, [system]);
}
