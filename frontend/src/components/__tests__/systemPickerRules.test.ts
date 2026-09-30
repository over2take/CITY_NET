import { describe as group, it, expect } from 'vitest';
import { groupSystems, flatten, moveActive, matches, describe, BUILT_IN_ORDER, type PickerSystem } from '../systemPickerRules';

/** The game-system picker's rules: two groups, a fixed built-in order, search, and the keys. */

const SYSTEMS: PickerSystem[] = [
  { id: 'generic', name: 'Generic' },
  { id: 'shadowrun_6e', name: 'Shadowrun 6E' },
  { id: 'sys_bbbbbbbbbbbbbbbb', name: 'Vault Knights', custom: true, version: 3 },
  { id: 'cities_without_number', name: 'Cities Without Number' },
  { id: 'sys_aaaaaaaaaaaaaaaa', name: 'Ashen Crowns', custom: true, version: 1 },
  { id: 'cyberpunk_red', name: 'Cyberpunk RED' },
];

group('grouping', () => {
  it('lists the built-in systems in a fixed order, then the GM\'s own A to Z', () => {
    const groups = groupSystems(SYSTEMS);
    expect(groups.map((g) => g.label)).toEqual(['BUILT-IN', 'YOUR SYSTEMS']);
    expect(groups[0].items.map((s) => s.id)).toEqual(BUILT_IN_ORDER);
    expect(groups[1].items.map((s) => s.name)).toEqual(['Ashen Crowns', 'Vault Knights']);
  });

  it('leaves out a group with nothing in it', () => {
    expect(groupSystems(SYSTEMS.filter((s) => !s.custom)).map((g) => g.label)).toEqual(['BUILT-IN']);
    expect(groupSystems(SYSTEMS, 'vault').map((g) => g.label)).toEqual(['YOUR SYSTEMS']);
    expect(groupSystems(SYSTEMS, 'nothing like this')).toEqual([]);
  });

  it('puts a built-in system it does not know after the known ones', () => {
    const groups = groupSystems([...SYSTEMS, { id: 'aaa_new', name: 'Aardvark' }]);
    expect(groups[0].items.at(-1)!.id).toBe('aaa_new');
  });
});

group('search', () => {
  it('matches every word typed, anywhere in the name, ignoring case', () => {
    const names = (q: string) => flatten(groupSystems(SYSTEMS, q)).map((s) => s.name);
    expect(names('RED')).toEqual(['Cyberpunk RED']);
    expect(names('without cities')).toEqual(['Cities Without Number']);
    expect(names('  ')).toHaveLength(SYSTEMS.length);
    expect(matches({ id: 'x', name: 'Vault Knights' }, 'knight vault')).toBe(true);
    expect(matches({ id: 'x', name: 'Vault Knights' }, 'knight crown')).toBe(false);
  });
});

group('the arrow keys', () => {
  it('move down and up, wrapping at either end, starting from the top or bottom', () => {
    expect(moveActive(-1, 1, 5)).toBe(0);
    expect(moveActive(-1, -1, 5)).toBe(4);
    expect(moveActive(4, 1, 5)).toBe(0);
    expect(moveActive(0, -1, 5)).toBe(4);
    expect(moveActive(2, 1, 5)).toBe(3);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});

group('the button', () => {
  it('names the system, and tags a custom one with its version', () => {
    expect(describe(SYSTEMS[3])).toEqual({ name: 'CITIES WITHOUT NUMBER', tag: null });
    expect(describe(SYSTEMS[2])).toEqual({ name: 'VAULT KNIGHTS', tag: 'CUSTOM · v3' });
    expect(describe(undefined)).toEqual({ name: 'UNKNOWN SYSTEM', tag: null });
  });
});
