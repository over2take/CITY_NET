// The Common Operator Gear table, CWN p50.
//
// Rope, medkits, gas masks, ammunition - the things a run actually gets bought for, and
// the last of the book's priced tables with no catalogue behind it. The book's own caveat
// is worth keeping in mind: "Prices can vary considerably depending on sources, but the
// listed costs are usual for the kind of vendors that operators frequent."

export interface GearItem {
  id: string;
  label: string;
  cost: number;
  /**
   * Encumbrance of one, as a number the sheet can add up.
   *
   * Zero wherever the book prints a symbol instead of a figure - see `encNote`, which
   * carries which symbol it was. Storing the symbol here instead would mean the
   * encumbrance sum has to parse "1~", and a bad parse reads as nothing rather than
   * as an error.
   */
  enc: number;
  /**
   * The book's footnote on the Enc column, where there was one:
   *   'worn'    - the ~ rows: no Encumbrance while worn, which is where the 1 goes.
   *   'trivial' - the * rows: no Encumbrance for any reasonable amount.
   *   'service' - the - row: a subscription, not an object.
   */
  encNote?: 'worn' | 'trivial' | 'service';
  /** What it does, condensed from the book's entry below the table. */
  note: string;
}

/** Twenty-seven, in the book's own alphabetical order. */
export const CWN_GEAR: GearItem[] = [
  { id: 'hearing_protection', label: 'Active hearing protection', cost: 250, enc: 1, note: 'Immune to disorientation from loud noises; passes speech through' },
  { id: 'ammo_magazine', label: 'Ammunition, empty magazine', cost: 10, enc: 1, note: 'Magazines are specific to an individual firearm' },
  { id: 'ammo_round', label: 'Ammunition, per round', cost: 1, enc: 0, encNote: 'trivial', note: 'Loaded into empty magazines' },
  { id: 'backpack', label: 'Backpack or gear harness', cost: 25, enc: 1, encNote: 'worn', note: 'Without one, the GM may ask how you are carrying your loadout' },
  { id: 'binoculars', label: 'Binoculars', cost: 100, enc: 1, note: 'Low-light and magnification out to roughly a kilometer' },
  { id: 'bus_pass', label: 'Bus pass, monthly', cost: 50, enc: 0, encNote: 'trivial', note: 'The first mission of many operators' },
  { id: 'climbing_kit', label: 'Climbing kit', cost: 150, enc: 2, note: 'Ultralight cord, grapnel, grip handholds and wall adhesive' },
  { id: 'clothing_fashionable', label: 'Clothing, fashionable', cost: 500, enc: 1, encNote: 'worn', note: 'No Encumbrance worn; a spare outfit in the pack is 1' },
  { id: 'clothing_couture', label: 'Clothing, haute couture', cost: 10000, enc: 1, encNote: 'worn', note: 'No Encumbrance worn; a spare outfit in the pack is 1' },
  { id: 'clothing_ordinary', label: 'Clothing, ordinary', cost: 25, enc: 1, encNote: 'worn', note: 'No Encumbrance worn; a spare outfit in the pack is 1' },
  { id: 'gas_mask', label: 'Gas mask', cost: 1000, enc: 1, note: 'Readied: immune to most inhaled gases, tear gas included' },
  { id: 'goggles_antiflash', label: 'Goggles, Anti-Flash', cost: 100, enc: 1, note: 'Defuses flashbangs and similar dazzlers' },
  { id: 'goggles_ir', label: 'Goggles, IR', cost: 1000, enc: 1, note: 'Anti-flash, plus IR vision out to 50 meters' },
  { id: 'kit_basic_tools', label: 'Kit, Basic Tools', cost: 100, enc: 2, note: 'Basic repairs and construction' },
  { id: 'kit_cyberdoc', label: 'Kit, Cyberdoc', cost: 500, enc: 2, note: 'A medkit plus cyber maintenance and emergency implantation' },
  { id: 'kit_medkit', label: 'Kit, Medkit', cost: 100, enc: 1, note: 'First aid implements' },
  { id: 'kit_survival', label: 'Kit, Survival', cost: 100, enc: 2, note: 'Water filtration and fire-making for badlands work' },
  { id: 'lockpicks', label: 'Lockpicks', cost: 100, enc: 1, note: 'Manual picks and electronic shims for most modern locks' },
  { id: 'military_ration', label: 'Military ration, per day', cost: 20, enc: 1, note: 'A day of heavy activity. Water is an extra 1 Enc per day' },
  { id: 'video_camera', label: 'Portable video camera', cost: 300, enc: 1, note: 'Palm-sized; records twelve hours of high-def' },
  { id: 'radio_handheld', label: 'Radio, handheld', cost: 50, enc: 1, note: 'One kilometer in the city, six in the open' },
  { id: 'radio_tab', label: 'Radio, ultralight tab', cost: 500, enc: 0, note: 'Headset or collar tab. Same ranges as a handheld' },
  { id: 'smartphone_plan', label: 'Smartphone service plan/month', cost: 10, enc: 0, encNote: 'service', note: 'A subscription rather than an object' },
  { id: 'smartphone_basic', label: 'Smartphone, basic', cost: 50, enc: 0, encNote: 'trivial', note: 'Cheap and ubiquitous; few operators trust one with anything' },
  { id: 'smartphone_fashionable', label: 'Smartphone, fashionable', cost: 2000, enc: 0, encNote: 'trivial', note: 'Cheap and ubiquitous; few operators trust one with anything' },
  { id: 'vr_crown', label: 'VR crown, cheap', cost: 50, enc: 1, note: 'For a VR addict, or a hacker too poor for a cranial jack' },
  { id: 'wearable_light', label: 'Wearable light', cost: 25, enc: 1, encNote: 'worn', note: 'Clip-on; illuminates up to 30 meters ahead' },
];

export const CWN_GEAR_BY_ID = new Map(CWN_GEAR.map((g) => [g.id, g]));

/** The Enc column as the book prints it, symbol and all. */
export const encText = (g: GearItem): string => {
  if (g.encNote === 'service') return '—';
  if (g.encNote === 'trivial') return '*';
  return g.encNote === 'worn' ? `${g.enc}~` : String(g.enc);
};

/** What the two symbols mean, for a footnote under the shelf. */
export const ENC_FOOTNOTE =
  '~ no Encumbrance while worn · * no Encumbrance for any reasonable amount';
