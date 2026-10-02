import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { PARTS, partOn, useParts, allPartsOn } from '../parts';
import { useWords } from '../words';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../customTemplates';

/**
 * Which parts of the app the running system uses, in the browser (3b1). Every built-in system
 * has every part on, so each place keeps today's own rule; a custom system has off only the
 * parts it turned off, and every part counts as on until its definition has loaded.
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const OFF = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const LATE = 'sys_cccccccccccccccc';

const system = (id: string, parts: CustomRender['parts']): CustomRender =>
  ({ id, name: id, parts, derived: [], sheet: { sections: [] }, words: {} });

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate(system(OFF, { bank: { on: false }, vehicles: { on: false }, shops: { on: true } }));
  registerCustomTemplate(system(PLAIN, {}));
  // A custom system nobody has loaded yet: the fetch never answers during the test.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const offIn = (id: string | null | undefined) => PARTS.filter((p) => !partOn(id, p));

describe('partOn', () => {
  it('has every part on under every built-in system, and with no system', () => {
    for (const id of [...BUILT_INS, undefined, null, '']) expect(offIn(id), String(id)).toEqual([]);
  });

  it('has every part on in a custom system that turned none off', () => {
    expect(offIn(PLAIN)).toEqual([]);
  });

  it('has off exactly the parts a custom system turned off', () => {
    expect(offIn(OFF)).toEqual(['bank', 'vehicles']);
  });

  it('has every part on while a custom system has not loaded', () => {
    expect(offIn(LATE)).toEqual([]);
  });

  it('has every part on for a component drawn without a running system', () => {
    expect(PARTS.filter((p) => !allPartsOn(p))).toEqual([]);
  });
});

describe('useParts', () => {
  // One probe per hook: each must redraw by itself, now they share the loading code.
  function PartsProbe({ id }: { id: string }) {
    const on = useParts(id);
    return <div data-testid="parts">{PARTS.filter((p) => !on(p)).join(',') || 'all on'}</div>;
  }
  function WordsProbe({ id }: { id: string }) {
    const word = useWords(id);
    return <div data-testid="words">{word('bank', 'singular', 'BANK')}</div>;
  }
  const arrive = () => act(() => {
    registerCustomTemplate({ ...system(LATE, { cyberware: { on: false }, xp: { on: false } }),
      words: { bank: { singular: 'COFFER', plural: 'COFFERS', short: 'COFFER' } } });
  });

  it('redraws when a custom system arrives', () => {
    render(<PartsProbe id={LATE} />);
    expect(screen.getByTestId('parts').textContent).toBe('all on');
    arrive();
    expect(screen.getByTestId('parts').textContent).toBe('cyberware,xp');
  });

  it('leaves the words redrawing as before', () => {
    render(<WordsProbe id={LATE} />);
    expect(screen.getByTestId('words').textContent).toBe('BANK');
    arrive();
    expect(screen.getByTestId('words').textContent).toBe('COFFER');
  });

  it('asks the server only about a custom system', () => {
    render(<><PartsProbe id="cyberpunk_red" /><WordsProbe id="cyberpunk_red" /></>);
    expect(screen.getByTestId('parts').textContent).toBe('all on');
    expect(screen.getByTestId('words').textContent).toBe('BANK');
    expect(fetch).not.toHaveBeenCalled();
  });
});
