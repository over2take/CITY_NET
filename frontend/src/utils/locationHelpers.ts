export const ZONE_TYPE_NAMES: ReadonlySet<string> = new Set(['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'PARK', 'HOLOTREE_CANOPY']);

export const isUserDefinedName = (name: string | undefined | null) =>
  !!name && name.trim() !== '' && !ZONE_TYPE_NAMES.has(name.trim());

export const getStructLabel = (loc: any) => {
  const prefix = loc.name && ZONE_TYPE_NAMES.has(loc.name.trim()) && loc.name.trim() !== 'HOLOTREE_CANOPY' ? loc.name.trim() : '';
  return prefix ? `${prefix}_struct_${loc.id}` : `STRUCT_${loc.id}`;
};
