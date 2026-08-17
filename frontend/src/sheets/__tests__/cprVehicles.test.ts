import { describe, it, expect } from 'vitest';
import { cyberpunkRed, CPR_VEHICLE_ROWS, CPR_VEHICLE_COLUMNS } from '../templates/cyberpunk_red';
import { citiesWithoutNumber } from '../templates/cities_without_number';
import {
  ARCHETYPE_OPTIONS, VEHICLE_ARCHETYPES, DEFAULT_ARCHETYPE,
  archetypeHullsAreDrawable, archetypeLook, getArchetype,
} from '../vehicleArchetypes';
import { ART_KEYS } from '../../components/vehicleArt';
import type { SheetField, SheetTemplate } from '../types';

/**
 * The Cyberpunk RED vehicle section.
 *
 * The load-bearing constraint is legal rather than mechanical: the corebook's vehicle table
 * cannot ship. So the section works exactly like CWN's — one picker that fills the block —
 * but fills it from archetypes we authored rather than from anyone's table, and leaves
 * every field editable so a table can type their own values over the top.
 */

const section = cyberpunkRed.sections.find(s => s.id === 'vehicles')!;
const ids = section.fields.map((f: SheetField) => f.id);
const field = (id: string) => section.fields.find((f: SheetField) => f.id === id)!;
const fill = (value: string, data: Record<string, unknown> = {}) =>
  (field('vehicle1_type') as any).presetFill(value, data);

describe('the CP:R vehicle section', () => {
  it('sits on the GEAR tab with the seating button in its header', () => {
    expect(section.tab).toBe('GEAR');
    // Beside the collapse toggle rather than inside the section, so folding the section
    // away does not take the way into the shared window with it.
    expect(section.headerAction).toBe('SEATING');
  });

  it('sits where CWN puts it, so the two GEAR tabs read the same way', () => {
    // Pinned by comparing the two templates rather than by naming a position, so if one
    // moves the other follows or this fails.
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

  it('has one picker, which is also what the wireframe is read from', () => {
    // A separate HULL field would be a second thing to keep in step with the archetype for
    // no gain — CWN stores one type and derives the drawing from it, and so does this.
    expect(field('vehicle1_type').label).toBe('ARCHETYPE');
    expect(field('vehicle1_type').options).toEqual(ARCHETYPE_OPTIONS);
    expect(section.fields.filter((f: SheetField) => 'options' in f).map(f => f.id))
      .toEqual([1, 2, 3, 4].map(i => `vehicle${i}_type`));
  });

  it('fills the numbers, the seats and the name', () => {
    expect(fill('speedboat')).toEqual({
      vehicle1_name: 'SPEEDBOAT',
      vehicle1_hp: 45, vehicle1_hp_max: 45, vehicle1_armor: 5, vehicle1_crew: 4,
    });
  });

  it('names an unnamed vehicle and leaves a named one alone', () => {
    // One still called SPEEDBOAT has not been named; one called Halcyon has.
    expect(fill('yacht', {}).vehicle1_name).toBe('YACHT');
    expect(fill('yacht', { vehicle1_name: 'SPEEDBOAT' }).vehicle1_name).toBe('YACHT');

    const named = fill('yacht', { vehicle1_name: 'Halcyon' });
    expect(named.vehicle1_name).toBeUndefined();
    // The numbers still change — only the name is theirs.
    expect(named.vehicle1_hp_max).toBe(110);
  });

  it('fills nothing for an id it does not know', () => {
    expect(fill('nonsense')).toEqual({});
  });

  it('starts a new vehicle as the smallest archetype, not as a blank', () => {
    // An unset type draws nothing and seats nobody, which is a hole rather than a choice —
    // the same reasoning that made CWN start one as a Motorcycle.
    const a = getArchetype(DEFAULT_ARCHETYPE)!;
    expect(section.onAdd?.(2)).toEqual({
      vehicle2_type: a.id, vehicle2_name: a.label,
      vehicle2_hp: a.pool, vehicle2_hp_max: a.pool,
      vehicle2_armor: a.armor, vehicle2_crew: a.seats,
    });
  });

  it('repeats the row for every vehicle, with the group size the collapse depends on', () => {
    expect(ids.filter(id => /^vehicle\d+_name$/.test(id))).toHaveLength(CPR_VEHICLE_ROWS);
    expect(section.groupSize).toBe(section.fields.length / CPR_VEHICLE_ROWS);
    expect(section.columns).toBe(CPR_VEHICLE_COLUMNS);
  });

  it('carries no numbers from the book', () => {
    // Placeholders are the one place a stat could slip in and look like UI copy.
    const hints = section.fields.map((f: SheetField) => `${f.hint ?? ''} ${f.placeholder ?? ''}`).join(' ');
    expect(hints).not.toMatch(/\bSDP\s*\d/i);
  });
});

describe('the archetypes', () => {
  it('every one draws as something', () => {
    // An archetype whose hull is not a real wireframe would silently fall back to a car.
    expect(archetypeHullsAreDrawable()).toBe(true);
  });

  it('resolves the wireframe through the archetype', () => {
    expect(archetypeLook('yacht').art).toBe('yacht');
    expect(archetypeLook('sedan').art).toBe('car');
    // A saved sheet from before an archetype was renamed still draws something.
    expect(archetypeLook('gone').art).toBe('car');
    expect(ART_KEYS).toContain(archetypeLook('gone').art);
  });

  it('gives each a pool, armour and seats worth starting from', () => {
    VEHICLE_ARCHETYPES.forEach(a => {
      expect(a.pool).toBeGreaterThan(0);
      expect(a.armor).toBeGreaterThanOrEqual(0);
      expect(a.seats).toBeGreaterThan(0);
    });
  });

  it('has no duplicate ids or labels', () => {
    const ids2 = VEHICLE_ARCHETYPES.map(a => a.id);
    const labels = VEHICLE_ARCHETYPES.map(a => a.label);
    expect(new Set(ids2).size).toBe(ids2.length);
    // Labels double as the auto-name, so a duplicate would make two vehicles indistinguishable.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('names archetypes, never a publisher vehicle', () => {
    // Listing model names out of one book's table would be reproducing the table.
    const labels = VEHICLE_ARCHETYPES.map(a => a.label).join(' ').toLowerCase();
    for (const trademark of ['thorton', 'galena', 'aerozep', 'av-4', 'av-9', 'chooh']) {
      expect(labels).not.toContain(trademark);
    }
  });

  it('has a default that is a real archetype', () => {
    expect(getArchetype(DEFAULT_ARCHETYPE)).not.toBeNull();
  });

  it('ignores an unknown id rather than filling nonsense', () => {
    expect(getArchetype('nope')).toBeNull();
  });
});
