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
