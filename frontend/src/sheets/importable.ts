import { isCustomSystem } from './customTemplates';
import { partOn } from './parts';

// Which sheets can be filled from a PDF, JSON or text: the built-in games the server has an
// importer for (backend/sheets/importers.js IMPORTERS; a test at each end pins the same list), and
// since 4h2c every custom system while it has SHEET IMPORT on (backend systemBuilder/sheetImport.js
// makes its importer from its own sheet). The sheet windows offer IMPORT only there. Generic has no
// importer: IMPORT is hidden for it (the user's choice, 2026-10-02).
export const IMPORTABLE_SYSTEMS = ['cyberpunk_red', 'cities_without_number', 'shadowrun_6e'] as const;

const builtIn = (system: string | null | undefined): boolean =>
  typeof system === 'string' && (IMPORTABLE_SYSTEMS as readonly string[]).includes(system);

/** Whether a character's sheet can be imported into, under `system`. */
export const canImport = (system: string | null | undefined): boolean =>
  builtIn(system) || (isCustomSystem(system) && partOn(system, 'sheet_import'));

/**
 * Whether an NPC's sheet can: the built-in games only. A custom system's importer is made from its
 * characters' sheet, and an NPC's stat block is another sheet (npc.sheet), so it would read the
 * wrong fields.
 */
export const canImportNpc = builtIn;

/** Whether IMPORT hands out a custom system's own downloads: its JSON template beside the blank PDF. */
export const hasJsonTemplate = (system: string | null | undefined): boolean =>
  isCustomSystem(system) && partOn(system, 'sheet_import');
