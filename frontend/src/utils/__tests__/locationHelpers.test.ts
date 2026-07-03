import { describe, it, expect } from 'vitest';
import { isUserDefinedName, getStructLabel, ZONE_TYPE_NAMES } from '../locationHelpers';

describe('isUserDefinedName', () => {
  it('returns true for a user-defined name', () => {
    expect(isUserDefinedName('Yakuza HQ')).toBe(true);
    expect(isUserDefinedName('Safe House')).toBe(true);
    expect(isUserDefinedName('Arasaka Tower')).toBe(true);
  });

  it('returns false for every zone type name', () => {
    for (const name of ZONE_TYPE_NAMES) {
      expect(isUserDefinedName(name)).toBe(false);
    }
  });

  it('returns false for empty string', () => {
    expect(isUserDefinedName('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isUserDefinedName('   ')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isUserDefinedName(null)).toBe(false);
    expect(isUserDefinedName(undefined)).toBe(false);
  });

  it('is case-sensitive — lowercase zone names are treated as user-defined', () => {
    expect(isUserDefinedName('corpo')).toBe(true);
    expect(isUserDefinedName('urban')).toBe(true);
  });

  it('trims whitespace before checking zone names', () => {
    expect(isUserDefinedName('  CORPO  ')).toBe(false);
    expect(isUserDefinedName('  URBAN  ')).toBe(false);
  });
});

describe('getStructLabel', () => {
  it('returns prefixed label for known zone-type named location', () => {
    expect(getStructLabel({ id: 5, name: 'CORPO' })).toBe('CORPO_struct_5');
    expect(getStructLabel({ id: 12, name: 'URBAN' })).toBe('URBAN_struct_12');
  });

  it('returns STRUCT_id for unknown/undefined name', () => {
    expect(getStructLabel({ id: 7, name: '' })).toBe('STRUCT_7');
    expect(getStructLabel({ id: 3, name: null })).toBe('STRUCT_3');
  });

  it('returns STRUCT_id for HOLOTREE_CANOPY (no prefix)', () => {
    // HOLOTREE_CANOPY is in ZONE_TYPE_NAMES but excluded from prefix
    expect(getStructLabel({ id: 2, name: 'HOLOTREE_CANOPY' })).toBe('STRUCT_2');
  });

  it('returns STRUCT_id for user-defined names', () => {
    expect(getStructLabel({ id: 9, name: 'Yakuza HQ' })).toBe('STRUCT_9');
  });
});
