/**
 * Uploaded catalogues sitting alongside the ones that ship with the app.
 *
 * The rule being defended is **added to, never replacing**. CWN arrives with 216 priced
 * items read out of the book, and a GM who uploads a weapon list is extending that. The
 * failure worth fearing is the quiet one: a GM uploads six guns and the other 210 items
 * stop existing, which nobody would notice until a player went looking for a gas mask.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const store = require_('../shops/catalogueStore');
const builtIn = require_('../shops/prices');

const upload = (catalogues, system = 'cities_without_number') => store.load(system, catalogues);

beforeEach(() => store.clear());

describe('what the app already ships with', () => {
  it('is still there when nothing has been uploaded', () => {
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(200);
    expect(store.labelOf('weapons', 'heavy_pistol')).toBe('Heavy Pistol');
  });

  it('is still there after something has been uploaded', () => {
    // The whole point. Six uploaded guns must not cost anybody the other 210 items.
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: {} }] });
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(200);
    expect(store.priceOf('gear', 'climbing_kit')).toBe(150);
    expect(store.priceOf('cyberware', 'cranial-jack')).toBe(1000);
  });

  it('keeps every book entry in the merged list, plus the new one', () => {
    const before = store.entriesIn('weapons').length;
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: {} }] });
    const after = store.entriesIn('weapons');
    expect(after).toHaveLength(before + 1);
    expect(after.map((e) => e.name)).toContain('Heavy Pistol');
    expect(after.map((e) => e.name)).toContain('Zip Gun');
  });
});

describe('an uploaded entry', () => {
  it('can be bought and priced', () => {
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: { dmg: '1d4' } }] });
    expect(store.priceOf('weapons', 'zip_gun')).toBe(15);
    expect(store.labelOf('weapons', 'zip_gun')).toBe('Zip Gun');
    expect(store.fieldsOf('weapons', 'zip_gun')).toEqual({ dmg: '1d4' });
  });

  it('overrides a book entry of the same id, because typing it means it', () => {
    // A GM putting "Heavy Pistol, 250" in their own file is house-ruling the price. The
    // preview says so; it is not silent.
    upload({ weapons: [{ id: 'heavy_pistol', name: 'Heavy Pistol', price: 250, fields: {} }] });
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(250);
    // And it appears once, not twice.
    const rows = store.entriesIn('weapons').filter((e) => e.id === 'heavy_pistol');
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('uploaded');
  });

  it('is named in advance as an override, so a preview can warn', () => {
    const entries = [
      { id: 'heavy_pistol', name: 'Heavy Pistol', price: 250 },
      { id: 'zip_gun', name: 'Zip Gun', price: 15 },
    ];
    expect(store.overridesIn('weapons', entries)).toEqual(['Heavy Pistol']);
  });

  it('is found by name when the book has never heard of it', () => {
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: {} }] });
    expect(store.findByName('Zip Gun')).toEqual({ catalogue: 'weapons', id: 'zip_gun' });
    expect(store.findByName('  zip   gun ')).toEqual({ catalogue: 'weapons', id: 'zip_gun' });
  });

  it('leaves a name the book knows pointing at the book', () => {
    /**
     * The opposite order from priceOf, on purpose. A price lookup answers "what does THIS
     * entry cost" and an override should win. A name lookup answers "what is this thing
     * the player owns", and a character carrying a Heavy Pistol bought before any upload
     * is still carrying the book's.
     */
    upload({ weapons: [{ id: 'heavy_pistol', name: 'Heavy Pistol', price: 250, fields: {} }] });
    expect(store.findByName('Heavy Pistol')).toEqual(builtIn.findByName('Heavy Pistol'));
  });
});

describe('re-uploading', () => {
  it('replaces the uploaded set, which is how a line gets removed', () => {
    upload({ weapons: [
      { id: 'zip_gun', name: 'Zip Gun', price: 15 },
      { id: 'slug_thrower', name: 'Slug Thrower', price: 80 },
    ] });
    expect(store.uploadedIn('weapons')).toHaveLength(2);

    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15 }] });
    expect(store.uploadedIn('weapons').map((e) => e.name)).toEqual(['Zip Gun']);
    // And the book is untouched by any of it.
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(200);
  });

  it('does not leave another catalogue behind', () => {
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15 }], gear: [{ id: 'rope', name: 'Rope', price: 20 }] });
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15 }] });
    expect(store.hasUploads('gear')).toBe(false);
    // The book's gear survives regardless.
    expect(store.priceOf('gear', 'climbing_kit')).toBe(150);
  });

  it('forgets everything when the system changes', () => {
    upload({ weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15 }] });
    store.clear();
    expect(store.hasUploads('weapons')).toBe(false);
    expect(store.systemLoaded()).toBe(store.BOOK_SYSTEM);
  });
});

describe('the book belongs to CWN', () => {
  /**
   * The built-in tables are the Cities Without Number book. Every other system's shops
   * start empty and carry only what that GM uploaded - a Cyberpunk RED gun shop selling
   * CWN guns at CWN prices would be wrong in a way nobody at the table could see.
   */
  for (const system of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
    it(`sells nothing from it on ${system}`, () => {
      upload({}, system);
      expect(store.bookApplies()).toBe(false);
      expect(store.priceOf('weapons', 'heavy_pistol')).toBeNull();
      expect(store.labelOf('weapons', 'heavy_pistol')).toBeNull();
      expect(store.findByName('Heavy Pistol')).toBeNull();
      expect(store.entriesIn('weapons')).toEqual([]);
    });
  }

  it('still sells what that GM uploaded', () => {
    upload({ weapons: [{ id: 'unity', name: 'Militech Unity', price: 100 }] }, 'cyberpunk_red');
    expect(store.priceOf('weapons', 'unity')).toBe(100);
    expect(store.findByName('Militech Unity')).toEqual({ catalogue: 'weapons', id: 'unity' });
    expect(store.entriesIn('weapons').map((e) => e.id)).toEqual(['unity']);
  });

  it('calls nothing an override where there is no book to override', () => {
    upload({}, 'cyberpunk_red');
    expect(store.overridesIn('weapons', [{ id: 'heavy_pistol', name: 'Heavy Pistol' }])).toEqual([]);
  });

  it('comes back when the game returns to CWN', () => {
    upload({}, 'cyberpunk_red');
    upload({}, 'cities_without_number');
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(200);
  });
});

describe('rows that are not rows', () => {
  it('ignores an entry with no id', () => {
    upload({ weapons: [{ name: 'Nameless', price: 10 }, { id: 'ok', name: 'Fine', price: 1 }] });
    expect(store.uploadedIn('weapons').map((e) => e.id)).toEqual(['ok']);
  });

  it('reads a missing or broken price as nothing rather than crashing', () => {
    upload({ weapons: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', price: 'free' }] });
    expect(store.priceOf('weapons', 'a')).toBe(0);
    expect(store.priceOf('weapons', 'b')).toBe(0);
  });

  it('survives junk where a catalogue should be', () => {
    for (const junk of [null, undefined, {}, { weapons: null }, { weapons: 'nope' }]) {
      expect(() => upload(junk), JSON.stringify(junk)).not.toThrow();
    }
    // And the book still answers afterwards.
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(200);
  });

  it('says null for something neither side has', () => {
    // Null and not zero: "free" and "no such item" have to stay different answers.
    expect(store.priceOf('weapons', 'railgun_of_doom')).toBeNull();
    expect(store.priceOf('nonsense', 'anything')).toBeNull();
    expect(store.findByName('Betty\'s lucky knife')).toBeNull();
  });
});
