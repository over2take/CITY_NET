import type { SheetData, SheetField } from './types';

// A token's temporary hit points on its sheet (2026-10-31): the server reads them with the linked
// values (fillTokenFields in backend/sheets/templates.js) and the HEALTH box shows them added to
// the current HP, in the warning color, rather than as a third number.

/** Where the server puts the token's temporary HP in a sheet's data. Never stored. */
export const HP_TEMP_KEY = '_hp_temp';

/**
 * The data a field linked to the token's HP is drawn from, its current value with the temp HP
 * added, and how much that is (0 for any other field, or with none).
 */
export const withTempHp = (field: Pick<SheetField, 'id' | 'source'>, data: SheetData): { data: SheetData; temp: number } => {
  const temp = field.source === 'token_hp' ? Number(data[HP_TEMP_KEY]) : 0;
  const current = data[field.id];
  if (!(temp > 0) || typeof current !== 'number') return { data, temp: 0 };
  return { data: { ...data, [field.id]: current + temp }, temp };
};
