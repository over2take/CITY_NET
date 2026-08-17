import { describe, it, expect } from 'vitest';
import { cyberpunkRed, CPR_VEHICLE_ROWS, CPR_VEHICLE_COLUMNS } from '../templates/cyberpunk_red';
import { citiesWithoutNumber } from '../templates/cities_without_number';
import { HULL_LABELS, HULL_OPTIONS, DEFAULT_HULL } from '../vehicleHulls';
import { ART_KEYS } from '../../components/vehicleArt';
import type { SheetField, SheetTemplate } from '../types';

/**
 * The Cyberpunk RED vehicle section.
 *
 * The load-bearing constraint here is legal rather than mechanical: the corebook's vehicle
 * table cannot ship, so unlike CWN there is no preset picker and the player types their own
 * numbers. What the tests guard is that nothing quietly reintroduces book data, and that
 * the field ids stay the ones the shared seating machinery reads.
 */

const section = cyberpunkRed.sections.find(s => s.id === 'vehicles')!;
const ids = section.fields.map((f: SheetField) => f.id);
const field = (id: string) => section.fields.find((f: SheetField) => f.id === id)!;

describe('the CP:R vehicle section', () => {
  it('sits on the GEAR tab with the seating button in its header', () => {
    expect(section.tab).toBe('GEAR');
    // Beside the collapse toggle rather than inside the section, so folding the section
    // away does not take the way into the shared window with it.
    expect(section.headerAction).toBe('SEATING');
  });

  it('sits where CWN puts it, so the two GEAR tabs read the same way', () => {
    // Above the gear list rather than below the pocket contents. Pinned by comparing the
    // two templates rather than by naming a position, so if one moves the other follows
    // or this fails.
    const gearOf = (t: SheetTemplate) => t.sections.filter(s => s.tab === 'GEAR').map(s => s.id);
    const cpr = gearOf(cyberpunkRed);
    const shared = gearOf(citiesWithoutNumber).filter(id => cpr.includes(id));
    expect(cpr).toEqual(shared);
    expect(cpr.indexOf('vehicles')).toBeLessThan(cpr.indexOf('gear'));
  });

  it('uses the field ids the shared seating machinery reads', () => {
    // The labels are Cyberpunk's - SDP, SP, SEATS - but the storage is the app's generic
    // vocabulary, because the roster, the seating window and the hull bar are shared with
    // CWN. Renaming per system would fork all three to say the same thing differently.
    for (const suffix of ['name', 'type', 'hp', 'hp_max', 'armor', 'crew']) {
      expect(ids).toContain(`vehicle1_${suffix}`);
    }
    expect(field('vehicle1_hp').label).toBe('SDP');
    expect(field('vehicle1_armor').label).toBe('SP');
    expect(field('vehicle1_crew').label).toBe('SEATS');
  });

  it('pairs current SDP with its maximum', () => {
    // The window reads both; a pool with no maximum cannot draw a bar.
    expect(field('vehicle1_hp').maxField).toBe('vehicle1_hp_max');
  });

  it('offers no preset picker, because the table cannot ship', () => {
    // CWN fills a whole stat block from the book. Doing that here would mean embedding a
    // copyrighted table, so HULL chooses a drawing and nothing else.
    expect(field('vehicle1_type').label).toBe('HULL');
    expect(section.fields.some((f: SheetField) => 'presetFill' in f)).toBe(false);
  });

  it('seeds a new vehicle with a shape and nothing else', () => {
    // Nothing breaks with the numbers missing - it simply has none yet - so unlike CWN
    // there is no reason to invent a starting vehicle.
    expect(section.onAdd?.(2)).toEqual({ vehicle2_type: DEFAULT_HULL });
  });

  it('repeats the row for every vehicle, with the group size the collapse depends on', () => {
    expect(ids.filter(id => /^vehicle\d+_name$/.test(id))).toHaveLength(CPR_VEHICLE_ROWS);
    expect(section.groupSize).toBe(section.fields.length / CPR_VEHICLE_ROWS);
    expect(section.columns).toBe(CPR_VEHICLE_COLUMNS);
  });

  it('carries no numbers from the book', () => {
    // Placeholders are the one place a stat could slip in and look like UI copy. Every
    // vehicle's real numbers are typed by the player from their own copy.
    const hints = section.fields.map((f: SheetField) => `${f.hint ?? ''} ${f.placeholder ?? ''}`).join(' ');
    expect(hints).not.toMatch(/\bSDP\s*\d/i);
    expect(section.fields.some((f: SheetField) => 'options' in f && f.id.endsWith('_type'))).toBe(true);
    // The only select is the hull picker, and its options are shapes, not vehicles.
    expect(field('vehicle1_type').options).toEqual(HULL_OPTIONS);
  });
});

describe('the hull picker', () => {
  it('labels every shape the app can draw', () => {
    // A wireframe added without a label would silently drop out of the picker.
    expect(Object.keys(HULL_LABELS).sort()).toEqual([...ART_KEYS].sort());
    expect(HULL_OPTIONS).toHaveLength(ART_KEYS.length);
  });

  it('names shapes, never a publisher\'s vehicle', () => {
    // Listing model names out of one book's table would be reproducing the table.
    const labels = Object.values(HULL_LABELS).join(' ').toLowerCase();
    for (const trademark of ['aerozep', 'av-4', 'av-9', 'thorton', 'chooh']) {
      expect(labels).not.toContain(trademark);
    }
  });

  it('defaults to something drawable', () => {
    expect(ART_KEYS).toContain(DEFAULT_HULL);
  });
});
