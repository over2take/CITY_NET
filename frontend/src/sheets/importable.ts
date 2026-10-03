// Which systems can fill a sheet from a PDF: the ones the server has an importer for
// (backend/sheets/importers.js IMPORTERS; a test holds the two lists together). The sheet windows
// offer IMPORT only there. Generic has no importer, and neither does a custom system, so the
// server refused every import from either and the button only ever failed (hidden for Generic
// at the user's choice, 2026-10-02; for custom systems since 3b6c).
export const IMPORTABLE_SYSTEMS = ['cyberpunk_red', 'cities_without_number', 'shadowrun_6e'] as const;

export const canImport = (system: string | null | undefined): boolean =>
  typeof system === 'string' && (IMPORTABLE_SYSTEMS as readonly string[]).includes(system);
