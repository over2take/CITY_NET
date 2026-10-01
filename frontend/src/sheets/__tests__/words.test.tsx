import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { wordFor, useWords } from '../words';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../customTemplates';

/**
 * The glossary in the browser: a place that shows a term asks with the text it shows today.
 * A built-in system always gets that text back; a custom system gets its own word once its
 * words have arrived.
 */

const ID = 'sys_0123456789abcdef';
const resolved = (singular: string, plural: string, short: string) => ({ singular, plural, short });
const HEARTH: CustomRender = {
  id: ID, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] },
  words: {
    hp: resolved('WOUND', 'WOUNDS', 'HP'),
    money: resolved('CREDIT', 'GOLD', 'GP'),
    gm: resolved('WARDEN', 'GMS', 'GM'),
  },
};

beforeEach(() => clearCustomTemplates());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('wordFor', () => {
  it('gives a built-in system the text that place shows today, whatever it is', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', null, undefined]) {
      expect(wordFor(system, 'money', 'plural', 'EDDIES')).toBe('EDDIES');
    }
  });

  it('never renames a built-in system, even with words cached under its id', () => {
    registerCustomTemplate({ ...HEARTH, id: 'cyberpunk_red' });
    expect(wordFor('cyberpunk_red', 'money', 'plural', 'EDDIES')).toBe('EDDIES');
  });

  it('gives a custom system its own word once loaded, and today\'s text until then', () => {
    expect(wordFor(ID, 'money', 'plural', 'CREDITS')).toBe('CREDITS');
    registerCustomTemplate(HEARTH);
    expect(wordFor(ID, 'money', 'plural', 'CREDITS')).toBe('GOLD');
    expect(wordFor(ID, 'money', 'short', 'CR')).toBe('GP');
    expect(wordFor(ID, 'gm', 'singular', 'GM')).toBe('WARDEN');
    // A term the server sent nothing for keeps today's text.
    expect(wordFor(ID, 'vehicle', 'singular', 'VEHICLE')).toBe('VEHICLE');
  });
});

describe('useWords', () => {
  const Label = ({ system }: { system: string }) => {
    const word = useWords(system);
    return <span>{word('hp', 'plural', 'HP')}</span>;
  };

  it('fetches a custom system\'s words and redraws when they arrive', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(HEARTH) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<Label system={ID} />);
    expect(screen.getByText('HP')).toBeTruthy();
    expect(await screen.findByText('WOUNDS')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/systems/render/${ID}`);
  });

  it('never asks the server about a built-in system', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Label system="cities_without_number" />);
    expect(screen.getByText('HP')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
