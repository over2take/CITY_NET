import type { SheetTemplate } from './types';
import { generic } from './templates/generic';
import { cyberpunkRed } from './templates/cyberpunk_red';
import { citiesWithoutNumber } from './templates/cities_without_number';
import { shadowrun6e } from './templates/shadowrun_6e';
import { isCustomSystem, customTemplate, loadCustomTemplate } from './customTemplates';

export * from './types';
export { isCustomSystem, loadCustomTemplate, CUSTOM_TEMPLATE_EVENT } from './customTemplates';

export const TEMPLATES: Record<string, SheetTemplate> = {
  generic,
  cyberpunk_red: cyberpunkRed,
  cities_without_number: citiesWithoutNumber,
  shadowrun_6e: shadowrun6e,
};

/**
 * A system's sheet template: built-in, or a published custom system's (customTemplates.ts). A
 * custom one not loaded yet is fetched now and the generic template stands in until it
 * arrives; the load fires an event the app redraws on.
 */
export const getTemplate = (system: string): SheetTemplate => {
  const builtIn = TEMPLATES[system];
  if (builtIn) return builtIn;
  if (isCustomSystem(system)) {
    const custom = customTemplate(system);
    if (custom) return custom;
    void loadCustomTemplate(system);
  }
  return generic;
};

/** House-rule-gated sheet tabs, per system: tab name → the settings key
 *  that unlocks it. Adding a gated tab for a new system is one entry here —
 *  every sheet surface (player window, standalone page, admin NPC window)
 *  derives its hiddenTabs from this map. */
export const GATED_TABS: Record<string, Record<string, string>> = {
  cities_without_number: { DELUXE: 'cwn_deluxe' },
  shadowrun_6e: { AWAKENED: 'sr6_awakened', EMERGED: 'sr6_emerged' },
};

/** All settings keys that gate a tab somewhere (for fetch-time filtering). */
export const GATED_TAB_KEYS = Object.values(GATED_TABS).flatMap(g => Object.values(g));

/** Tabs to hide for a system given the current settings rows
 *  ([{key, value}] as served by /api/settings). */
export const hiddenTabsFor = (
  system: string | undefined,
  settings: { key: string; value: string }[],
): string[] | undefined => {
  const gates = system ? GATED_TABS[system] : undefined;
  if (!gates) return undefined;
  const on = new Set(settings.filter(s => s.value === '1').map(s => s.key));
  const hidden = Object.entries(gates).filter(([, key]) => !on.has(key)).map(([tab]) => tab);
  return hidden.length > 0 ? hidden : undefined;
};

/** Returns a map of maxFieldId → currentFieldId for clamping CUR ≤ MAX. */
export const getMaxPairs = (template: SheetTemplate): Record<string, string> => {
  const pairs: Record<string, string> = {};
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.maxField) pairs[field.maxField] = field.id;
    }
  }
  // Also include the header luck pair if present
  if (template.header?.luckField && template.header?.luckMaxField) {
    pairs[template.header.luckMaxField] = template.header.luckField;
  }
  return pairs;
};
