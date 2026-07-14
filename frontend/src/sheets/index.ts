import type { SheetTemplate } from './types';
import { generic } from './templates/generic';
import { cyberpunkRed } from './templates/cyberpunk_red';

export * from './types';

export const TEMPLATES: Record<string, SheetTemplate> = {
  generic,
  cyberpunk_red: cyberpunkRed,
};

export const getTemplate = (system: string): SheetTemplate =>
  TEMPLATES[system] ?? generic;

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
